import { useCallback, useEffect, useState } from 'react'
import { call, machinePath, type Machine } from './api'
import { Board } from './Board'
import { Conversation, type Session } from './Conversation'
import { Usage } from './Usage'

const tabs = ['Conversation', 'Board', 'Usage'] as const

export function MachineView({ machine }: { machine?: Machine }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [agents, setAgents] = useState<string[]>([])
  const [agent, setAgent] = useState('')
  const [open, setOpen] = useState<Session>()
  const [search, setSearch] = useState('')
  const [failure, setFailure] = useState<string>()
  const [tab, setTab] = useState<(typeof tabs)[number]>(() => tabs.find(name => '#' + name.toLowerCase() === location.hash) ?? 'Conversation')
  const id = machine?.id, online = machine?.online

  const load = useCallback(() => {
    if (!id) return
    call<{ data: Session[] }>(machinePath(id, 'host', '/api/session?limit=40' + (search ? '&search=' + encodeURIComponent(search) : ''))).then(answer => { setSessions(answer.data); setFailure(undefined) }, error => setFailure(error.message))
  }, [id, search])

  // A request refused while the computer was offline never retries by itself, so presence restarts it.
  useEffect(() => { if (online) load() }, [online, load])
  useEffect(() => {
    if (!id || !online) return
    call<{ data: { id: string; mode?: string; hidden?: boolean }[] }>(machinePath(id, 'host', '/api/agent')).then(answer => {
      const names = answer.data.filter(row => row.mode !== 'subagent' && !row.hidden).map(row => row.id)
      setAgents(names); setAgent(current => current || (names.includes('quest-giver') ? 'quest-giver' : names[0] ?? ''))
    }, () => {})
  }, [id, online])

  if (!machine) return <main className="narrow"><p className="error">No such computer.</p></main>
  const create = () => call<{ data: Session }>(machinePath(machine.id, 'host', '/api/session'), { method: 'POST', json: { agent } }).then(answer => { setOpen(answer.data); load() }, error => setFailure(error.message))
  return (
    <div className="machine">
    <nav className="tabs"><span className="name"><span className={'dot ' + (machine.online ? 'on' : 'off')} />{machine.name}</span>{tabs.map(name => <button key={name} className={'plain' + (tab === name ? ' current' : '')} onClick={() => { setTab(name); history.replaceState(null, '', '#' + name.toLowerCase()) }}>{name}</button>)}</nav>
    <main className={'workspace' + (tab !== 'Conversation' ? ' solo' : open ? ' reading' : '')}>
      <aside className="sessions">
                {!machine.online && <p className="quiet">This computer is offline. It reconnects by itself when it is back.</p>}
        <div className="row">
          <select value={agent} onChange={event => setAgent(event.target.value)}>{agents.map(name => <option key={name}>{name}</option>)}</select>
          <button className="button primary grow" disabled={!machine.online || !agent} onClick={create}>New session</button>
        </div>
        <input placeholder="Search sessions" value={search} onChange={event => setSearch(event.target.value)} />
        {failure && <p className="error">{failure}</p>}
        <ul className="list">
          {sessions.map(session => (
            <li key={session.id} className={open?.id === session.id ? 'selected' : ''}>
              <button className="plain grow left" onClick={() => setOpen(session)}>
                <div className="title">{session.title || 'Untitled'}</div>
                <div className="quiet small">{session.agent} · {session.location?.directory?.split(/[\\/]/).slice(-2).join('/')}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {tab !== 'Conversation' ? <div className="pane scroll">{machine.online && (tab === 'Board' ? <Board machine={machine.id} /> : <Usage machine={machine.id} />)}</div>
        : open ? <div className="pane"><button className="plain quiet back" onClick={() => setOpen(undefined)}>← Sessions</button><Conversation key={open.id} machine={machine.id} session={open} /></div>
        : <div className="pane empty quiet">Pick a session, or start one.</div>}
    </main>
    </div>
  )
}
