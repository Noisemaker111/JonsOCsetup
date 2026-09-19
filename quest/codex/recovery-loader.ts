/** Executable entry point. Runtime code imports recovery-loader-lib so this CLI
 * cannot become the hook bundle's main module. */
import {loadRecovery} from './recovery-loader-lib'

try{await loadRecovery(process.argv[2],process.argv[3],process.argv[4],process.argv[5])}
catch(error){console.error(error);process.exitCode=1}
