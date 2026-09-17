import { useCallback, useEffect, useState } from 'react'
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
    <div className="board">
      {failure && <p className="error">{failure}</p>}
      {report && <p className="quiet small">{report.scope} · {Object.entries(report.counts).map(([name, count]) => `${count} ${name}`).join(' · ')}{report.serving ? ' · served by ' + report.serving : ''}</p>}
      {report?.sections.map(section => (
        <section key={section.group}>
          <h3>{section.heading}</h3>
          <ul className="list">
            {section.bullets.map((bullet, index) => {
              const id = items.find(item => item.title === bullet.name)?.id
              return (
                <li key={id ?? index}>
                  <button className="plain grow left" disabled={!id} onClick={() => setOpen(id)}>
                    <strong>{bullet.name}</strong>
                    <div>{bullet.sentence}</div>
                    <div className={section.group === 'you' ? 'ask' : 'quiet'}>{bullet.ask}</div>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
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
    <div className="board">
      <button className="plain quiet left" onClick={back}>← Board</button>
      {failure && <p className="error">{failure}</p>}
      {row && <>
        <h2>{row.title}</h2>
        <p className="quiet small">{row.state} · {row.reason} · {row.project?.root}</p>
        <p className="prose">{row.description}</p>
        <div className="row">
          <button className="button primary" onClick={() => act('start')}>Start</button>
          <button className="button" onClick={() => act('archive')}>Archive</button>
        </div>
        <h3>Steps</h3>
        <ul className="list">
          {row.steps.map(step => (
            <li key={step.id}>
              <span className={'state ' + step.state}>{step.state}</span>
              <div className="grow"><div>{step.title}</div>{step.detail && <div className="quiet small">{step.detail}</div>}{step.runs.map((run, index) => <div key={index} className="quiet small">{run.model} {run.state}</div>)}</div>
            </li>
          ))}
        </ul>
        {!!row.artifacts.length && <><h3>Delivered</h3><ul className="list">{row.artifacts.map((artifact, index) => <li key={index}>{artifact.url ? <a href={artifact.url} target="_blank" rel="noreferrer">{artifact.title ?? artifact.url}</a> : artifact.title ?? artifact.path}</li>)}</ul></>}
      </>}
    </div>
  )
}
