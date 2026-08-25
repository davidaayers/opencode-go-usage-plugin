# opencode-go-usage-plugin

An [OpenCode](https://opencode.ai) TUI sidebar plugin that shows your OpenCode Go plan usage (5h / weekly / monthly) from the official `GET https://opencode.ai/zen/go/v1/usage` endpoint — no dashboard scraping.

```
Go Usage
5h █▏░░░░░ wk ████▏░░ mo ███████
22% · 2h  81% · 7d   100% · 28d
```

- `Go Usage` sidebar block: three small gauges (5h / wk / mo) with eighth-block fills, percent + reset below each — shown in `opencode-go` sessions
- Gauge/% color ramps with proximity to the limit: `success` <50% → `accent` 50–74% → `warning` 75–89% → `error` ≥90% or `rate-limited`
- Compact `Go month 100%` line in the prompt bar when the sidebar is hidden (shows the binding constraint)
- Reads the Go API key from `~/.local/share/opencode/auth.json` — zero config
- 60s polling plus refresh on message/session events; colors come from theme tokens only
- Hidden entirely when no `opencode-go` key is present or the session is not using Go

## Install

Clone the repo, then point `tui.json` at the source (TUI plugins load straight from `.tsx` — no build step):

```sh
git clone https://github.com/davidaayers/opencode-go-usage-plugin.git ~/development/opencode-go-usage-plugin
```

Add to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "file:///Users/you/development/opencode-go-usage-plugin/src/go-usage.tsx"
  ]
}
```

Restart OpenCode. Requires Bun (or Node ≥ 22) on PATH for dependency install; `bun install` in the plugin dir once if dependencies don't resolve.

## Dev

- `bun run typecheck` — the only check
- `bun scratch-repro.tsx` — headless render capture (disposable scratch file)
