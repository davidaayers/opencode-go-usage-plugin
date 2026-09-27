import { rm } from "node:fs/promises"
import process from "node:process"

await rm("dist", { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ["src/go-usage.tsx"],
  outdir: "dist",
  target: "bun",
  naming: { entry: "tui.js" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  external: ["@opentui/core", "@opentui/solid", "solid-js"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
