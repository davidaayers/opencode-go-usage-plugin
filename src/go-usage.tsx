/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { Show } from "solid-js"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import process from "node:process"

type WindowKey = "rolling" | "weekly" | "monthly"

type UsageWindow = {
  status: string
  percent: number
  resetsAt: string
}

type GoUsage = Partial<Record<WindowKey, UsageWindow>>

type FetchState =
  | { kind: "loading" }
  | { kind: "noauth" }
  | { kind: "ready"; usage: GoUsage }
  | { kind: "error"; message: string }

type ThemeTokens = TuiPluginApi["theme"]["current"]

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const POLL_MS = 60_000
const FETCH_TIMEOUT_MS = 10_000
const OK_AT = 50
const WARN_AT = 75
const DANGER_AT = 90
// Sidebar is fixed 42 cols (37 usable after padding). Widest column content is
// line 2: "100% · 28d" = 10 chars; label(2) + space(1) + bar(7) = 10 matches it.
const GAUGE_WIDTH = 7
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]

const WINDOWS: ReadonlyArray<{ key: WindowKey; label: string; short: string }> = [
  { key: "rolling", label: "5h", short: "5h" },
  { key: "weekly", label: "week", short: "wk" },
  { key: "monthly", label: "month", short: "mo" },
]

// --- auth ---

function authPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "auth.json")
}

function readGoKey(): string | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(authPath(), "utf8"))
    const key = (raw as Record<string, { key?: unknown }> | null)?.["opencode-go"]?.key
    return typeof key === "string" && key.length > 0 ? key : undefined
  } catch {
    return undefined
  }
}

// --- fetch + parse ---

function parseWindow(value: unknown): UsageWindow | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.percent !== "number" || !Number.isFinite(record.percent)) return undefined
  return {
    status: typeof record.status === "string" ? record.status : "ok",
    percent: Math.max(0, Math.min(100, record.percent)),
    resetsAt: typeof record.resetsAt === "string" ? record.resetsAt : "",
  }
}

function parseUsage(body: unknown): GoUsage {
  const usage = (body as { usage?: Record<string, unknown> } | null | undefined)?.usage
  const out: GoUsage = {}
  for (const { key } of WINDOWS) {
    const window = parseWindow(usage?.[key])
    if (window) out[key] = window
  }
  if (!out.rolling && !out.weekly && !out.monthly) throw new Error("unexpected response shape")
  return out
}

async function fetchUsage(key: string): Promise<GoUsage> {
  const response = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return parseUsage(await response.json())
}

// --- formatting ---

function percentLabel(percent: number): string {
  if (percent <= 0) return "0%"
  if (percent < 1) return "<1%"
  return `${Math.round(percent)}%`
}

function shortReset(iso: string, now = new Date()): string {
  if (!iso) return ""
  const diffMs = new Date(iso).getTime() - now.getTime()
  if (!Number.isFinite(diffMs)) return ""
  if (diffMs <= 0) return "now"
  const minutes = Math.ceil(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.ceil(hours / 24)}d`
}

function gauge(fraction: number, width: number): { fill: string; track: string } {
  const cells = Math.min(1, Math.max(0, fraction)) * width
  let full = Math.floor(cells)
  let partial = EIGHTHS[Math.round((cells - full) * 8)] ?? ""
  if (partial === EIGHTHS[8]) {
    full += 1
    partial = ""
  }
  return {
    fill: "█".repeat(full) + partial,
    track: "░".repeat(width - full - (partial ? 1 : 0)),
  }
}

function levelColor(window: UsageWindow, theme: ThemeTokens) {
  if (window.status === "rate-limited" || window.percent >= DANGER_AT) return theme.error
  if (window.percent >= WARN_AT) return theme.warning
  if (window.percent >= OK_AT) return theme.accent
  return theme.success
}

function compactText(state: FetchState): string {
  if (state.kind !== "ready") return ""
  let worst: { label: string; window: UsageWindow } | undefined
  for (const { key, label } of WINDOWS) {
    const window = state.usage[key]
    if (window && (!worst || window.percent > worst.window.percent)) worst = { label, window }
  }
  return worst ? `Go ${worst.label} ${percentLabel(worst.window.percent)}` : ""
}

// --- session gating ---

function isGoSession(api: TuiPluginApi, sessionID: string): boolean {
  const messages = api.state.session.messages(sessionID)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === "assistant" && message.providerID) return message.providerID === "opencode-go"
  }
  const model = api.state.session.get(sessionID)?.model
  if (model?.providerID) return model.providerID === "opencode-go"
  return api.state.config.model?.startsWith("opencode-go/") ?? false
}

function isSidebarVisible(api: TuiPluginApi, sessionID: string, width: number): boolean {
  if (api.state.session.get(sessionID)?.parentID) return false
  return api.kv.get<"auto" | "hide">("sidebar", "auto") === "auto" && width > 120
}

// --- polling ---

function createUsagePolling(api: TuiPluginApi, sessionID: string, enabled: () => boolean) {
  const [state, setState] = createSignal<FetchState>({ kind: "loading" })
  let disposed = false
  let inFlight: Promise<void> | undefined
  let refreshAgain = false

  const runRefresh = async () => {
    if (!enabled() || !isGoSession(api, sessionID)) return
    const key = readGoKey()
    if (!key) {
      setState({ kind: "noauth" })
      return
    }
    try {
      const usage = await fetchUsage(key)
      if (disposed) return
      setState({ kind: "ready", usage })
    } catch (error) {
      if (disposed) return
      setState({ kind: "error", message: error instanceof Error ? error.message : "Go usage unavailable" })
    }
    api.renderer.requestRender()
  }

  const refresh = () => {
    if (inFlight) {
      refreshAgain = true
      return inFlight
    }
    inFlight = runRefresh().finally(() => {
      inFlight = undefined
      if (refreshAgain && !disposed) {
        refreshAgain = false
        void refresh()
      }
    })
    return inFlight
  }

  untrack(() => void refresh())
  createEffect(() => {
    if (enabled()) untrack(() => void refresh())
  })
  const timer = setInterval(() => void refresh(), POLL_MS)
  const offMessage = api.event.on("message.updated", () => void refresh())
  const offSession = api.event.on("session.updated", () => void refresh())
  onCleanup(() => {
    disposed = true
    clearInterval(timer)
    offMessage()
    offSession()
  })

  return state
}

// --- views ---

function UsageGauge(props: { label: string; window: UsageWindow | undefined; theme: ThemeTokens }) {
  const bar = () => gauge(props.window ? props.window.percent / 100 : 0, GAUGE_WIDTH)
  const color = () => (props.window ? levelColor(props.window, props.theme) : props.theme.textMuted)
  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg={props.theme.textMuted}>{`${props.label} `}</text>
        <text fg={color()}>{bar().fill}</text>
        <text fg={props.theme.textMuted}>{bar().track}</text>
      </box>
      <box flexDirection="row">
        <text fg={color()}>{props.window ? percentLabel(props.window.percent) : "--"}</text>
        <text fg={props.theme.textMuted}>{props.window ? ` · ${shortReset(props.window.resetsAt)}` : ""}</text>
      </box>
    </box>
  )
}

function SidebarView(props: { api: TuiPluginApi; sessionID: string }) {
  const state = createUsagePolling(props.api, props.sessionID, () => true)

  const visible = createMemo(() => isGoSession(props.api, props.sessionID) && state().kind !== "noauth")

  const fallbackText = (current: FetchState): string => {
    if (current.kind === "error") return current.message
    if (current.kind === "loading") return "loading…"
    return ""
  }

  const gauges = createMemo(() => {
    const current = state()
    if (current.kind !== "ready") return []
    return WINDOWS.map(({ key, short }) => ({ short, window: current.usage[key] }))
  })

  return (
    <box flexDirection="column">
      <Show when={visible()} fallback={<box />}>
        <text fg={props.api.theme.current.text} attributes={TextAttributes.BOLD}>{"Go Usage"}</text>
        <Show when={gauges().length > 0} fallback={<text fg={props.api.theme.current.textMuted}>{fallbackText(state())}</text>}>
          <box flexDirection="row" columnGap={1}>
            {gauges().map(({ short, window }) => (
              <UsageGauge label={short} window={window} theme={props.api.theme.current} />
            ))}
          </box>
        </Show>
      </Show>
    </box>
  )
}

function CompactView(props: { api: TuiPluginApi; sessionID: string }) {
  const dimensions = useTerminalDimensions()
  const sidebarHidden = createMemo(() => !isSidebarVisible(props.api, props.sessionID, dimensions().width))
  const state = createUsagePolling(props.api, props.sessionID, sidebarHidden)

  return (
    <box>
      <Show when={sidebarHidden() && state().kind === "ready"} fallback={<box />}>
        <text fg={props.api.theme.current.textMuted}>{compactText(state())}</text>
      </Show>
    </box>
  )}

export const GoUsageFormat = {
  percentLabel,
  shortReset,
  gauge,
  levelColor,
  compactText,
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 160,
    slots: {
      sidebar_content(_ctx, slotProps) {
        return <SidebarView api={api} sessionID={slotProps.session_id} />
      },
      session_prompt_right(_ctx, slotProps) {
        return <CompactView api={api} sessionID={slotProps.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-go-usage",
  tui,
}

export default plugin
