export type User = { id: string; email: string; name: string; picture: string | null }
export type Machine = { id: string; name: string; created: number; lastSeen: number | null; online: boolean }
export type Me = { user: User | null; machines?: Machine[]; google?: boolean }

export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message) } }

export async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.json !== undefined) headers.set('content-type', 'application/json')
  const answer = await fetch(path, { ...init, headers, body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body })
  if (answer.status === 204) return undefined as T
  const value = await answer.json().catch(() => ({}))
  if (!answer.ok) throw new ApiError(answer.status, value.code ?? 'FAILED', value.message ?? `Request failed (${answer.status})`)
  return value as T
}

/** Everything on a linked computer is reached under its own prefix; the relay carries it across. */
export const machinePath = (machine: string, target: 'host' | 'quest' | 'usage', path: string) => `/m/${machine}/${target}${path}`
