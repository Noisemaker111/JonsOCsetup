import { expect, test } from "bun:test"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { main } from "../scripts/replay-papercuts"
test("offline replay emits sanitized fixture and concise view", () => { const d = mkdtempSync(join(tmpdir(), "replay-")); const out = join(d, "fixture.json"); const src = join(import.meta.dir, "fixtures", "papercut-transcript.json"); const old = console.log, lines: string[] = []; console.log = x => lines.push(x); try { main(["--fixture", src, "--emit-fixture", out, "--keep"]) } finally { console.log = old }; const report = JSON.parse(lines[0]); expect(report.events).toBe(3); expect(report.proposedLinks).toBe(1); expect(report.view_papercuts).toContain("RepoRoot"); expect(JSON.stringify(JSON.parse(readFileSync(out, "utf8")))).not.toContain("https://example.invalid"); rmSync(d, { recursive: true, force: true }) })
