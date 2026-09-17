import { useEffect, useState } from 'react'
import { call, machinePath, type Machine } from './api'

type Session = { id: string; title?: string; agent?: string; time?: { updated?: number | string } }

/** First proof of the link: the host's own session list and its live event stream, through the relay. */
export function MachineView({ machine }: { machine?: Machine }) {
  const [sessions, setSessions] = useState<Session[]>()
  const [events, setEvents] = useState<string[]>([])
  const [failure, setFailure] = useState<string>()
  const id = machine?.id, online = machine?.online

  useEffect(() => {
    // A stream refused while the computer was offline never retries by itself, so presence restarts it.
    if (!id || !online) return
    setFailure(undefined)
    call<{ data: Session[] }>(machinePath(id, 'host', '/api/session?limit=20')).then(answer => setSessions(answer.data), error => setFailure(error.message))
    const source = new EventSource(machinePath(id, 'host', '/api/event'))
    source.onmessage = event => setEvents(rows => [event.data as string, ...rows].slice(0, 50))
    return () => source.close()
  }, [id, online])

  if (!machine) return <main className="narrow"><p className="error">No such computer.</p></main>
  return (
    <main className="wide">
      <h2><span className={'dot ' + (machine.online ? 'on' : 'off')} /> {machine.name}</h2>
      {!machine.online && <p className="quiet">This computer is offline. It reconnects by itself when it is back.</p>}
      {failure && <p className="error">{failure}</p>}
      <h3>Sessions</h3>
      <ul className="list">{sessions?.map(session => <li key={session.id}><span className="grow">{session.title ?? session.id}</span><span className="quiet">{session.agent}</span></li>)}</ul>
      <h3>Live events</h3>
      <pre className="events">{events.join('\n')}</pre>
    </main>
  )
}
