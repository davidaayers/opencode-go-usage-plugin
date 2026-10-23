import { describe, expect, test } from "bun:test"
import { GoUsageFormat } from "./tui"

describe("Go usage formatting", () => {
  test("formats sub-percent and rounded usage", () => {
    expect([0, 0.2, 42.4, 99.9].map(GoUsageFormat.percentLabel)).toEqual(["0%", "<1%", "42%", "100%"])
  })

  test("formats reset countdowns deterministically", () => {
    const now = new Date("2026-10-22T00:00:00Z")
    expect(["", "invalid", "2026-10-21T00:00:00Z", "2026-10-22T00:30:00Z", "2026-10-22T02:00:00Z", "2026-10-25T00:00:00Z"]
      .map((reset) => GoUsageFormat.shortReset(reset, now))).toEqual(["", "", "now", "30m", "2h", "3d"])
  })

  test("clamps gauges at empty and full", () => {
    expect(GoUsageFormat.gauge(-1, 7)).toEqual({ fill: "", track: "░░░░░░░" })
    expect(GoUsageFormat.gauge(2, 7)).toEqual({ fill: "███████", track: "" })
  })

  test("compact text selects the most constrained window", () => {
    expect(GoUsageFormat.compactText({ kind: "loading" })).toBe("")
    expect(GoUsageFormat.compactText({ kind: "ready", usage: {
      rolling: { status: "ok", percent: 3, resetsAt: "" },
      weekly: { status: "ok", percent: 5, resetsAt: "" },
      monthly: { status: "ok", percent: 36, resetsAt: "" },
    } })).toBe("Go month 36%")
  })
})
