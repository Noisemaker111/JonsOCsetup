import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { call, type User } from './api'

const code = 'rounded bg-muted px-1 font-mono text-xs'

export function LinkPage({ code: initial, user, done }: { code: string; user: User; done: (machine: string) => void }) {
  const [typed, setTyped] = useState(initial)
  const [found, setFound] = useState<{ name: string; fingerprint: string }>()
  const [name, setName] = useState('')
  const [failure, setFailure] = useState<string>()
  const complete = typed.replace(/[^0-9a-z]/gi, '').length === 8

  useEffect(() => {
    setFound(undefined); setFailure(undefined)
    if (!complete) return
    call<{ name: string; fingerprint: string }>('/api/link/' + encodeURIComponent(typed)).then(row => { setFound(row); setName(row.name) }, error => setFailure(error.message))
  }, [typed, complete])

  return (
    <main className="mx-auto max-w-lg p-4 pt-10">
      <Card>
        {!found ? <>
          <CardHeader>
            <CardTitle>Link a computer</CardTitle>
            <CardDescription>On the computer that runs your Quest Giver, run <code className={code}>questgiver link {location.origin}</code>. It opens this page by itself; on a machine without a browser, type the code it prints.</CardDescription>
          </CardHeader>
          <CardContent><Input autoFocus className="h-14 text-center font-mono text-2xl tracking-[.2em]" placeholder="XXXX-XXXX" value={typed} onChange={event => setTyped(event.target.value.toUpperCase())} /></CardContent>
        </> : <>
          <CardHeader>
            <CardTitle>Link {found.name} to {user.email}?</CardTitle>
            <CardDescription>Anyone signed in as {user.email} will be able to run the agent on that computer. Its terminal shows the fingerprint <code className={code}>{found.fingerprint}</code> — if yours shows something else, stop.</CardDescription>
          </CardHeader>
          <CardContent><label className="grid gap-1 text-muted-foreground text-sm">Name<Input className="text-foreground" value={name} onChange={event => setName(event.target.value)} /></label></CardContent>
          <CardFooter className="gap-2">
            <Button onClick={() => call<{ id: string }>(`/api/link/${encodeURIComponent(typed)}/claim`, { method: 'POST', json: { name } }).then(row => done(row.id), error => setFailure(error.message))}>Link this computer</Button>
            <Button variant="outline" onClick={() => setTyped('')}>Not mine</Button>
          </CardFooter>
        </>}
        {failure && <CardContent className="text-destructive text-sm">{failure}</CardContent>}
      </Card>
    </main>
  )
}
