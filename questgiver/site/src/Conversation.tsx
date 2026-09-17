import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckIcon, ShieldQuestionIcon } from 'lucide-react'
import { Conversation as Thread, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { ModelSelector, ModelSelectorContent, ModelSelectorEmpty, ModelSelectorGroup, ModelSelectorInput, ModelSelectorItem, ModelSelectorList, ModelSelectorLogo, ModelSelectorName, ModelSelectorTrigger } from '@/components/ai-elements/model-selector'
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools, type PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { Queue, QueueItem, QueueItemContent, QueueItemIndicator, QueueList, QueueSection, QueueSectionContent, QueueSectionLabel, QueueSectionTrigger } from '@/components/ai-elements/queue'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { call, machinePath } from './api'

type ToolState = { status: 'streaming' | 'running' | 'completed' | 'error'; input?: unknown; content?: { type: string; text?: string }[]; error?: { message?: string } | string }
type Part = { type: 'text'; text: string } | { type: 'reasoning'; text: string; time?: { completed?: number } } | { type: 'tool'; id: string; name: string; state: ToolState }
type ChatMessage = { id: string; type: string; text?: string; description?: string; content?: Part[]; agent?: string; model?: { id: string; providerID: string }; time: { created: number; completed?: number }; retry?: { attempt: number; error?: { message?: string } } }
type Permission = { id: string; action: string; resources: string[]; message?: string }
type Queued = { id: string; payload?: { text?: string } }
type Model = { id: string; providerID: string; name?: string; enabled?: boolean }
type Account = { provider: string; connections?: { routeProviders?: string[] }[]; windows: { label: string; usedPercent: number | null; resetAt?: string | null }[] }
export type Session = { id: string; title?: string; agent?: string; time?: { updated?: number }; location?: { directory?: string } }

const host = (machine: string, path: string) => machinePath(machine, 'host', path)
const toolState = { streaming: 'input-streaming', running: 'input-available', completed: 'output-available', error: 'output-error' } as const

/**
 * One session, live.
 *
 * The host publishes fine-grained events (text started, tool called, ...). Folding them is the host
 * UI's job and its reducer is not published, so any event naming this session re-reads the newest
 * page instead. The page is the host's own truth, which keeps this correct across host updates.
 */
export function Conversation({ machine, session }: { machine: string; session: Session }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [queued, setQueued] = useState<Queued[]>([])
  const [active, setActive] = useState(false)
  const [model, setModel] = useState('')
  const [failure, setFailure] = useState<string>()

  const refresh = useCallback(async () => {
    const [page, waiting, running, inbox, info] = await Promise.all([
      call<{ data: ChatMessage[] }>(host(machine, `/api/session/${session.id}/message?limit=60&order=desc`)),
      call<{ data: Permission[] }>(host(machine, `/api/session/${session.id}/permission`)),
      call<{ data: Record<string, unknown> }>(host(machine, '/api/session/active')),
      call<{ data: Queued[] }>(host(machine, `/api/session/${session.id}/inbox`)),
      call<{ data: { model?: { id: string; providerID: string } } }>(host(machine, `/api/session/${session.id}`)),
    ])
    setMessages(page.data.slice().reverse())
    setPermissions(waiting.data ?? [])
    setActive(session.id in (running.data ?? {}))
    setQueued(inbox.data ?? [])
    setModel(info.data.model ? info.data.model.providerID + '/' + info.data.model.id : '')
  }, [machine, session.id])

  useEffect(() => {
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

  const send = (message: PromptInputMessage) => {
    const text = message.text?.trim()
    if (!text) return
    setFailure(undefined)
    void call(host(machine, `/api/session/${session.id}/prompt`), { method: 'POST', json: { text } }).then(refresh, error => setFailure(error.message))
  }
  const stop = () => void call(host(machine, `/api/session/${session.id}/interrupt`), { method: 'POST' }).then(refresh, error => setFailure(error.message))
  const reply = (request: Permission, answer: 'once' | 'always' | 'reject') =>
    void call(host(machine, `/api/session/${session.id}/permission/${request.id}/reply`), { method: 'POST', json: { reply: answer } }).then(refresh, error => setFailure(error.message))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Thread className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {!messages.length && <ConversationEmptyState title={session.title || 'New session'} description={'Message the ' + (session.agent ?? 'agent') + ' to begin.'} />}
          {messages.map(message => <MessageView key={message.id} message={message} streaming={active && message === messages.at(-1)} />)}
          {permissions.map(request => (
            <Alert key={request.id}>
              <ShieldQuestionIcon />
              <AlertTitle>Allow {request.action}?</AlertTitle>
              <AlertDescription>
                <pre className="max-h-60 w-full overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{request.message ?? request.resources.join('\n')}</pre>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => reply(request, 'once')}>Allow once</Button>
                  <Button size="sm" variant="outline" onClick={() => reply(request, 'always')}>Always allow</Button>
                  <Button size="sm" variant="destructive" onClick={() => reply(request, 'reject')}>Reject</Button>
                </div>
              </AlertDescription>
            </Alert>
          ))}
          {failure && <Alert variant="destructive"><AlertTitle>The turn did not finish</AlertTitle><AlertDescription>{failure}</AlertDescription></Alert>}
        </ConversationContent>
        <ConversationScrollButton />
      </Thread>

      <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pb-4">
        {!!queued.length && (
          <Queue>
            <QueueSection>
              <QueueSectionTrigger><QueueSectionLabel count={queued.length} label="queued" /></QueueSectionTrigger>
              <QueueSectionContent><QueueList>{queued.map(item => <QueueItem key={item.id}><div className="flex items-center gap-2"><QueueItemIndicator /><QueueItemContent>{item.payload?.text}</QueueItemContent></div></QueueItem>)}</QueueList></QueueSectionContent>
            </QueueSection>
          </Queue>
        )}
        <PromptInput onSubmit={send}>
          <PromptInputBody><PromptInputTextarea placeholder={active ? 'Working… what you send is queued for it' : 'Message the ' + (session.agent ?? 'agent')} /></PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools><ModelPicker machine={machine} value={model} onPick={picked => void call(host(machine, `/api/session/${session.id}/model`), { method: 'POST', json: { model: picked } }).then(refresh, error => setFailure(error.message))} /></PromptInputTools>
            {active ? <PromptInputSubmit status="streaming" type="button" onClick={stop} /> : <PromptInputSubmit status="ready" />}
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}

function MessageView({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  if (message.type === 'user') return <Message from="user"><MessageContent>{message.text}</MessageContent></Message>
  if (message.type === 'synthetic') return <Reasoning defaultOpen={false}><ReasoningTrigger getThinkingMessage={() => message.description ?? 'Delivered to the agent'} /><ReasoningContent>{message.text ?? ''}</ReasoningContent></Reasoning>
  if (message.type !== 'assistant') return null
  return (
    <Message from="assistant">
      <MessageContent>
        {message.content?.map((part, index) =>
          part.type === 'text' ? <MessageResponse key={index}>{part.text}</MessageResponse>
          : part.type === 'reasoning' ? <Reasoning key={index} isStreaming={streaming && !part.time?.completed} defaultOpen={false}><ReasoningTrigger /><ReasoningContent>{part.text}</ReasoningContent></Reasoning>
          : <Tool key={part.id ?? index}>
              <ToolHeader type={`tool-${part.name}`} title={[part.name, summarize(part.state.input)].filter(Boolean).join(' · ')} state={toolState[part.state.status]} />
              <ToolContent>
                <ToolInput input={part.state.input} />
                <ToolOutput output={part.state.content?.map(row => row.text).join('\n')} errorText={part.state.status === 'error' ? (typeof part.state.error === 'string' ? part.state.error : part.state.error?.message) : undefined} />
              </ToolContent>
            </Tool>)}
        {message.retry && !message.time.completed && <Alert variant="destructive"><AlertTitle>Retrying, attempt {message.retry.attempt}</AlertTitle><AlertDescription>{message.retry.error?.message}</AlertDescription></Alert>}
      </MessageContent>
      {message.time.completed && <div className="text-muted-foreground text-xs">{message.agent} · {message.model?.providerID}/{message.model?.id}</div>}
    </Message>
  )
}

/** The one input field a reader wants on the closed row: the command, the path, the pattern. */
function summarize(input: unknown) {
  if (!input || typeof input !== 'object') return ''
  const row = input as Record<string, unknown>
  const value = row.command ?? row.path ?? row.filePath ?? row.pattern ?? row.query ?? row.url ?? row.description ?? Object.values(row)[0]
  return typeof value === 'string' ? value.slice(0, 80) : ''
}

/**
 * Only routes the machine's access policy allows are offered, and a provider whose account has a
 * spent window says so on the row, so nobody learns it from a failed turn.
 */
function ModelPicker({ machine, value, onPick }: { machine: string; value: string; onPick: (model: { id: string; providerID: string }) => void }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<Model[]>([])
  const [routes, setRoutes] = useState<{ providerID: string; modelPattern: string }[]>()
  const [accounts, setAccounts] = useState<Account[]>([])

  useEffect(() => {
    if (!open) return
    call<{ data: Model[] }>(host(machine, '/api/model')).then(answer => setModels(answer.data.filter(row => row.enabled !== false)), () => {})
    call<{ routes: { providerID: string; modelPattern: string }[] }>(machinePath(machine, 'usage', '/policy')).then(answer => setRoutes(answer.routes), () => setRoutes(undefined))
    call<{ accounts: Account[] }>(machinePath(machine, 'usage', '/accounts')).then(answer => setAccounts(answer.accounts), () => {})
  }, [machine, open])

  const spent = useMemo(() => {
    const out = new Map<string, string>()
    for (const account of accounts) {
      const full = account.windows.find(window => (window.usedPercent ?? 0) >= 100)
      if (!full) continue
      for (const provider of [account.provider, ...(account.connections ?? []).flatMap(row => row.routeProviders ?? [])]) out.set(provider, full.label + ' limit spent')
    }
    return out
  }, [accounts])

  const groups = useMemo(() => {
    const allowed = models.filter(row => !routes || routes.some(route => route.providerID === row.providerID && new RegExp('^(?:' + route.modelPattern + ')$').test(row.id)))
    const byProvider = new Map<string, Model[]>()
    for (const row of allowed) byProvider.set(row.providerID, [...(byProvider.get(row.providerID) ?? []), row])
    return [...byProvider].sort(([a], [b]) => Number(spent.has(a)) - Number(spent.has(b)) || a.localeCompare(b))
  }, [models, routes, spent])

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild><PromptInputButton className="w-auto max-w-80"><ModelSelectorName className="flex-none">{value || 'Automatic model'}</ModelSelectorName></PromptInputButton></ModelSelectorTrigger>
      <ModelSelectorContent>
        <ModelSelectorInput placeholder="Search allowed models…" />
        <ModelSelectorList>
          <ModelSelectorEmpty>No allowed model matches.</ModelSelectorEmpty>
          {groups.map(([provider, rows]) => (
            <ModelSelectorGroup key={provider} heading={provider + (spent.has(provider) ? ' — ' + spent.get(provider) : '')}>
              {rows.map(row => (
                <ModelSelectorItem key={provider + '/' + row.id} value={provider + '/' + row.id} onSelect={() => { onPick({ id: row.id, providerID: provider }); setOpen(false) }}>
                  <ModelSelectorLogo provider={provider as never} />
                  <ModelSelectorName>{row.name ?? row.id}</ModelSelectorName>
                  {spent.has(provider) && <Badge variant="destructive">spent</Badge>}
                  {value === provider + '/' + row.id && <CheckIcon className="ml-auto size-4" />}
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  )
}
