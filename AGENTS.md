# AGENTS.md

OpenCode V2 **CLI-only** plugin showing OpenCode Go plan usage. Source is `src/go-usage.tsx`; the published entrypoint is the compiled `dist/tui.js` built by `bun build.mjs`. Load the package or a `file://` path in global `~/.config/opencode/cli.json`; user docs live in README.md.

## Commands

- `pnpm check` — TypeScript plus packed-install render/update/cleanup smoke tests using fixture credentials and responses.
- `bun scratch-repro.tsx` — offscreen render harness. **Known harness limitations** (verified 2026-08-24):
  - Signal updates never propagate to captured frames — a `flag()` flip after mount still renders the mount-time frame. Verify dynamic layouts via **static fixtures** through the exported pure helpers (`GoUsageFormat`), not live state.
  - `createEffect` never fires under the harness's solid server runtime. The plugin kicks its first poll with a direct `untrack(refresh())` call; keep that — don't rely on effects for initial work.
  - The live-slot section of the harness only proves mount + fetch + no-crash, not visual output.
- Visual changes can't be observed by typecheck alone — render-capture or restart the OpenCode TUI to see them. The real TUI (unlike the harness) does propagate signal updates; the codex usage plugin (`~/development/opencode-codex-usage-plugin`) uses the same signals + `requestRender` pattern successfully.

## Hard constraints

- Line 1 of any `.tsx` file must be `/** @jsxImportSource @opentui/solid */`. This is Solid, not React: use `solid-js` primitives (`createMemo`, `createSignal`, `Show`, `For`), never React imports/hooks. `tsconfig.json` enforces the import source.
- **`<Show>` without a `fallback` crashes @opentui/solid when its `when` is falsy** — it yields an orphan empty text node ("Orphan text error") that kills the render. Every falsifiable `<Show>` inside a box slot needs `fallback={<box />}` (or any element), and slot functions must always return an element (wrap in `<box>` and gate inside) — never conditionally return `undefined`. Bare `null`/`""`/booleans as box children crash the same way.
- Bare string children in `<text>` are fine only when the text is on one line with braces (`<text>{"x"}</text>`); prefer braced expressions everywhere.
- V2 module shape: default export `{ id, setup }` satisfying `Plugin.Definition` from `@opencode/plugin/tui`. Register views with `api.ui.slot`, read caches/events from `api.data`, and use `api.theme.text` tokens.
- This module is CLI-side only. Load it exclusively from global `cli.json`'s `plugins` array, never server configuration.
- Ship **compiled** `dist/tui.js`; never point `exports["./tui"]` at raw `.tsx`. The host only Solid-transforms source **outside** `node_modules` (`@opentui/solid/bun-plugin`'s filter excludes it), so a raw `.tsx` shipped in the package loads with Bun's eager JSX transform (frozen UI) and the host also cannot resolve the injected `@opentui/solid/jsx-*` import, because a production npm install has no `node_modules`. That is why the `file://` dev path works but the published `.tsx` did not.
- Renderer imports stay in `devDependencies` and external to the build — the host provides them at load. `@opencode/plugin/tui` is type-only (erased). Read the active Go credential through `api.client.credential.list()`, not legacy local files.
- Build with `bun build.mjs` (`bun run build`, also run via `prepack`). The build **must** pass `createSolidTransformPlugin()` from `@opentui/solid/bun-plugin`; without it Bun emits eager `jsx()`/`jsxDEV()` calls instead of Solid's reactive `_$insert`/`_$effect` bindings and the UI freezes on its mount frame (e.g. stuck on `loading…`). `build.mjs` asserts the output contains `_$insert`/`_$effect` and no `jsx-runtime`. Keep the output **unminified**: the host's import scanner is regex-based (`from "..."` with whitespace), and minification drops that space, which silently disables the rewrite and breaks loading.
- All incoming data is untrusted: validate shapes before use (`parseWindow`, `parseUsage`, `readGoKey`); invalid input degrades gracefully, never throws.
- Colors come only from V2 `api.theme.text` tokens — no hardcoded ANSI colors. The usage scale: success <50%, primary action 50–74%, warning 75–89%, error ≥90% or `rate-limited`; labels/resets/header use muted/base text.
- The sidebar slot is a **fixed 42 cols** (`width={42}` in `packages/tui/src/routes/session/sidebar.tsx`), 37 usable after padding (`2 + 2 + 1`). Gauge columns are sized so the widest line (`100% · 28d` = 10 chars) fits: label(2) + space + bar(7) = 10; 3 × 10 + 2 gaps = 32.
- TypeScript is strict with `verbatimModuleSyntax` — use `import type` for type-only imports.
- Solid reactivity: read signals inside JSX expressions or `createMemo`, not in untracked callback bodies; don't destructure reactive `props`.

## Upstream API

`GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <opencode-go key>` returns:

```json
{
  "usage": {
    "rolling":  { "status": "ok", "percent": 0, "resetsAt": "2026-08-25T05:54:18.428Z" },
    "weekly":   { "status": "ok", "percent": 0, "resetsAt": "2026-08-31T00:00:00.428Z" },
    "monthly":  { "status": "rate-limited", "percent": 100, "resetsAt": "2026-09-02T12:15:00.428Z" }
  }
}
```

`status` is `"ok"` or `"rate-limited"`; `percent` is 0–100; `resetsAt` is ISO 8601. Verified live 2026-08-24. V2 reads the active OpenCode Console credential (integration `opencode`, OAuth or key) through the connected server API; the `opencode-go` provider uses that integration. Fall back to a legacy `opencode-go` key only when Console is not connected.

## Commits

- Conventional commit style: `feat:`, `fix:`, `docs:`, `chore:` prefixes, imperative mood, concise subject line.
