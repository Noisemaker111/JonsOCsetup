import { parseArgs } from 'node:util'
import { buildUpdateReport, renderUpdateReport } from '../project-router/update-report.mjs'

try {
  const { values } = parseArgs({ options: {
    format: { type: 'string', default: 'markdown' }, channel: { type: 'string' },
    receipt: { type: 'string' }, 'config-root': { type: 'string' }, 'cache-dir': { type: 'string' },
    offline: { type: 'boolean' }, refresh: { type: 'boolean' }, help: { type: 'boolean' },
  } })
  if (values.help) console.log('runtime:update-report [--format markdown|json] [--channel latest|beta] [--receipt launch.json] [--config-root installed-config] [--cache-dir path] [--offline] [--refresh]\nReads running-host launch evidence and the shared executable resolver. Reports only; never updates the host or plugins.')
  else {
    if (!['markdown', 'json'].includes(values.format)) throw Error('Choose markdown or json output')
    if (values.offline && values.refresh) throw Error('--offline and --refresh are mutually exclusive')
    const report = await buildUpdateReport({ ...values, configRoot: values['config-root'], cacheDir: values['cache-dir'] })
    console.log(values.format === 'json' ? JSON.stringify(report, null, 2) : renderUpdateReport(report))
  }
} catch (error) {
  console.error(`OpenCode2 update report failed: ${error.message}`)
  process.exitCode = 1
}
