import { expect, test } from "bun:test"
import {
  COL,
  DIALOG_INNER,
  HEADER_LINE,
  TABLE_WIDTH,
  emptySourceRow,
  fmtMoney,
  fmtPct,
  fmtReset,
  formatContextUsage,
  contextLimitFromPayload,
  contextMessagesFromPayload,
  formatDoc,
  formatRowLine,
  formatWindowRow,
  sourceState,
  sourceStateLabel,
} from "../usage/tui-usage-format"

test("usage headers are short and the row fits the dialog", () => {
  expect(HEADER_LINE).not.toMatch(/STATUS/i)
  expect(HEADER_LINE).not.toContain("resets-in")
  expect(HEADER_LINE.indexOf("%")).toBeGreaterThanOrEqual(0)
  expect(HEADER_LINE.indexOf("%")).toBeLessThan(HEADER_LINE.indexOf("RESET"))
  expect(TABLE_WIDTH).toBeLessThanOrEqual(DIALOG_INNER)
  expect(Object.values(COL).every((width) => Number.isInteger(width) && width > 0)).toBe(true)
})

test("missing cap, percentage, and reset use a compact placeholder", () => {
  expect(fmtMoney(undefined)).toBe("—")
  expect(fmtMoney(Number.NaN)).toBe("—")
  expect(fmtPct(null)).toBe("—")
  expect(fmtReset(undefined)).toBe("—")
  expect(emptySourceRow("no endpoint")).toMatchObject({ metric: "—", pct: "—", reset: "—" })
  expect(formatWindowRow({ label: "5h", used: 3, cap: null, pct: null, resetsInSeconds: null }, { id: "opencode-go" })).toMatchObject({
    metric: "—",
    pct: "—",
    reset: "—",
  })
})

test("money has stable decimals and rows are single-line bounded strings", () => {
  expect(fmtMoney(3)).toBe("$3.00")
  expect(fmtMoney(10)).toBe("$10.00")
  expect(fmtMoney(0.125)).toBe("$0.13")

  const line = formatRowLine({
    window: "5h",
    used: "$3.00",
    cap: "$12.00",
    pct: "50%",
    pctTone: "ok",
    reset: "4h30m",
    status: "ok",
  } as any)
  expect(line).not.toMatch(/[\r\n]/)
  expect(line.length).toBeLessThanOrEqual(72)
  expect(line).not.toContain("usedTokens")
})

test("docs omit edit-me placeholders and truncate long prose", () => {
  expect(formatDoc("Edit me: replace this description")).toBeUndefined()
  expect(formatDoc("  EDIT ME  ")).toBeUndefined()
  const long = formatDoc("A ".repeat(100))
  expect(long).toBeDefined()
  expect(long!.length).toBeLessThanOrEqual(70)
  expect(long).toMatch(/…$/)
})

test("formatContextUsage is used-only without a real caller limit", () => {
  expect(formatContextUsage(12_000)).toBe("12k")
  expect(formatContextUsage(12_000, undefined)).toBe("12k")
  expect(formatContextUsage(12_000, 0)).toBe("12k")
  expect(formatContextUsage(100_000, 200_000)).toBe("100k/200k (50%)")
  expect(contextLimitFromPayload({ data: { limit: 1_050_000, messages: [] } })).toBe(1_050_000)
  expect(contextLimitFromPayload([{ tokens: { input: 12_000 } }])).toBeUndefined()
  expect(contextMessagesFromPayload({ data: { messages: [{ tokens: { input: 3 } }] } })).toEqual([{ tokens: { input: 3 } }])
})

test("source state distinguishes healthy, capped, unavailable, and unknown telemetry", () => {
  expect(sourceState({ probe: "ok", windows: [{ pct: 42 }] })).toBe("connected")
  expect(sourceState({ probe: "ok", apiCapHit: true, windows: [{ pct: 42 }] })).toBe("usage-reached")
  expect(sourceState({ probe: "ok", windows: [{ pct: 100 }] })).toBe("usage-reached")
  expect(sourceState({ probe: "err" })).toBe("unavailable")
  expect(sourceState({ probe: "none" })).toBe("unknown")
  expect(sourceState({ probe: "ok", windows: [{ pct: 100 }] }, { stale: true })).toBe("unknown")
  expect(sourceStateLabel("usage-reached")).toBe("usage reached")
})
