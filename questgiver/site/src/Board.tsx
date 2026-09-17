import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftIcon } from 'lucide-react'
import { MessageResponse } from '@/components/ai-elements/message'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { call, machinePath } from './api'

type Bullet = { group: string; name: string; sentence: string; ask: string }
type Report = { serving?: string; scope: string; counts: Record<string, number>; sections: { group: string; heading: string; bullets: Bullet[] }[] }
type Item = { id: string; title: string }
type Step = { id: string; title: string; detail?: string; state: string; needs: string[]; runs: { model?: string; state?: string }[] }
type Quest = Item & { description: string; state: string; reason?: string; project?: { root?: string }; steps: Step[]; artifacts: { title?: string; url?: string; path?: string }[] }

/** The Quest API asks every write and read alike for an idempotency key; a fresh one per call is a fresh request. */
const quest = <T,>(machine: string, operation: string, input: unknown) =>
  call<T>(machinePath(machine, 'quest', '/api/' + operation), { method: 'POST', json: input, headers: { 'idempotency-key': crypto.randomUUID() } })

/**
 * The board is the Quest service's own report, printed in its order and its words. The service owns
 * the form (`quest/quest-report.ts`), so nothing here regroups, renames or rewrites a bullet.
 */
export function Board({ machine }: { machine: string }) {
  const [report, setReport] = useState<Report>()
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState<string>()
  const [failure, setFailure] = useState<string>()

  const load = useCallback(() => quest<{ report: Report; items: Item[] }>(machine, 'list', { view: 'report' })
    .then(answer => { setReport(answer.report); setItems(answer.items); setFailure(undefined) }, error => setFailure(error.message)), [machine])

  useEffect(() => {
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const source = new EventSource(machinePath(machine, 'quest', '/events'))
    source.onmessage = () => { if (!timer) timer = setTimeout(() => { timer = undefined; void load() }, 300) }
    const focus = () => void load()
    addEventListener('focus', focus)
    return () => { source.close(); clearTimeout(timer); removeEventListener('focus', focus) }
  }, [machine, load])

  if (open) return <QuestView machine={machine} id={open} back={() => { setOpen(undefined); void load() }} />
  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4">
      {failure && <p className="text-destructive text-sm">{failure}</p>}
      {report && (
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
          <span>{report.scope}</span>
          {Object.entries(report.counts).map(([name, count]) => <Badge key={name} variant="secondary">{count} {name}</Badge>)}
          {report.serving && <span>served by {report.serving}</span>}
        </div>
      )}
      {report?.sections.map(section => (
        <Card key={section.group}>
          <CardHeader><CardTitle className="text-muted-foreground text-xs uppercase tracking-widest">{section.heading}</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {section.bullets.map((bullet, index) => {
              const id = items.find(item => item.title === bullet.name)?.id
              return (
                <button key={id ?? index} disabled={!id} onClick={() => setOpen(id)} className="grid w-full gap-1 py-3 text-left first:pt-0 last:pb-0 hover:opacity-80">
                  <span className="font-medium">{bullet.name}</span>
                  <span className="text-sm">{bullet.sentence}</span>
                  <span className={'text-sm ' + (section.group === 'you' ? 'text-primary' : 'text-muted-foreground')}>{bullet.ask}</span>
                </button>
              )
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function QuestView({ machine, id, back }: { machine: string; id: string; back: () => void }) {
  const [row, setRow] = useState<Quest>()
  const [failure, setFailure] = useState<string>()
  const load = useCallback(() => quest<Quest>(machine, 'get', { id }).then(setRow, error => setFailure(error.message)), [machine, id])
  useEffect(() => { void load() }, [load])
  const act = (operation: string) => quest(machine, operation, { id }).then(load, error => setFailure(error.message))

  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4">
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={back}><ArrowLeftIcon />Board</Button>
      {failure && <p className="text-destructive text-sm">{failure}</p>}
      {row && <>
        <Card>
          <CardHeader>
            <CardTitle>{row.title}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{row.state}</Badge>{row.reason}<span className="truncate">{row.project?.root}</span></CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <MessageResponse>{row.description}</MessageResponse>
            <div className="flex gap-2"><Button onClick={() => act('start')}>Start</Button><Button variant="outline" onClick={() => act('archive')}>Archive</Button></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-muted-foreground text-xs uppercase tracking-widest">Steps</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {row.steps.map(step => (
              <div key={step.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <Badge className="h-fit shrink-0" variant={step.state === 'done' || step.state === 'completed' ? 'default' : step.state === 'failed' || step.state === 'blocked' ? 'destructive' : 'outline'}>{step.state}</Badge>
                <div className="grid gap-1"><span>{step.title}</span>{step.detail && <span className="text-muted-foreground text-sm">{step.detail}</span>}{step.runs.map((run, index) => <span key={index} className="text-muted-foreground text-xs">{run.model} {run.state}</span>)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
        {!!row.artifacts.length && (
          <Card>
            <CardHeader><CardTitle className="text-muted-foreground text-xs uppercase tracking-widest">Delivered</CardTitle></CardHeader>
            <CardContent className="grid gap-1">{row.artifacts.map((artifact, index) => artifact.url ? <a key={index} className="underline" href={artifact.url} target="_blank" rel="noreferrer">{artifact.title ?? artifact.url}</a> : <span key={index}>{artifact.title ?? artifact.path}</span>)}</CardContent>
          </Card>
        )}
      </>}
    </div>
  )
}
