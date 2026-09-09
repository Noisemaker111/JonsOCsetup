import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

test("Quest redesign renders navigation, search, scroll ownership and review order", () => {
  const result=spawnSync(process.execPath,["--preload","@opentui/solid/preload","scripts/quest-redesign-render-check.tsx"],{cwd:join(import.meta.dir,".."),encoding:"utf8",windowsHide:true,timeout:45000})
  expect(result.stderr).toBe("")
  expect(result.status).toBe(0)
  expect(result.stdout).toContain("QUEST_REDESIGN_RENDER_OK")
},50000)
