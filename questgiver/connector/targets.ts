import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Target } from '../protocol/frames'
// @ts-ignore -- the Quest client is plain JavaScript with no declarations.
import { discoverQuestAPI } from '../../quest/client.mjs'
import { getAccountUsage } from '../../usage/account-api'

export type Local = { url: string; authorization: string }

/** What the web may reach on each target. Anything else answers 403 on the machine, not at the relay. */
const allowed: Record<Target, RegExp> = {
  // Everything the host serves except its terminals, which need a WebSocket this link does not carry.
  host: /^\/api\/(?!pty\b|experimental\/persistent-pty\b)/,
  quest: /^\/(health|contract|events|api\/[a-z]+)$/,
  usage: /^\/accounts$/,
}
export const permits = (target: Target, path: string) => allowed[target].test(path.split('?')[0])

/** The OpenCode 2 server's own registration: the file its CLI reads to find and authenticate to it. */
function host(): Local {
  const file = process.env.QUESTGIVER_HOST_REGISTRATION ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'opencode/service.json')
  const row = JSON.parse(readFileSync(file, 'utf8')) as { url: string; password: string }
  return { url: row.url, authorization: 'Basic ' + Buffer.from('opencode:' + row.password).toString('base64') }
}

let quest: Promise<Local> | undefined
const discoverQuest = () => quest ??= (discoverQuestAPI() as Promise<{ url: string; token: string }>)
  .then(endpoint => ({ url: endpoint.url, authorization: 'Bearer ' + endpoint.token }))
  .catch(error => { quest = undefined; throw error })

/** Both services change port and credential when they restart, so a refused connection re-resolves once. */
export async function resolveLocal(target: 'host' | 'quest', fresh = false): Promise<Local> {
  if (target === 'host') return host()
  if (fresh) quest = undefined
  return discoverQuest()
}

export async function usage(path: string) {
  const refresh = new URLSearchParams(path.split('?')[1] ?? '').has('refresh')
  return Response.json(await getAccountUsage({ refresh }))
}
