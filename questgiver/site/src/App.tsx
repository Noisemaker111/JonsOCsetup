import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

  if (failure) return <main className="grid min-h-dvh place-content-center text-destructive">{failure}</main>
  if (!me) return <main className="min-h-dvh" />
  if (!me.user) return (
    <main className="grid min-h-dvh place-content-center p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader><CardTitle className="text-2xl">QuestGiver</CardTitle><CardDescription>Your Quest Giver, from any browser.</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          <Button asChild size="lg"><a href={'/auth/google/start?return=' + encodeURIComponent(path)}>Continue with Google</a></Button>
          {me.google === false && <p className="text-destructive text-sm">Google sign-in has no client configured on this deployment.</p>}
        </CardContent>
      </Card>
    </main>
  )

  const user = me.user
  const signOut = () => void call('/auth/signout', { method: 'POST' }).then(reload)
  const url = new URL(path, location.origin)
  const machine = url.pathname.match(/^\/machine\/([a-f0-9-]+)/)?.[1]
  if (machine) return <MachineView machine={me.machines?.find(row => row.id === machine)} user={user} home={() => go('/')} signOut={signOut} />
  return (
    <>
      <header className="flex h-12 items-center gap-3 border-b px-4">
        <button className="font-semibold" onClick={() => go('/')}>QuestGiver</button>
        <span className="flex-1" />
        <span className="hidden text-muted-foreground text-sm sm:inline">{user.email}</span>
        <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
      </header>
      {url.pathname === '/link'
        ? <LinkPage code={url.searchParams.get('code') ?? ''} user={user} done={id => { void reload(); go('/machine/' + id) }} />
        : <Machines machines={me.machines ?? []} open={id => go('/machine/' + id)} link={() => go('/link')} changed={reload} />}
    </>
  )
}
