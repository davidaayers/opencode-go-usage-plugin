import { test, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import * as tuiRuntime from "@opencode/plugin/tui"

test("packed V2 plugin renders usage, updates, and cleans up", async () => {
  const directory = mkdtempSync(join(tmpdir(), "go-usage-pack-"))
  const originalFetch = globalThis.fetch
  let setup
  let cleanup
  try {
    const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", directory], { cwd: import.meta.dir, encoding: "utf8" }))
    const consumer = join(directory, "consumer")
    execFileSync("npm", ["install", "--prefix", consumer, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", join(directory, packed[0].filename)])
    const installed = join(consumer, "node_modules", "@davidaayers", "opencode-go-usage-plugin")
    const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"))
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.exports).toEqual({ "./tui": "./dist/tui.js" })
    expect(pkg.engines.opencode).toBe(">=2.1.3")
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
    const listeners = new Set()
    const color = RGBA.fromHex("#ffffff")
    const feedback = Object.fromEntries(["success", "warning", "error"].map((key) => [key, { base: color }]))
    let percent = 42
    let requests = 0
    globalThis.fetch = async (url, init) => {
      expect(url).toBe("https://opencode.ai/zen/go/v1/usage")
      expect(init.headers.Authorization).toBe("Bearer fixture-oauth")
      requests++
      return Response.json({ usage: {
        rolling: { status: "ok", percent, resetsAt: "" },
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
        slot: (entry) => { slots.set(entry.append, entry.render); return () => slots.delete(entry.append) },
        model: { current: () => undefined },
      },
      data: {
        listen: (callback) => { listeners.add(callback); return () => listeners.delete(callback) },
        session: { get: () => ({ model: { providerID: "opencode-go", id: "fixture" } }), message: { list: () => [] } },
      },
      theme: { text: { base: color, muted: color, action: { primary: { base: color } }, feedback } },
      renderer: { requestRender() {} },
    }
    cleanup = await plugin.setup(api)
    expect([...slots.keys()]).toEqual(["sidebar.content", "prompt.footer.status"])
    setup = await testRender(() => slots.get("sidebar.content")({ sessionID: "test" }), { width: 42, height: 5 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("42%")
    expect(setup.captureCharFrame()).toContain("57%")
    expect(setup.captureCharFrame()).toContain("100%")
    percent = 81
    for (const listener of listeners) listener({ details: { type: "session.usage.updated", data: { sessionID: "test" } } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("81%")
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
    setup.renderer.destroy()
    setup = undefined
    expect(listeners.size).toBe(0)
    setup = await testRender(() => slots.get("prompt.footer.status")({ sessionID: "test" }), { width: 80, height: 3 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Go 5h 81%")
    setup.renderer.destroy()
    setup = undefined
    expect(listeners.size).toBe(0)
    cleanup()
    cleanup = undefined
    expect(slots.size).toBe(0)
  } finally {
    setup?.renderer.destroy()
    cleanup?.()
    globalThis.fetch = originalFetch
    rmSync(directory, { recursive: true, force: true })
  }
})
