import type { Context, Cleanup } from '@opencode-ai/plugin/v2/promise'
/** Child services share the bootstrap scope, including failed startup cleanup. */
export async function setupServerPlugins(context: Context, plugins: Iterable<() => Promise<{setup:(context:Context)=>Promise<Cleanup|void>|Cleanup|void}>>, loaded: () => void) {
  const cleanups: Cleanup[] = []
  const dispose = async () => {
    const failures: unknown[] = []
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { await cleanup() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Server plugin cleanup failed')
  }
  try {
    for (const load of plugins) {
      const plugin = await load()
      const cleanup = await plugin.setup(context)
      if (cleanup) cleanups.push(cleanup)
      loaded()
    }
    return dispose
  } catch (error) {
    try { await dispose() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Server plugin setup and cleanup failed')
    }
    throw error
  }
}
