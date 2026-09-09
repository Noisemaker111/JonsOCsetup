#!/usr/bin/env bun
// Run: bun ~/.agents/scripts/check-personal-harness.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const root = resolve(homedir(), ".agents");
const skillsRoot = resolve(root, "skills");
const names = readdirSync(skillsRoot).filter((name) => existsSync(resolve(skillsRoot, name, "SKILL.md")));
const MAX_DESCRIPTION = 220;
for (const name of names) {
  const source = readFileSync(resolve(skillsRoot, name, "SKILL.md"), "utf8");
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(frontmatter, `${name}: missing skill frontmatter`);
  const metadata = Bun.YAML.parse(frontmatter[1]);
  assert.equal(metadata.name, name);
  assert.equal(typeof metadata.description, "string");
  assert.ok(metadata.description.length > 30, `${name}: needs a discriminating discovery description`);
  assert.ok(metadata.description.length <= MAX_DESCRIPTION, `${name}: description is ${metadata.description.length} chars; keep under ${MAX_DESCRIPTION} so discovery does not truncate it`);
  assert.notEqual(metadata["disable-model-invocation"], true, `${name}: manual-only discovery; park it in skills-disabled or enable implicit invocation`);
  const yamlPath = resolve(skillsRoot, name, "agents/openai.yaml");
  if (existsSync(yamlPath)) {
    const ui = Bun.YAML.parse(readFileSync(yamlPath, "utf8"));
    if (ui?.policy && "allow_implicit_invocation" in ui.policy) {
      assert.equal(ui.policy.allow_implicit_invocation, true, `${name}: UI policy disagrees with skill discovery`);
    }
  }
}
for (const path of [resolve(homedir(), ".codex/AGENTS.md"), resolve(homedir(), ".config/opencode/AGENTS.md")]) {
  const source = readFileSync(path, "utf8");
  assert.ok(source.includes(".agents/matt-pocock.md"), `${path}: shared selection policy pointer missing`);
  assert.ok(source.length < 6000, `${path}: global instructions are ${source.length} bytes; keep the always-loaded overlay small`);
}
console.log(`${names.length} active skills have short, implicit-invocable descriptions; both global overlays are small and reference the shared selection policy. This checks configuration, not a live model's routing behavior.`);
