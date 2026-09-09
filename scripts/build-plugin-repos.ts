import { buildPackages } from "./plugin-package"
console.log(JSON.stringify(await buildPackages(process.cwd()), null, 2))
