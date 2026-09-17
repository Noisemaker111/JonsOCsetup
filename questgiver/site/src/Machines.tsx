import { useState } from 'react'
import { call, type Machine } from './api'

const ago = (time: number | null) => {
  if (!time) return 'never connected'
  const minutes = Math.round((Date.now() - time) / 60000)
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`
}

export function Machines({ machines, open, link, changed }: { machines: Machine[]; open: (id: string) => void; link: () => void; changed: () => void }) {
  return (
    <main className="narrow">
      <div className="row"><h2 className="grow">Computers</h2><button className="button" onClick={link}>Link a computer</button></div>
      {!machines.length && <p className="quiet">Nothing linked yet. Link the computer or server that runs your Quest Giver.</p>}
      <ul className="list">
        {machines.map(machine => (
          <Row key={machine.id} machine={machine} open={open} changed={changed} />
        ))}
      </ul>
    </main>
  )
}

function Row({ machine, open, changed }: { machine: Machine; open: (id: string) => void; changed: () => void }) {
  const [name, setName] = useState<string>()
  const [unlinking, setUnlinking] = useState(false)
  if (name !== undefined) return (
    <li>
      <form className="row grow" onSubmit={event => { event.preventDefault(); if (name.trim()) void call(`/api/machines/${machine.id}`, { method: 'PATCH', json: { name } }).then(() => { setName(undefined); changed() }) }}>
        <input className="grow" autoFocus value={name} onChange={event => setName(event.target.value)} />
        <button className="button primary">Save</button>
        <button type="button" className="button" onClick={() => setName(undefined)}>Cancel</button>
      </form>
    </li>
  )
  return (
    <li>
      <button className="plain grow left" onClick={() => open(machine.id)}>
        <span className={'dot ' + (machine.online ? 'on' : 'off')} /> <strong>{machine.name}</strong>
        <span className="quiet"> {machine.online ? 'online' : 'offline · last seen ' + ago(machine.lastSeen)}</span>
      </button>
      {unlinking ? <>
        <span className="quiet">It disconnects now and must be linked again to come back.</span>
        <button className="button danger" onClick={() => void call(`/api/machines/${machine.id}`, { method: 'DELETE' }).then(changed)}>Unlink</button>
        <button className="button" onClick={() => setUnlinking(false)}>Keep</button>
      </> : <>
        <button className="plain quiet" onClick={() => setName(machine.name)}>Rename</button>
        <button className="plain quiet" onClick={() => setUnlinking(true)}>Unlink</button>
      </>}
    </li>
  )
}
