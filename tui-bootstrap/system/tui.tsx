import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { runtimeSource } from "../../scripts/runtime-contract.mjs"

export default await import(pathToFileURL(join(runtimeSource(import.meta.dir), "system/tui-active/system.tsx")).href).then(module => module.default)
