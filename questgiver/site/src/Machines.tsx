import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { call, type Machine } from './api'

const ago = (time: number | null) => {
  if (!time) return 'never connected'
  const minutes = Math.round((Date.now() - time) / 60000)
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`
}

export function Machines({ machines, open, link, changed }: { machines: Machine[]; open: (id: string) => void; link: () => void; changed: () => void }) {
  return (
    <main className="mx-auto max-w-2xl p-4 pt-10">
      <Card>
        <CardHeader className="flex flex-row items-center"><CardTitle className="flex-1">Computers</CardTitle><Button variant="outline" onClick={link}>Link a computer</Button></CardHeader>
        <CardContent className="divide-y">
          {!machines.length && <p className="text-muted-foreground">Nothing linked yet. Link the computer or server that runs your Quest Giver.</p>}
          {machines.map(machine => <Row key={machine.id} machine={machine} open={open} changed={changed} />)}
        </CardContent>
      </Card>
    </main>
  )
}

function Row({ machine, open, changed }: { machine: Machine; open: (id: string) => void; changed: () => void }) {
  const [name, setName] = useState<string>()
  const [unlinking, setUnlinking] = useState(false)
  if (name !== undefined) return (
    <form className="flex gap-2 py-3" onSubmit={event => { event.preventDefault(); if (name.trim()) void call(`/api/machines/${machine.id}`, { method: 'PATCH', json: { name } }).then(() => { setName(undefined); changed() }) }}>
      <Input autoFocus value={name} onChange={event => setName(event.target.value)} />
      <Button type="submit">Save</Button>
      <Button type="button" variant="outline" onClick={() => setName(undefined)}>Cancel</Button>
    </form>
  )
  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => open(machine.id)}>
        <span className={'size-2 shrink-0 rounded-full ' + (machine.online ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
        <span className="font-medium">{machine.name}</span>
        <span className="truncate text-muted-foreground text-sm">{machine.online ? 'online' : 'offline · last seen ' + ago(machine.lastSeen)}</span>
      </button>
      {unlinking ? <>
        <span className="text-muted-foreground text-sm">It disconnects now and must be linked again to come back.</span>
        <Button size="sm" variant="destructive" onClick={() => void call(`/api/machines/${machine.id}`, { method: 'DELETE' }).then(changed)}>Unlink</Button>
        <Button size="sm" variant="outline" onClick={() => setUnlinking(false)}>Keep</Button>
      </> : <>
        <Button size="sm" variant="ghost" onClick={() => setName(machine.name)}>Rename</Button>
        <Button size="sm" variant="ghost" onClick={() => setUnlinking(true)}>Unlink</Button>
      </>}
    </div>
  )
}
