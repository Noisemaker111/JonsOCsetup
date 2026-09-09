import { resolveHostExecutable } from '../project-router/executable.mjs'
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

test("restart never deploys dirty source or kills processes by image", () => {
 const source=readFileSync(join(root,"scripts/restart-opencode.ps1"),"utf8")
 expect(source).not.toContain("taskkill.exe")
 expect(source).not.toContain("plugin-deploy.ts")
 expect(source).toContain("This terminal has no owned restart supervisor")
 expect(source).toContain("$PrepareOnly")
 const managed=readFileSync(join(root,"scripts/opencode-runtime.mjs"),"utf8")
 expect(managed).toContain("runtimePrepareArgs(root, true)")
 expect(managed).toContain("prior.kill()")
 expect(managed).toContain("reviewedAgentConfig(root, generation)")
})

test("this machine keeps the v1 and v2 executables visibly distinct", () => {
  const appData = process.env.APPDATA ?? ""
  const v1 = join(appData, "npm", "node_modules", "opencode-ai", "package.json")
  const v2 = join(resolveHostExecutable(), "..", "..", "package.json")
  if (!existsSync(v1) || !existsSync(v2)) return
  expect(JSON.parse(readFileSync(v1, "utf8")).version).toMatch(/^1\./)
  expect(JSON.parse(readFileSync(v2, "utf8")).version).toMatch(/^0\.0\.0-beta-/)
})
test("smoke test rejects an unverified runtime before plugin checks", () => {
  const smoke = readFileSync(join(root, "smoke-test.ps1"), "utf8")
  expect(smoke).toContain("v2 runtime identity")
  expect(smoke).toContain("scripts\\restart-opencode.ps1\") -Status")
})
