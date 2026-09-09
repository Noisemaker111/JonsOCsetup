import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

test("the face-disclosure convention (model + fast + reasoning level, no ses_ ids in chat) is codified in the model-routing skill and the personal AGENTS.md overlay", () => {
  const skill = readFileSync(join(root, "skills", "model-routing", "SKILL.md"), "utf8")
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8")
  for (const doc of [skill, agents]) {
    expect(doc).toMatch(/reasoning|thinking level/i)
    expect(doc).toMatch(/fast/i)
    expect(doc).toMatch(/ses_/i)
  }
  expect(skill).toMatch(/never labels? a plain\/default variant fast/i)
  expect(agents).toMatch(/say fast only when actually selected/i)
})
