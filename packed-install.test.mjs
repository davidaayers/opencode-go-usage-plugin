import { test, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA } from "@opentui/core"
import { testRender, createElement, insert, setProp } from "@opentui/solid"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import * as tuiRuntime from "@opencode/plugin/tui"
import { createSignal } from "solid-js"

function betweenSiblings(render) {
  const parent = createElement("box")
  setProp(parent, "flexDirection", "column")
  setProp(parent, "gap", 1)
  for (const child of ["BEFORE", render, "AFTER"]) {
    if (typeof child === "function") insert(parent, child, null)
    else {
      const text = createElement("text")
      setProp(text, "content", child)
      insert(parent, text)
    }
  }
  return parent
}

function expectCollapsed(setup) {
  expect(setup.captureCharFrame().split("\n").map((line) => line.trimEnd()).join("\n").trim()).toBe("BEFORE\n\nAFTER")
}

test("packed V2 plugin renders usage, updates, and cleans up", async () => {
  const directory = mkdtempSync(join(tmpdir(), "go-usage-pack-"))
  const originalFetch = globalThis.fetch
  let setup
  let cleanup
  const frames = {}
  const expectGauge = (name) => {
    const frame = setup.captureCharFrame()
    frames[name] = frame
    const row = frame.split("\n").find((line) => line.startsWith("5h "))?.trimEnd()
    expect(row).toBeDefined()
    expect(row.length).toBe(32)
    expect(row.slice(11, 14)).toBe("wk ")
    expect(row.slice(22, 25)).toBe("mo ")
    for (const start of [3, 14, 25]) expect(row.slice(start, start + 7)).toMatch(/^[█░▏▎▍▌▋▊▉]{7}$/)
  }
  try {
    const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", directory], { cwd: import.meta.dir, encoding: "utf8" }))
    const consumer = join(directory, "consumer")
    execFileSync("npm", ["install", "--prefix", consumer, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", join(directory, packed[0].filename)])
    const installed = join(consumer, "node_modules", "@davidaayers", "opencode-go-usage-plugin")
    const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"))
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.exports).toEqual({ "./tui": "./dist/tui.js" })
    expect(pkg.engines.opencode).toBe(">=2.1.3 <3")
    const built = readFileSync(join(installed, pkg.exports["./tui"]), "utf8")
    expect(built).toContain('from "@opencode/plugin/tui"')
    for (const hostImport of ["@opentui/core", "@opentui/solid", "solid-js"]) {
      expect(built).toContain(`from "${hostImport}"`)
    }
    expect(built).not.toMatch(/jsxDEV|jsx-runtime|node_modules\//)
    const local = Bun.resolveSync(join(import.meta.dir, "tui"), import.meta.dir)
    expect(local).toBe(join(import.meta.dir, "tui.js"))
    expect(packed[0].files.map((file) => file.path)).not.toContain("tui.js")
    ensureRuntimePluginSupport({ additional: { "@opencode/plugin/tui": tuiRuntime } })
    const plugin = (await import(join(installed, pkg.exports["./tui"]))).default
    const localPlugin = (await import(local)).default
    expect(localPlugin.id).toBe(plugin.id)
    expect(typeof localPlugin.setup).toBe("function")
    expect(plugin.id).toBe("opencode-go-usage")
    const slots = new Map()
    const [providerID, setProviderID] = createSignal("opencode-go")
    const listeners = new Set()
    const color = RGBA.fromHex("#ffffff")
    const feedback = Object.fromEntries(["success", "warning", "error"].map((key) => [key, { base: color }]))
    let percent = 42
    let resetDays = 28
    let requests = 0
    globalThis.fetch = async (url, init) => {
      expect(url).toBe("https://opencode.ai/zen/go/v1/usage")
      expect(init.headers.Authorization).toBe("Bearer fixture-oauth")
      requests++
      return Response.json({ usage: {
        rolling: { status: "ok", percent, resetsAt: new Date(Date.now() + resetDays * 86_400_000).toISOString() },
        weekly: { status: "ok", percent: 57, resetsAt: "" },
        monthly: { status: "rate-limited", percent: 100, resetsAt: "" },
      } })
    }
    const api = {
      options: { compact: true },
      client: { credential: { list: async () => [
        { integrationID: "opencode-go", active: true, value: { type: "key", key: "expired-go-key" } },
        { integrationID: "opencode", active: true, value: { type: "oauth", access: "fixture-oauth", refresh: "fixture-refresh", expires: 9999999999999, methodID: "device" } },
      ] } },
      ui: {
        slot: (entry) => {
          const name = entry.prepend ?? entry.append
          if (name === "sidebar.content") {
            expect(entry.prepend).toBe(name)
            expect(entry.append).toBeUndefined()
          } else {
            expect(entry.append).toBe("prompt.footer.status")
            expect(entry.prepend).toBeUndefined()
          }
          slots.set(name, entry.render)
          return () => slots.delete(name)
        },
        model: { current: () => undefined },
      },
      data: {
        listen: (callback) => { listeners.add(callback); return () => listeners.delete(callback) },
        session: { get: () => ({ model: { providerID: providerID(), id: "fixture" } }), message: { list: () => [] } },
      },
      theme: { text: { base: color, muted: color, action: { primary: { base: color } }, feedback } },
      renderer: { requestRender() {} },
    }
    cleanup = await plugin.setup(api)
    expect([...slots.keys()]).toEqual(["sidebar.content", "prompt.footer.status"])
    setProviderID("other")
    setup = await testRender(() => betweenSiblings(() => slots.get("sidebar.content")({ sessionID: "test" })), { width: 37, height: 10 })
    await setup.renderOnce()
    expectCollapsed(setup)
    setProviderID("opencode-go")
    for (const listener of listeners) listener({ details: { type: "session.model.selected", data: { sessionID: "test" } } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("42%")
    expect(setup.captureCharFrame()).toContain("57%")
    expect(setup.captureCharFrame()).toContain("100%")
    expectGauge("three-gauges")
    for (const value of [0, 100]) {
      percent = value
      resetDays = 1000
      for (const listener of listeners) listener({ details: { type: "session.usage.updated", data: { sessionID: "test" } } })
      await new Promise((resolve) => setTimeout(resolve, 20))
      await setup.renderOnce()
      expectGauge(`${value}-percent-long-reset`)
      const rows = setup.captureCharFrame().split("\n").map((line) => line.trimEnd())
      expect(rows.find((line) => line.startsWith(`${value}% · `)).length).toBeLessThanOrEqual(32)
      expect(rows.find((line) => line.startsWith("5h ")).slice(3, 10)).toBe((value === 0 ? "░" : "█").repeat(7))
      if (value === 100) expect(setup.captureCharFrame()).toContain("100% · 10…")
    }
    percent = 81
    for (const listener of listeners) listener({ details: { type: "session.usage.updated", data: { sessionID: "test" } } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("81%")
    expectGauge("updated-gauges")
    setProviderID("other")
    await setup.renderOnce()
    expectCollapsed(setup)
    setProviderID("opencode-go")
    expect(requests).toBeGreaterThanOrEqual(2)
    globalThis.fetch = async () =>
      Response.json(
        { error: { type: "authentication_error", code: "api_key_expired", message: "This API key has expired." } },
        { status: 401 },
      )
    for (const listener of listeners) listener({ details: { type: "session.usage.updated", data: { sessionID: "test" } } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("HTTP 401: This API key has expired.")
    globalThis.fetch = async (url, init) => {
      expect(url).toBe("https://opencode.ai/zen/go/v1/usage")
      expect(init.headers.Authorization).toBe("Bearer fixture-oauth")
      requests++
      return Response.json({ usage: { rolling: { status: "ok", percent, resetsAt: "" } } })
    }
    for (const listener of listeners) listener({ details: { type: "session.usage.updated", data: { sessionID: "test" } } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("81%")
    expectGauge("missing-windows")
    expect(setup.captureCharFrame()).toContain("--")
    setup.renderer.destroy()
    setup = undefined
    expect(listeners.size).toBe(0)
    setup = await testRender(() => betweenSiblings(() => slots.get("prompt.footer.status")({ sessionID: "test" })), { width: 80, height: 7 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Go 5h 81%")
    setProviderID("other")
    await setup.renderOnce()
    expectCollapsed(setup)
    setup.renderer.destroy()
    setup = undefined
    expect(listeners.size).toBe(0)
    setup = await testRender(() => betweenSiblings(() => slots.get("prompt.footer.status")({})), { width: 80, height: 7 })
    await setup.renderOnce()
    expectCollapsed(setup)
    setup.renderer.destroy()
    setup = undefined
    cleanup()
    cleanup = undefined
    expect(slots.size).toBe(0)
  } finally {
    if (process.env.OPENCODE_TEST_EVIDENCE_DIR) {
      writeFileSync(join(process.env.OPENCODE_TEST_EVIDENCE_DIR, "go-packed-frames.json"), JSON.stringify(frames, null, 2))
    }
    setup?.renderer.destroy()
    cleanup?.()
    globalThis.fetch = originalFetch
    rmSync(directory, { recursive: true, force: true })
  }
})
