import { useCallback, useEffect, useState } from 'react'
import { call, machinePath } from './api'

type Window = { id: string; label: string; usedPercent: number | null; resetAt?: string | null; state?: string }
type Account = { id: string; provider: string; plan?: { name?: string } | null; windows: Window[]; state?: string; error?: { message?: string } | string | null; freshness?: { stale?: boolean; ageSeconds?: number } }

const until = (time?: string | null) => {
  if (!time) return ''
  const minutes = Math.round((Date.parse(time) - Date.now()) / 60000)
  return minutes <= 0 ? 'resetting' : minutes < 60 ? `resets in ${minutes} min` : minutes < 2880 ? `resets in ${Math.round(minutes / 60)} h` : `resets in ${Math.round(minutes / 1440)} d`
}

export function Usage({ machine }: { machine: string }) {
  const [accounts, setAccounts] = useState<Account[]>()
  const [failure, setFailure] = useState<string>()
  const load = useCallback((refresh = false) => call<{ accounts: Account[] }>(machinePath(machine, 'usage', '/accounts' + (refresh ? '?refresh' : '')))
    .then(answer => { setAccounts(answer.accounts); setFailure(undefined) }, error => setFailure(error.message)), [machine])
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 60_000); return () => clearInterval(timer) }, [load])

  return (
    <div className="board">
      <div className="row"><h2 className="grow">Usage</h2><button className="button" onClick={() => void load(true)}>Refresh</button></div>
      {failure && <p className="error">{failure}</p>}
      {accounts?.map(account => (
        <section key={account.id} className="account">
          <div className="row"><strong>{account.provider}</strong><span className="quiet">{account.plan?.name}</span><span className="grow" />{account.freshness?.stale && <span className="quiet small">stale</span>}</div>
          {account.error && <p className="error small">{typeof account.error === 'string' ? account.error : account.error.message}</p>}
          {account.windows.filter(window => window.usedPercent !== null).map(window => (
            <div key={window.id} className="meter">
              <span className="label">{window.label}</span>
              <span className="bar"><span style={{ width: Math.min(100, window.usedPercent ?? 0) + '%' }} className={(window.usedPercent ?? 0) >= 90 ? 'hot' : ''} /></span>
              <span className="value">{window.usedPercent}%</span>
              <span className="quiet small reset">{until(window.resetAt)}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
