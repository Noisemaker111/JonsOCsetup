import { useEffect, useState } from 'react'
import { call, type User } from './api'

export function LinkPage({ code: initial, user, done }: { code: string; user: User; done: (machine: string) => void }) {
  const [code, setCode] = useState(initial)
  const [found, setFound] = useState<{ name: string; fingerprint: string }>()
  const [name, setName] = useState('')
  const [failure, setFailure] = useState<string>()
  const complete = code.replace(/[^0-9a-z]/gi, '').length === 8

  useEffect(() => {
    setFound(undefined); setFailure(undefined)
    if (!complete) return
    call<{ name: string; fingerprint: string }>('/api/link/' + encodeURIComponent(code)).then(row => { setFound(row); setName(row.name) }, error => setFailure(error.message))
  }, [code, complete])

  return (
    <main className="narrow">
      <h2>Link a computer</h2>
      {!found && <>
        <p className="quiet">On the computer that runs your Quest Giver, run <code>questgiver link {location.origin}</code>. It opens this page by itself; on a machine without a browser, type the code it prints.</p>
        <input className="code" autoFocus placeholder="XXXX-XXXX" value={code} onChange={event => setCode(event.target.value.toUpperCase())} />
      </>}
      {found && <>
        <p>Link <strong>{found.name}</strong> to <strong>{user.email}</strong>?</p>
        <p className="quiet">Anyone signed in as {user.email} will be able to run the agent on that computer. Its terminal shows the fingerprint <code>{found.fingerprint}</code> — if yours shows something else, stop.</p>
        <label className="field">Name<input value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="row">
          <button className="button primary" onClick={() => call<{ id: string }>(`/api/link/${encodeURIComponent(code)}/claim`, { method: 'POST', json: { name } }).then(row => done(row.id), error => setFailure(error.message))}>Link this computer</button>
          <button className="button" onClick={() => setCode('')}>Not mine</button>
        </div>
      </>}
      {failure && <p className="error">{failure}</p>}
    </main>
  )
}
