/**
 * Collector + usage_status cell format (not the TUI dialog — that lives in
 * plugins/tui/usage-format.ts, covered by test/usage-format.test.ts).
 *
 * Missing is — never n/a (slash wraps into "n/" + leftover "a").
 * Money is always two decimals. usedTokens stay on the typed field, not display cells.
 * Probe tokens are ok|cap|none|stale|err — not sentences or plan-doc placeholders.
 */
import { expect, test } from "bun:test"
import {
  MISSING_CELL,
  finiteOrNull,
  fmtMoney,
  formatCacheTable,
  shortProbe,
} from "../usage/usage-collector.ts"
import { formatUsageTable, usageSummaryLine, quotaSummaryLine } from "../usage/usage-lib.ts"

const DASH = "\u2014"

function win(label: string, opts: {
  used?: number
  cap?: number | null
  pct?: number | null
  usedTokens?: number
  resetsInSeconds?: number | null
  status?: string
}) {
  return {
    label,
    usedTokens: opts.usedTokens ?? 0,
    used: opts.used ?? 0,
    cap: opts.cap === undefined ? null : opts.cap,
    pct: opts.pct === undefined ? null : opts.pct,
    resetsInSeconds: opts.resetsInSeconds === undefined ? null : opts.resetsInSeconds,
    status: opts.status,
  }
}

const grokXaiCache = {
  updated: "2026-08-27T05:37:38.747Z",
  sources: [
    {
      id: "opencode-go",
      windows: [
        win("5h", { used: 3.69, cap: 12, pct: 61, usedTokens: 27753340, resetsInSeconds: 614, status: "ok" }),
        win("7d", { used: 11.16, cap: 30, pct: 100, usedTokens: 109118240, resetsInSeconds: 325339, status: "rate-limited" }),
        win("30d", { used: 12.34, cap: 60, pct: 56, usedTokens: 119534188, resetsInSeconds: 1694086, status: "ok" }),
      ],
      probe: "ok",
      apiCapHit: true,
    },
    {
      id: "grok-sub",
      windows: [
        win("5h", { used: 111.87, cap: null, pct: null, usedTokens: 55076005, resetsInSeconds: 11 }),
        win("7d", { used: 146.28, cap: null, pct: null, usedTokens: 71693909, resetsInSeconds: 573585 }),
        win("30d", { used: 146.28, cap: null, pct: null, usedTokens: 71693909, resetsInSeconds: 2560785 }),
      ],
      probe: "ok",
      probeDetail: "proxy alive; no usage/limit endpoint answered",
    },
    {
      id: "xai",
      kind: "metered",
      windows: [
        win("5h", { used: 0, cap: null, pct: null, usedTokens: 0, resetsInSeconds: null }),
        win("7d", { used: 1.26, cap: null, pct: null, usedTokens: 491620, resetsInSeconds: 533249 }),
        win("30d", { used: 1.26, cap: null, pct: null, usedTokens: 491620, resetsInSeconds: 2520449 }),
      ],
      probe: "none",
    },
    {
      id: "cursor",
      windows: [win("5h", { used: 0, cap: null, usedTokens: 0 })],
      probe: "no endpoint",
    },
  ],
}

function assertNoWrapGarbage(text: string) {
  expect(text).not.toMatch(/n\/a/i)
  expect(text).not.toMatch(/\bn\/\b/)
  expect(text).not.toMatch(/edit me/i)
  expect(text).not.toMatch(/SuperGrok limits/i)
  expect(text).not.toMatch(/usedTokens/i)
  expect(text).not.toMatch(/resets-in/i)
  // `$3.` truncated (no digit after the dot) or `$0.` leftover-a
  expect(text).not.toMatch(/\$\d+\.(?!\d)/)
}

test("fmtMoney is always two decimals, never n/a or truncated $3.", () => {
  expect(fmtMoney(3.69)).toBe("$3.69")
  expect(fmtMoney(12)).toBe("$12.00")
  expect(fmtMoney(111.87)).toBe("$111.87")
  expect(fmtMoney(0)).toBe("$0.00")
  expect(fmtMoney(1.26)).toBe("$1.26")
  expect(fmtMoney(Number.NaN)).toBe(MISSING_CELL)
  expect(fmtMoney(Number.POSITIVE_INFINITY)).toBe(MISSING_CELL)
  expect(MISSING_CELL).toBe(DASH)
})

test("finiteOrNull never stores n/a as a cap", () => {
  expect(finiteOrNull(null)).toBeNull()
  expect(finiteOrNull("n/a")).toBeNull()
  expect(finiteOrNull("n/")).toBeNull()
  expect(finiteOrNull("a")).toBeNull()
  expect(finiteOrNull("unknown")).toBeNull()
  expect(finiteOrNull(12)).toBe(12)
  expect(finiteOrNull(0)).toBe(0)
})

test("shortProbe is a 2-4 char token, never a sentence", () => {
  expect(shortProbe("ok")).toBe("ok")
  expect(shortProbe("no endpoint")).toBe("none")
  expect(shortProbe("error")).toBe("err")
  expect(shortProbe("none")).toBe("none")
  expect(shortProbe(undefined)).toBe("none")
  expect(shortProbe("ok", { capHit: true })).toBe("cap")
  expect(["ok", "cap", "none", "stale", "err"]).toContain(shortProbe("proxy alive; no usage/limit endpoint answered"))
})

test("formatUsageTable is a compact aligned table with emdash for missing cap", () => {
  const table = formatUsageTable(grokXaiCache)
  assertNoWrapGarbage(table)
  expect(table).toMatch(/^Subscription usage  /)
  expect(table).toMatch(/\bsrc\b/)
  expect(table).toMatch(/\bwin\b/)
  expect(table).not.toMatch(/\bprobe\b/)
  expect(table).not.toContain("$3.69")
  expect(table).not.toContain("$12.00")
  expect(table).not.toContain("$111.87")
  expect(table).toContain("$1.26")
  expect(table).toContain(DASH)
  expect(table).not.toMatch(/\bcap\b/)
  expect(table).not.toMatch(/\bok\b/)
  expect(table).not.toMatch(/\bnone\b/)
  const grokLine = table.split("\n").find((l) => l.includes("grok") && l.includes("5h"))
  expect(grokLine).toBeDefined()
  expect(grokLine).toContain(DASH)
  expect(grokLine).not.toMatch(/n\/a/)
  const xaiLine = table.split("\n").find((l) => l.includes("xai") && l.includes("7d"))
  expect(xaiLine).toBeDefined()
  expect(xaiLine).toContain("$1.26")
  expect(xaiLine).toContain(DASH)
  expect(table).not.toMatch(/\b55076005\b/)
  expect(table).not.toMatch(/\b27753340\b/)
  expect(table).not.toMatch(/proxy alive/)
  expect(table).not.toMatch(/no usage\/limit/)
})

test("formatCacheTable matches the same cell contract", () => {
  const table = formatCacheTable(grokXaiCache)
  assertNoWrapGarbage(table)
  expect(table).not.toContain("$111.87")
  expect(table).toContain("$1.26")
  expect(table).toContain(DASH)
  expect(table.split("\n")[0]).toMatch(/src\s+win\s+pct\s+reset/)
  const widths = table.split("\n").map((l) => l.length)
  expect(Math.max(...widths)).toBeLessThanOrEqual(52)
})

test("usageSummaryLine skips empty n/a windows and keeps 2-decimal money", () => {
  const line = usageSummaryLine(grokXaiCache)
  assertNoWrapGarbage(line)
  expect(line).toMatch(/go 5h 61%/)
  expect(line).toMatch(/7d CAP 100%/)
  expect(line).toMatch(/grok 5h 11s/)
  expect(line).not.toMatch(/5h n\/a/)
  expect(line).not.toMatch(/cursor/)
})

test("usageSummaryLine tags 5h CAP without fake Go money", () => {
  const both = usageSummaryLine({
    updated: new Date().toISOString(),
    sources: [
      {
        id: "opencode-go",
        windows: [
          win("5h", { used: 12, cap: 12, pct: 100, status: "rate-limited" }),
          win("7d", { used: 30, cap: 30, pct: 100, status: "rate-limited" }),
        ],
      },
    ],
  })
  expect(both).toMatch(/5h 100% CAP/)
  expect(both).not.toContain("$12.00")
  expect(both).toMatch(/7d CAP 100%/)
})

test("old cache probe 'no endpoint' displays as none, not a wrapping sentence", () => {
  const table = formatUsageTable(grokXaiCache)
  const cursorLine = table.split("\n").find((l) => l.includes("cursor"))
  expect(cursorLine).toBeDefined()
  expect(cursorLine).toContain(DASH)
  expect(cursorLine).not.toMatch(/no endpoint/)
})


test("quotaSummaryLine skips unknown sources and reports remaining", () => {
  const line = quotaSummaryLine({
    updated: new Date().toISOString(),
    sources: [
      { id: "codex", probe: "none", windows: [{ label: "7d", usedTokens: 0, used: 0, cap: null, pct: null, remaining: null, resetsInSeconds: null }] },
      { id: "openai", probe: "ok", windows: [{ label: "7d", usedTokens: 1, used: 1, cap: null, pct: 37, remaining: 63, resetsInSeconds: 100, status: "ok", provenance: "provider-observed" }] },
    ],
  })
  expect(line).toContain("openai 7d 37% 63% left ok")
  expect(line).not.toContain("codex")
})
