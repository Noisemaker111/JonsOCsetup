/** Runtime data is shared across immutable plugin generations, never written into them. */
import { join } from "node:path"
import { homedir } from "node:os"
export const SHARED_USAGE_CACHE_FILE = process.env.OPENCODE_USAGE_CACHE_FILE ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "opencode", "usage-cache.json")
export const LEGACY_USAGE_CACHE_FILE = join(process.env.OPENCODE_CONFIG_DIR ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode"), "usage", "usage-cache.json")
