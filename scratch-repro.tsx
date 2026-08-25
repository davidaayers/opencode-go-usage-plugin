/** @jsxImportSource @opentui/solid */
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import process from "node:process"
import plugin, { GoUsageFormat } from "./src/go-usage.tsx"

const theme = {
  accent: RGBA.fromHex("#ff00ff"),
  warning: RGBA.fromHex("#ff9900"),
  error: RGBA.fromHex("#ff0000"),
  text: RGBA.fromHex("#e6e6e6"),
  textMuted: RGBA.fromHex("#808080"),
}

type SlotFn = (ctx: unknown, props: { session_id: string }) => unknown

function fakeApi() {
  const slots: Record<string, SlotFn> = {}
  const api = {
    theme: { current: theme },
    state: {
      session: {
        get: () => ({}),
        messages: () => [{ role: "assistant", providerID: "opencode-go" }],
      },
      config: { model: "opencode-go/kimi-k3" },
    },
    kv: { get: () => "auto" },
    event: { on: () => () => undefined },
    renderer: { requestRender: () => undefined },
    slots: {
      register: (registration: { slots: Record<string, SlotFn> }) => {
        Object.assign(slots, registration.slots)
      },
    },
  }
  return { api, slots }
}

// Fixture data: worst case — all windows full with the longest reset labels,
// proving the columns hold "100% · 28d" (10 chars) without spilling.
const FIXTURES = [
  { key: "rolling", short: "5h", window: { status: "ok", percent: 100, resetsAt: "2026-08-24T22:29:00.000Z" } },
  { key: "weekly", short: "wk", window: { status: "ok", percent: 100, resetsAt: "2026-08-31T21:30:00.000Z" } },
  { key: "monthly", short: "mo", window: { status: "rate-limited", percent: 100, resetsAt: "2026-09-21T21:30:00.000Z" } },
] as const

// One gauge per color band: success <50, accent 50-74, warning 75-89, error 90+/rate-limited.
const COLOR_BANDS = [
  { short: "ok", window: { status: "ok", percent: 22, resetsAt: "" } },
  { short: "acc", window: { status: "ok", percent: 62, resetsAt: "" } },
  { short: "wrn", window: { status: "ok", percent: 81, resetsAt: "" } },
  { short: "err", window: { status: "rate-limited", percent: 100, resetsAt: "" } },
] as const

function GaugeRow(props: { items: ReadonlyArray<{ short: string; window: { status: string; percent: number; resetsAt: string } }> }) {
  return (
    <box flexDirection="row" columnGap={1}>
      {props.items.map(({ short, window }) => {
        const bar = GoUsageFormat.gauge(window.percent / 100, 7)
        const color = GoUsageFormat.levelColor(window, theme)
        return (
          <box flexDirection="column">
            <box flexDirection="row">
              <text fg={theme.textMuted}>{`${short} `}</text>
              <text fg={color}>{bar.fill}</text>
              <text fg={theme.textMuted}>{bar.track}</text>
            </box>
            <box flexDirection="row">
              <text fg={color}>{GoUsageFormat.percentLabel(window.percent)}</text>
              <text fg={theme.textMuted}>{window.resetsAt ? ` · ${GoUsageFormat.shortReset(window.resetsAt, new Date("2026-08-24T21:30:00.000Z"))}` : ""}</text>
            </box>
          </box>
        )
      })}
    </box>
  )
}

async function main() {
  // 1. Static layout verification (testRender cannot show reactive frame updates).
  const staticSetup = await testRender(() => (
    <box gap={1} paddingLeft={2} paddingTop={1} width={40}>
      <text fg={theme.text} attributes={8}>{`Go Usage (fixtures):`}</text>
      <GaugeRow items={FIXTURES} />
      <text fg={theme.text} attributes={8}>{`color bands:`}</text>
      <GaugeRow items={COLOR_BANDS} />
      <text fg={theme.textMuted}>{GoUsageFormat.compactText({
        kind: "ready",
        usage: Object.fromEntries(FIXTURES.map(({ key, window }) => [key, window])),
      })}</text>
    </box>
  ), { width: 44, height: 12 })
  await staticSetup.renderOnce()
  console.log("=== ready layout (static fixtures) ===")
  console.log(staticSetup.captureCharFrame())
  staticSetup.renderer.destroy()

  // 2. Live slot mount: proves the plugin registers, mounts, fetches, and does not crash.
  const { api, slots } = fakeApi()
  await (plugin as any).tui(api)
  const sidebar = () => slots.sidebar_content({}, { session_id: "ses_scratch" }) as any
  const compact = () => slots.session_prompt_right({}, { session_id: "ses_scratch" }) as any
  const liveSetup = await testRender(() => (
    <box gap={1} paddingLeft={2} paddingTop={1} width={40}>
      <text fg={theme.text}>{`live slots (fetch fires, frame stays at mount state):`}</text>
      {sidebar()}
      <text fg={theme.text}>{`compact:`}</text>
      {compact()}
    </box>
  ), { width: 44, height: 12 })
  await liveSetup.renderOnce()
  console.log("=== live mount (loading frame) ===")
  console.log(liveSetup.captureCharFrame())
  await new Promise((resolve) => setTimeout(resolve, 3000))
  liveSetup.renderer.destroy()
  console.log("live mount survived fetch cycle without crash")
  process.exit(0)
}

main()
