# opencode-go-usage-plugin

An [OpenCode](https://opencode.ai) TUI sidebar plugin that shows your OpenCode Go plan usage (5h / weekly / monthly) from the official usage API — no dashboard scraping.

```
Go Usage
5h █▏░░░░░ wk ████▏░░ mo ███████
22% · 2h   81% · 7d   100% · 28d
```

## Features

- **Plan gauges** — three eighth-block gauges (5h / wk / mo) sized to the sidebar, with percent and reset countdown beneath each
- **Proximity colors** — gauge and percent ramp through theme tokens as limits approach: `success` <50% → `accent` 50–74% → `warning` 75–89% → `error` ≥90% or `rate-limited`
- **Compact prompt line** — `Go month 100%` on narrow terminals (or with `compact: true`), showing the binding constraint
- **Official API** — polls `GET https://opencode.ai/zen/go/v1/usage` with your active OpenCode Console login (or a legacy Go key); zero config, no page scraping
- **Live updates** — 60s polling plus refresh on message/session events
- **Silent by design** — hidden entirely when no OpenCode credential is present or the session is not using Go

## Install

Requires OpenCode **2.1.3 or newer**. Add the package to `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["@davidaayers/opencode-go-usage-plugin"]
}
```

Restart OpenCode after installing. The block appears once the session uses an `opencode-go` model. V1 releases do not run in V2.

### From source

Run `pnpm install && pnpm build`, then load the repository directory from the global **`~/.config/opencode/cli.json`**, not the server configuration:

```jsonc
// ~/.config/opencode/cli.json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    "/absolute/path/to/opencode-go-usage-plugin"
  ]
}
```

The build generates an ignored root `tui.js` re-export for OpenCode 2.1.3's local-directory resolver. npm installs use the sole `./tui` export pointing to `dist/tui.js`; only `dist` is published. Do not also load a discovery wrapper for the same plugin.

## How It Works

- **Usage windows**: polls the official endpoint using the active OpenCode Console credential from the connected server's credential API every 60s and on session events. A legacy `opencode-go` key is used only when Console is not connected. No legacy `auth.json` access is needed. Each window reports `percent` (0–100), `status` (`ok` / `rate-limited`), and `resetsAt`.
- **Rendering**: SolidJS JSX via `@opentui/solid`, registered into V2's `sidebar.content` and `prompt.footer.status` slots. Colors come from the active OpenCode theme.
- **Compact mode**: V2 does not expose sidebar visibility preferences. For a manually hidden sidebar on a wide terminal, use `{ "package": "/absolute/path/to/opencode-go-usage-plugin", "options": { "compact": true } }` in `plugins`.
- **Sidebar geometry**: the session sidebar is a fixed 42 columns (37 usable after padding); the gauge columns are sized so the widest possible row (`100% · 28d`) fits exactly.

## Development

```sh
pnpm install --frozen-lockfile
pnpm build              # compile src/tui.tsx -> dist/tui.js + local tui.js bridge
pnpm check              # typecheck, formatting tests, packed render/update/cleanup
bun scratch-repro.tsx   # headless render capture
```

Source lives in `src/tui.tsx`; the published entrypoint is the compiled `dist/tui.js`, built by `build.mjs`. The build runs `@opentui/solid`'s Solid transform so JSX compiles to reactive bindings (not eager `jsx()` calls), leaves the host imports (`@opencode/plugin`, `effect`, `@opentui/core`, `@opentui/solid`, `solid-js`) external, and stays unminified so OpenCode's loader can rewrite them to its own copies. Generated files are ignored and replaced atomically; do not commit them.

## Roadmap

Cross-repository follow-up work is tracked in the [OpenCode Plugins project](https://github.com/users/davidaayers/projects/1).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE) © 2026 David Ayers
