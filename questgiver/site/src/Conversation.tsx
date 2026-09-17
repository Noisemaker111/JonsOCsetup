import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { call, machinePath } from './api'

type Part =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; id: string; name: string; state: { status: 'streaming' | 'running' | 'completed' | 'error'; input?: unknown; content?: { type: string; text?: string }[]; error?: { message?: string } | string } }
type Message = { id: string; type: string; text?: string; description?: string; content?: Part[]; agent?: string; model?: { id: string; providerID: string }; time: { created: number; completed?: number }; retry?: { attempt: number; error?: { message?: string } } }
type Queued = { id: string; payload?: { text?: string } }
type Model = { id: string; providerID: string; name?: string; enabled?: boolean }
type Permission = { id: string; sessionID: string; action: string; resources: string[]; message?: string }
export type Session = { id: string; title?: string; agent?: string; time?: { updated?: number }; location?: { directory?: string } }

const host = (machine: string, path: string) => machinePath(machine, 'host', path)

/**
 * One session, live.
 *
 * The host publishes fine-grained events (text started, tool called, ...). Folding them is the host
 * UI's job and its reducer is not published, so any event naming this session re-reads the newest
 * page instead. The page is the host's own truth, which keeps this correct across host updates.
 */
export function Conversation({ machine, session }: { machine: string; session: Session }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [active, setActive] = useState(false)
  const [queued, setQueued] = useState<Queued[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [model, setModel] = useState('')
  const [text, setText] = useState('')
  const [failure, setFailure] = useState<string>()
  const scroller = useRef<HTMLDivElement>(null), pinned = useRef(true)

  const refresh = useCallback(async () => {
    const [page, waiting, running, inbox, info] = await Promise.all([
      call<{ data: Message[] }>(host(machine, `/api/session/${session.id}/message?limit=60&order=desc`)),
      call<{ data: Permission[] }>(host(machine, `/api/session/${session.id}/permission`)),
      call<{ data: Record<string, unknown> }>(host(machine, '/api/session/active')),
      call<{ data: Queued[] }>(host(machine, `/api/session/${session.id}/inbox`)),
      call<{ data: { model?: { id: string; providerID: string } } }>(host(machine, `/api/session/${session.id}`)),
    ])
    setQueued(inbox.data ?? [])
    setModel(info.data.model ? info.data.model.providerID + '/' + info.data.model.id : '')
    setMessages(page.data.slice().reverse())
    setPermissions(waiting.data ?? [])
    setActive(session.id in (running.data ?? {}))
  }, [machine, session.id])

  useEffect(() => {
    setMessages([]); pinned.current = true
    refresh().catch(error => setFailure(error.message))
    let timer: ReturnType<typeof setTimeout> | undefined
    const source = new EventSource(host(machine, '/api/event'))
    source.onmessage = event => {
      if (!(event.data as string).includes(session.id)) return
      const parsed = JSON.parse(event.data as string) as { type: string; data?: { error?: { message?: string } } }
      if (parsed.type === 'session.execution.started') setFailure(undefined)
      if (parsed.type === 'session.execution.failed') setFailure(parsed.data?.error?.message ?? 'The turn failed.')
      if (timer) return
      timer = setTimeout(() => { timer = undefined; refresh().catch(error => setFailure(error.message)) }, 150)
    }
    return () => { source.close(); clearTimeout(timer) }
  }, [machine, session.id, refresh])

  useEffect(() => { call<{ data: Model[] }>(host(machine, '/api/model')).then(answer => setModels(answer.data.filter(row => row.enabled !== false)), () => {}) }, [machine])
  const choose = (value: string) => {
    setModel(value)
    const found = models.find(row => row.providerID + '/' + row.id === value)
    if (found) void call(host(machine, `/api/session/${session.id}/model`), { method: 'POST', json: { model: { id: found.id, providerID: found.providerID } } }).then(refresh, error => setFailure(error.message))
  }

  useLayoutEffect(() => { const box = scroller.current; if (box && pinned.current) box.scrollTop = box.scrollHeight }, [messages, permissions, queued])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setText(''); setFailure(undefined); pinned.current = true
    await call(host(machine, `/api/session/${session.id}/prompt`), { method: 'POST', json: { text: body } }).then(refresh, error => { setText(body); setFailure(error.message) })
  }

  return (
    <section className="conversation">
      <div className="messages" ref={scroller} onScroll={event => { const box = event.currentTarget; pinned.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40 }}>
        {messages.map(message => <MessageView key={message.id} message={message} />)}
        {queued.map(item => <div key={item.id} className="bubble user queued">{item.payload?.text}<div className="quiet small">queued</div></div>)}
        {permissions.map(request => (
          <div key={request.id} className="permission">
            <strong>Allow {request.action}?</strong>
            <pre>{request.message ?? request.resources.join('\n')}</pre>
            <div className="row">
              {(['once', 'always', 'reject'] as const).map(reply => (
                <button key={reply} className={'button' + (reply === 'once' ? ' primary' : reply === 'reject' ? ' danger' : '')}
                  onClick={() => call(host(machine, `/api/session/${session.id}/permission/${request.id}/reply`), { method: 'POST', json: { reply } }).then(refresh, error => setFailure(error.message))}>
                  {reply === 'once' ? 'Allow once' : reply === 'always' ? 'Always allow' : 'Reject'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {failure && <p className="error">{failure}</p>}
      <div className="modelbar">
        <input list="models" value={model} placeholder="Model (automatic)" onChange={event => choose(event.target.value)} onFocus={event => event.target.select()} />
        <datalist id="models">{models.map(row => <option key={row.providerID + '/' + row.id} value={row.providerID + '/' + row.id}>{row.name}</option>)}</datalist>
      </div>
      <form className="composer" onSubmit={event => { event.preventDefault(); void send() }}>
        <textarea value={text} rows={Math.min(8, text.split('\n').length)} placeholder={active ? 'Working… what you send is queued for it' : 'Message the ' + (session.agent ?? 'agent')}
          onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} />
        {active && <button type="button" className="button danger" onClick={() => call(host(machine, `/api/session/${session.id}/interrupt`), { method: 'POST' }).then(refresh, error => setFailure(error.message))}>Stop</button>}
        <button className="button primary">Send</button>
      </form>
    </section>
  )
}

function MessageView({ message }: { message: Message }) {
  if (message.type === 'user') return <div className="bubble user">{message.text}</div>
  if (message.type === 'synthetic') return <details className="aside"><summary>{message.description ?? 'Delivered to the agent'}</summary><pre>{message.text}</pre></details>
  if (message.type !== 'assistant') return null
  return (
    <div className="assistant">
      {message.content?.map((part, index) =>
        part.type === 'text' ? <div key={index} className="prose">{part.text}</div>
        : part.type === 'reasoning' ? <details key={index} className="aside"><summary>Thinking</summary><div className="prose">{part.text}</div></details>
        : <details key={index} className={'tool ' + part.state.status}>
            <summary><span className="name">{part.name}</span> <span className="quiet">{summarize(part.state.input)}</span> {part.state.status !== 'completed' && <em>{part.state.status}</em>}</summary>
            <pre>{JSON.stringify(part.state.input, null, 2)}</pre>
            <pre>{part.state.status === 'error' ? (typeof part.state.error === 'string' ? part.state.error : part.state.error?.message) : part.state.content?.map(row => row.text).join('\n')}</pre>
          </details>)}
      {message.retry && !message.time.completed && <p className="error">Retrying (attempt {message.retry.attempt}): {message.retry.error?.message}</p>}
      {message.time.completed && <div className="byline quiet">{message.agent} · {message.model?.providerID}/{message.model?.id}</div>}
    </div>
  )
}

/** The one input field a reader wants on the closed row: the command, the path, the pattern. */
function summarize(input: unknown) {
  if (!input || typeof input !== 'object') return ''
  const row = input as Record<string, unknown>
  const value = row.command ?? row.path ?? row.filePath ?? row.pattern ?? row.query ?? row.url ?? row.description ?? Object.values(row)[0]
  return typeof value === 'string' ? value : ''
}
