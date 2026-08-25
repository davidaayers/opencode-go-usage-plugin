# AGENTS.md

OpenCode **TUI-only** plugin showing OpenCode Go plan usage. Single deliverable: `src/go-usage.tsx`. Install happens via `file://` path in `~/.config/opencode/tui.json`; user docs live in README.md.

## Commands

- `bun run typecheck` — the only check (`tsc --noEmit`). No test runner or linter is configured.
- `bun scratch-repro.tsx` — offscreen render harness. **Known harness limitations** (verified 2026-08-24):
  - Signal updates never propagate to captured frames — a `flag()` flip after mount still renders the mount-time frame. Verify dynamic layouts via **static fixtures** through the exported pure helpers (`GoUsageFormat`), not live state.
  - `createEffect` never fires under the harness's solid server runtime. The plugin kicks its first poll with a direct `untrack(refresh())` call; keep that — don't rely on effects for initial work.
  - The live-slot section of the harness only proves mount + fetch + no-crash, not visual output.
- Visual changes can't be observed by typecheck alone — render-capture or restart the OpenCode TUI to see them. The real TUI (unlike the harness) does propagate signal updates; the codex usage plugin (`~/development/opencode-codex-usage-plugin`) uses the same signals + `requestRender` pattern successfully.

## Hard constraints

- Line 1 of any `.tsx` file must be `/** @jsxImportSource @opentui/solid */`. This is Solid, not React: use `solid-js` primitives (`createMemo`, `createSignal`, `Show`, `For`), never React imports/hooks. `tsconfig.json` enforces the import source.
- **`<Show>` without a `fallback` crashes @opentui/solid when its `when` is falsy** — it yields an orphan empty text node ("Orphan text error") that kills the render. Every falsifiable `<Show>` inside a box slot needs `fallback={<box />}` (or any element), and slot functions must always return an element (wrap in `<box>` and gate inside) — never conditionally return `undefined`. Bare `null`/`""`/booleans as box children crash the same way.
- Bare string children in `<text>` are fine only when the text is on one line with braces (`<text>{"x"}</text>`); prefer braced expressions everywhere.
- Module shape: default export `{ id, tui }` satisfying `TuiPluginModule`. The `id` belongs ONLY on the module export — the object passed to `api.slots.register()` forbids `id` (`id?: never`) and will fail typecheck if included.
- This module is TUI-side only. It must never be listed in `opencode.jsonc`'s `plugin` array (the server will throw on it); it loads exclusively from `tui.json`.
- Dependencies are host-provided and resolved at plugin-load time (`@opentui/core`, `@opentui/solid`, `solid-js`, `@opencode-ai/plugin`). Keep the runtime dependency surface empty/minimal — there is no bundler. Node built-ins (`node:fs`, `node:path`, `node:os`, `node:process`) are fine and must be imported explicitly.
- All incoming data is untrusted: validate shapes before use (`parseWindow`, `parseUsage`, `readGoKey`); invalid input degrades gracefully, never throws.
- Colors come only from theme tokens via `api.theme.current` — no hardcoded ANSI colors. The usage scale: `success` <50%, `accent` 50–74%, `warning` 75–89%, `error` ≥90% or `rate-limited` (`OK_AT`/`WARN_AT`/`DANGER_AT` constants); labels/resets/header use `textMuted`/`text`.
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

`status` is `"ok"` or `"rate-limited"`; `percent` is 0–100; `resetsAt` is ISO 8601. Verified live 2026-08-24. The key lives in `~/.local/share/opencode/auth.json` under `auth["opencode-go"]["key"]`.

## Commits

- Conventional commit style: `feat:`, `fix:`, `docs:`, `chore:` prefixes, imperative mood, concise subject line.
