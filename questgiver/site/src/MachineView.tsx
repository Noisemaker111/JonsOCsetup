import { useCallback, useEffect, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { call, machinePath, type Machine, type User } from './api'
import { Board } from './Board'
import { Conversation, type Session } from './Conversation'
import { Usage } from './Usage'

const tabs = ['conversation', 'board', 'usage'] as const
type Tab = (typeof tabs)[number]

export function MachineView({ machine, user, home, signOut }: { machine?: Machine; user: User; home: () => void; signOut: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [agents, setAgents] = useState<string[]>([])
  const [agent, setAgent] = useState('')
  const [open, setOpen] = useState<Session>()
  const [search, setSearch] = useState('')
  const [failure, setFailure] = useState<string>()
  const [tab, setTab] = useState<Tab>(() => tabs.find(name => '#' + name === location.hash) ?? 'conversation')
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

  if (!machine) return <main className="grid min-h-dvh place-content-center text-destructive">No such computer.</main>
  const create = () => call<{ data: Session }>(machinePath(machine.id, 'host', '/api/session'), { method: 'POST', json: { agent } }).then(answer => { setOpen(answer.data); setTab('conversation'); load() }, error => setFailure(error.message))

  return (
    <SidebarProvider className="h-dvh">
      <Sidebar>
        <SidebarHeader>
          <button className="flex items-center gap-2 px-2 pt-1 text-left font-semibold" onClick={home}>
            <span className={'size-2 rounded-full ' + (machine.online ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />{machine.name}
          </button>
          <div className="flex gap-2">
            {agents.length > 1 && <Select value={agent} onValueChange={setAgent}><SelectTrigger size="sm" className="min-w-0 flex-1"><SelectValue /></SelectTrigger><SelectContent>{agents.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>}
            <Button size="sm" className="flex-1" disabled={!machine.online || !agent} onClick={create}><PlusIcon />New session</Button>
          </div>
          <SidebarInput placeholder="Search sessions" value={search} onChange={event => setSearch(event.target.value)} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Sessions</SidebarGroupLabel>
            <SidebarGroupContent>
              {failure && <p className="px-2 text-destructive text-xs">{failure}</p>}
              <SidebarMenu>
                {sessions.map(session => (
                  <SidebarMenuItem key={session.id}>
                    <SidebarMenuButton className="h-auto flex-col items-start gap-0" isActive={open?.id === session.id && tab === 'conversation'} onClick={() => { setOpen(session); setTab('conversation') }}>
                      <span className="w-full truncate">{session.title || 'Untitled'}</span>
                      <span className="w-full truncate text-muted-foreground text-xs">{session.agent} · {session.location?.directory?.split(/[\\/]/).slice(-2).join('/')}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-2 px-2 text-muted-foreground text-xs"><span className="min-w-0 flex-1 truncate">{user.email}</span><Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button></div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <Tabs value={tab} onValueChange={value => { setTab(value as Tab); history.replaceState(null, '', '#' + value) }}>
            <TabsList><TabsTrigger value="conversation">Conversation</TabsTrigger><TabsTrigger value="board">Board</TabsTrigger><TabsTrigger value="usage">Usage</TabsTrigger></TabsList>
          </Tabs>
          <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">{tab === 'conversation' ? open?.title : ''}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {!machine.online ? <p className="p-6 text-muted-foreground">This computer is offline. It reconnects by itself when it is back.</p>
            : tab === 'board' ? <Board machine={machine.id} />
            : tab === 'usage' ? <Usage machine={machine.id} />
            : open ? <Conversation key={open.id} machine={machine.id} session={open} />
            : <p className="grid h-full place-content-center text-muted-foreground">Pick a session, or start one.</p>}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
