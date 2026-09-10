/** Build distributable plugins from owned manifests, never from private config. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import ts from "typescript"

export type PluginPackage = { schema: 1; name: string; description: string; server: string; tui?: string; assets: string[] }
export type PackagePlan = { spec: PluginPackage; files: string[]; dependencies: Record<string, string> }
const posix = (p: string) => p.replaceAll("\\", "/")
const builtin = new Set(builtinModules)
const sourcePattern = /\.(?:[cm]?[jt]s|tsx|jsx)$/

export function inside(root: string, path: string): string {
  const full = resolve(root, path), rel = relative(resolve(root), full)
  if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) throw new Error(`Path escapes package root: ${path}`)
  return full
}

/** Parse actual imports, including side effects, re-exports and literal dynamic imports. */
export function importsOf(file: string, source: string): string[] {
  const imports = new Set<string>()
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text)
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) imports.add(node.moduleReference.expression.text)
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) imports.add(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const jsx = source.match(/@jsxImportSource\s+(\S+)/)?.[1]
  if (jsx) imports.add(jsx)
  return [...imports]
}

export function relativeTarget(root: string, file: string, specifier: string): string {
  const stem = posix(join(dirname(file), specifier))
  for (const candidate of [stem, ...[".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"].map(ext => stem + ext)]) {
    const full = inside(root, candidate)
    if (existsSync(full) && statSync(full).isFile()) {
      inside(realpathSync(root), realpathSync(full))
      return candidate
    }
  }
  throw new Error(`Unresolved import: ${file} -> ${specifier}`)
}

export function planPackage(root: string, spec: PluginPackage): PackagePlan {
  if (spec.schema !== 1 || !/^opencode-[a-z-]+$/.test(spec.name) || !spec.server || !Array.isArray(spec.assets)) throw new Error("Invalid plugin manifest")
  const files = new Set<string>(), dependencies: Record<string, string> = {}
  const visit = (file: string) => {
    file = posix(relative(resolve(root), inside(root, file)))
    // Distribution inputs are source/assets only, never credentials, config, state or build output.
    if (!/^(?:usage|quest|models|papercut|harnesses|orchestration|plugins-active|scripts|project-router)\//.test(file) && !["tui-legacy.ts", "plugin-health.ts"].includes(file)) throw new Error(`Unapproved distribution input: ${file}`)
    if (!/\.(?:[cm]?[jt]s|tsx|jsx|json)$/.test(file)) throw new Error(`Unapproved distribution asset: ${file}`)
    if (file.endsWith(".json") && !["models/model-profiles.json", "usage/usage-plans.json", "usage/usage-plugin.json", "quest/quest.schema.json", "quest/migration/legacy-ledger-report.schema.json"].includes(file)) throw new Error(`Unapproved JSON asset: ${file}`)
    if (files.has(file)) return
    const full = inside(root, file)
    if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`Missing package file: ${file}`)
    inside(realpathSync(root), realpathSync(full))
    files.add(file)
    if (!sourcePattern.test(file)) return
    for (const specifier of importsOf(file, readFileSync(full, "utf8"))) {
      if (specifier.startsWith(".")) { visit(relativeTarget(root, file, specifier)); continue }
      if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier === "bun" || builtin.has(specifier)) continue
      if (isAbsolute(specifier) || specifier.includes(":") || specifier.startsWith("#")) throw new Error(`Nonportable import: ${file} -> ${specifier}`)
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!
      Bun.resolveSync(specifier, dirname(full))
      const manifest = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"))
      dependencies[name] = manifest.version
    }
  }
  for (const file of [spec.server, ...(spec.tui ? [spec.tui] : []), ...spec.assets]) visit(file)
  // Runtime-spawned collectors and filesystem-loaded assets cannot be found in an import graph.
  if (files.has("usage/usage-lib.ts")) for (const f of ["usage/usage-collector.ts", "usage/usage-plans.json", "usage/usage-plugin.json"]) visit(f)
  if (files.has("models/model-router.ts") || files.has("models/model-routing.ts")) visit("models/model-profiles.json")
  return { spec, files: [...files].sort(), dependencies }
}

export function writePackage(root: string, output: string, plan: PackagePlan): void {
  const {spec, files, dependencies} = plan
  if (existsSync(output)) throw new Error(`Refusing to overwrite existing package: ${output}`)
  mkdirSync(output, {recursive:true})
  for (const file of files) { const target = inside(output,file); mkdirSync(dirname(target),{recursive:true}); copyFileSync(inside(root,file),target) }
  const json = (file: string, value: unknown) => writeFileSync(join(output,file),JSON.stringify(value,null,2)+"\n")
  json("package.json", { name:spec.name, version:"0.0.0", private:true, type:"module", description:spec.description, license:"MIT", exports:{".":`./${spec.server}`,...(spec.tui?{"./tui":`./${spec.tui}`}:{})}, dependencies })
  json("plugin.json",spec)
  json("distribution.json",{schema:1,files:files.map(path=>({path,sha256:createHash("sha256").update(readFileSync(join(root,path))).digest("hex")})), policy:"Relative dependencies are vendored from this source revision; no sibling checkout is required."})
  copyFileSync(join(root,"LICENSE"),join(output,"LICENSE"))
  writeFileSync(join(output,".gitignore"),"node_modules\n*.log\n")
  writeFileSync(join(output,"README.md"),packageReadme(spec))
}

export function packageReadme(spec: PluginPackage): string {
  return `# ${spec.name}\n\n${spec.description}.\n\n## Install\n\nRun \`bun install\` in this directory, then add the package directory to\n\`plugins\` in your OpenCode configuration.\n${spec.tui ? `Add this package directory to \`cli.json\` plugins as well; its \`tui.tsx\` shim loads the TUI.\n` : ""}\n## Check\n\nUse the package in the installed OpenCode2 app and inspect the saved result\nafter reopening. The builder checks entrypoint bundling; that does not prove\nproduct behavior.\n\n## Ownership\n\n\`plugin.json\` declares entrypoints and runtime assets. \`distribution.json\`\nrecords every shipped source and its hash. Relative dependencies are vendored\nfrom the same source revision; no sibling repository layout is assumed.\nThe maintained source is the owner's directory in the public JonsOCsetup repository.\nThese outputs are local packages, not independent repositories.\n\nUser configuration, account credentials, Quest ledgers and runtime state are\nnot distributed. Quest storage defaults to \`~/.opencode/quests\`;\n\`OPENCODE_QUEST_ROOT\` explicitly overrides the ledger's project root.\n\n## License\n\nMIT\n`
}

export async function buildPackages(root: string, output = join(root,".candidates/repos")) {
  const config = JSON.parse(readFileSync(join(root,"plugin-set.json"),"utf8"))
  const plans = config.packages.map((file:string)=>planPackage(root,JSON.parse(readFileSync(inside(root,file),"utf8")))) as PackagePlan[]
  if (new Set(plans.map(plan=>plan.spec.name)).size !== plans.length) throw new Error("Duplicate plugin package name")
  const candidateRoot=join(root,".candidates")
  inside(candidateRoot,output)
  const staging=join(candidateRoot,`packages-${randomUUID()}`)
  // Finish and validate all packages before touching the prior staging output.
  for(const plan of plans) {
    const dest=join(staging,plan.spec.name)
    writePackage(root,dest,plan)
    if(plan.spec.tui) writeFileSync(join(dest,"tui.tsx"),`export { default } from "./${plan.spec.tui}"\n`)
    const built = await Bun.build({entrypoints:[plan.spec.server,...(plan.spec.tui?[plan.spec.tui]:[])].map(file=>join(dest,file)),target:"bun",packages:"external",write:false})
    if(!built.success) throw new AggregateError(built.logs, `Package validation failed: ${plan.spec.name}`)
  }
  writeFileSync(join(staging,"repos.json"),JSON.stringify(plans.map(p=>({name:p.spec.name,blurb:p.spec.description,peers:[]})),null,2)+"\n")
  let backup:string|undefined
  if(existsSync(output)) {
    backup=join(candidateRoot,`repos-backup-${randomUUID()}`)
    renameSync(output,backup)
  }
  try { renameSync(staging,output) } catch(error) { if(backup) renameSync(backup,output); throw error }
  // Preserve mirror Git history while retaining every old working file in the backup.
  if(backup) for(const p of plans) {
    const git=join(backup,p.spec.name,".git")
    if(existsSync(git)) renameSync(git,join(output,p.spec.name,".git"))
  }
  return {output,backup,packages:plans.map(p=>({name:p.spec.name,files:p.files.length,dependencies:p.dependencies}))}
}
