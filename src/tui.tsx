/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Plugin } from "@opencode/plugin/tui"
import type { Context as TuiPluginApi } from "@opencode/plugin/tui/context"
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { Show } from "solid-js"

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

type ThemeTokens = TuiPluginApi["theme"]

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const POLL_MS = 60_000
const FETCH_TIMEOUT_MS = 10_000
const OK_AT = 50
const WARN_AT = 75
const DANGER_AT = 90
// Match the total gauge-row allocation in the context and Codex plugins.
// Each 10-cell column fits "100% · 28d"; longer reset text is truncated.
const LAYOUT_WIDTH = 32
const COLUMN_GAP = 1
const COLUMN_WIDTH = (LAYOUT_WIDTH - 2 * COLUMN_GAP) / 3
const GAUGE_WIDTH = COLUMN_WIDTH - 3
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]

const WINDOWS: ReadonlyArray<{ key: WindowKey; label: string; short: string }> = [
  { key: "rolling", label: "5h", short: "5h" },
  { key: "weekly", label: "week", short: "wk" },
  { key: "monthly", label: "month", short: "mo" },
]

// --- auth ---

// The Go provider uses the OpenCode integration, so its active credential is
// the Console login (OAuth) or a Console service-account key. Older setups
// stored a separate opencode-go API key; fall back to that only when Console
// is not connected.
async function readGoKey(api: TuiPluginApi): Promise<string | undefined> {
  const credentials = await api.client.credential.list()
  const active = (integrationID: string) =>
    credentials.find((entry) => entry.integrationID === integrationID && entry.active)?.value
  const value = active("opencode") ?? active("opencode-go")
  if (value?.type === "oauth") return value.access.length > 0 ? value.access : undefined
  return value?.type === "key" && value.key.length > 0 ? value.key : undefined
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
  if (!response.ok) throw new Error(await errorMessage(response))
  return parseUsage(await response.json())
}

// The API explains rejected keys (for example an expired key) in its error
// body. Surface that instead of a bare status so the sidebar is actionable.
async function errorMessage(response: Response): Promise<string> {
  const status = `HTTP ${response.status}`
  try {
    const body = (await response.json()) as { error?: { message?: unknown } } | null
    const message = body?.error?.message
    return typeof message === "string" && message.length > 0 ? `${status}: ${message}` : status
  } catch {
    return status
  }
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
  if (window.status === "rate-limited" || window.percent >= DANGER_AT) return theme.text.feedback.error.base
  if (window.percent >= WARN_AT) return theme.text.feedback.warning.base
  if (window.percent >= OK_AT) return theme.text.action.primary.base
  return theme.text.feedback.success.base
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
  const messages = api.data.session.message.list(sessionID)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type === "assistant") return message.model.providerID === "opencode-go"
  }
  const model = api.data.session.get(sessionID)?.model
  if (model?.providerID) return model.providerID === "opencode-go"
  return api.ui.model.current()?.providerID === "opencode-go"
}

function isSidebarVisible(api: TuiPluginApi, sessionID: string, width: number): boolean {
  if (api.data.session.get(sessionID)?.parentID) return false
  return api.options.compact !== true && width > 120
}

// --- polling ---

function createUsagePolling(api: TuiPluginApi, sessionID: () => string, enabled: () => boolean) {
  const [state, setState] = createSignal<FetchState>({ kind: "loading" })
  let disposed = false
  let inFlight: Promise<void> | undefined
  let refreshAgain = false

  const runRefresh = async () => {
    if (!enabled() || !isGoSession(api, sessionID())) return
    try {
      const key = await readGoKey(api)
      if (disposed) return
      if (!key) {
        setState({ kind: "noauth" })
        return
      }
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
  const offSession = api.data.listen(({ details }) => {
    if (
      (details.type === "session.usage.updated" || details.type === "session.step.ended" || details.type === "session.model.selected") &&
      details.data.sessionID === sessionID()
    ) void refresh()
  })
  onCleanup(() => {
    disposed = true
    clearInterval(timer)
    offSession()
  })

  return state
}

// --- views ---

function UsageGauge(props: { label: string; window: UsageWindow | undefined; theme: ThemeTokens }) {
  const bar = () => gauge(props.window ? props.window.percent / 100 : 0, GAUGE_WIDTH)
  const color = () => (props.window ? levelColor(props.window, props.theme) : props.theme.text.muted)
  const percent = () => props.window ? percentLabel(props.window.percent) : "--"
  const reset = () => {
    const value = props.window ? shortReset(props.window.resetsAt) : ""
    const suffix = value ? ` · ${value}` : ""
    const available = COLUMN_WIDTH - percent().length
    return suffix.length > available ? `${suffix.slice(0, available - 1)}…` : suffix
  }
  return (
    <box flexDirection="column" width={COLUMN_WIDTH} flexShrink={0}>
      <box flexDirection="row">
        <text fg={props.theme.text.muted}>{`${props.label} `}</text>
        <text width={GAUGE_WIDTH} flexShrink={0}>
          <span style={{ fg: color() }}>{bar().fill}</span>
          <span style={{ fg: props.theme.text.muted }}>{bar().track}</span>
        </text>
      </box>
      <text width={COLUMN_WIDTH} wrapMode="none" truncate>
        <span style={{ fg: color() }}>{percent()}</span>
        <span style={{ fg: props.theme.text.muted }}>{reset()}</span>
      </text>
    </box>
  )
}

function SidebarView(props: { api: TuiPluginApi; sessionID: string }) {
  const state = createUsagePolling(props.api, () => props.sessionID, () => true)

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
    <box flexDirection="column" visible={visible()}>
      <Show when={visible()} fallback={<box />}>
        <text fg={props.api.theme.text.base} attributes={TextAttributes.BOLD}>{"Go Usage"}</text>
        <Show when={gauges().length > 0} fallback={<text fg={props.api.theme.text.muted}>{fallbackText(state())}</text>}>
          <box flexDirection="row" width={LAYOUT_WIDTH} columnGap={COLUMN_GAP}>
            {gauges().map(({ short, window }) => (
              <UsageGauge label={short} window={window} theme={props.api.theme} />
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
  const state = createUsagePolling(props.api, () => props.sessionID, sidebarHidden)
  const visible = createMemo(() => isGoSession(props.api, props.sessionID) && sidebarHidden() && state().kind === "ready")

  return (
    <box visible={visible()}>
      <Show when={visible()} fallback={<box />}>
        <text fg={props.api.theme.text.muted}>{compactText(state())}</text>
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

export default Plugin.define({
  id: "opencode-go-usage",
  setup(api) {
    const sidebar = api.ui.slot({
      prepend: "sidebar.content",
      render: (props) => <SidebarView api={api} sessionID={props.sessionID} />,
    })
    const compact = api.ui.slot({
      append: "prompt.footer.status",
      render: (props) => <Show when={props.sessionID} fallback={<box visible={false} />}>{(id) => <CompactView api={api} sessionID={id()} />}</Show>,
    })
    return () => { sidebar(); compact() }
  },
})
