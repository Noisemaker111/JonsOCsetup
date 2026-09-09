import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { packageReadme } from "./plugin-package"
const out = join(process.cwd(), ".candidates", "repos")
const repos = JSON.parse(readFileSync(join(out, "repos.json"), "utf8"))
for (const repo of repos) {
  const directory = join(out, repo.name)
  const spec = JSON.parse(readFileSync(join(directory, "plugin.json"), "utf8"))
  writeFileSync(join(directory, "README.md"), packageReadme(spec))
  console.log(`${repo.name}: README generated from owned manifest`)
}
