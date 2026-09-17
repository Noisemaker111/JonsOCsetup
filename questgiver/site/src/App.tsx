import { useCallback, useEffect, useState } from 'react'
import { call, type Me } from './api'
import { LinkPage } from './LinkPage'
import { Machines } from './Machines'
import { MachineView } from './MachineView'

/** The few routes there are do not earn a router. */
export function usePath() {
  const [path, setPath] = useState(location.pathname + location.search)
  useEffect(() => { const on = () => setPath(location.pathname + location.search); addEventListener('popstate', on); return () => removeEventListener('popstate', on) }, [])
  const go = useCallback((to: string) => { history.pushState(null, '', to); setPath(to) }, [])
  return [path, go] as const
}

export function App() {
  const [me, setMe] = useState<Me>()
  const [failure, setFailure] = useState<string>()
  const [path, go] = usePath()
  const reload = useCallback(() => call<Me>('/api/me').then(setMe, error => setFailure(error.message)), [])
  // Presence is the one thing that changes without anyone touching the page.
  useEffect(() => { void reload(); const timer = setInterval(reload, 5_000); return () => clearInterval(timer) }, [reload])

  if (failure) return <main className="center"><p className="error">{failure}</p></main>
  if (!me) return <main className="center"><p className="quiet">…</p></main>
  if (!me.user) return (
    <main className="center">
      <h1 className="wordmark">QuestGiver</h1>
      <p className="quiet">Your Quest Giver, from any browser.</p>
      <a className="button primary" href={'/auth/google/start?return=' + encodeURIComponent(path)}>Continue with Google</a>
      {me.google === false && <p className="error">Google sign-in has no client configured on this deployment.</p>}
    </main>
  )

  const url = new URL(path, location.origin)
  const machine = url.pathname.match(/^\/machine\/([a-f0-9-]+)/)?.[1]
  return (
    <>
      <header className="top">
        <button className="wordmark plain" onClick={() => go('/')}>QuestGiver</button>
        <span className="grow" />
        <span className="quiet">{me.user.email}</span>
        <button className="plain" onClick={() => call('/auth/signout', { method: 'POST' }).then(reload)}>Sign out</button>
      </header>
      {url.pathname === '/link' ? <LinkPage code={url.searchParams.get('code') ?? ''} user={me.user} done={id => { void reload(); go('/machine/' + id) }} />
        : machine ? <MachineView machine={me.machines?.find(row => row.id === machine)} />
        : <Machines machines={me.machines ?? []} open={id => go('/machine/' + id)} link={() => go('/link')} changed={reload} />}
    </>
  )
}
