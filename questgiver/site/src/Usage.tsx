import { useCallback, useEffect, useState } from 'react'
import { RefreshCwIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { call, machinePath } from './api'

type Window = { id: string; label: string; usedPercent: number | null; resetAt?: string | null }
type Account = { id: string; provider: string; plan?: { name?: string } | null; windows: Window[]; error?: { message?: string } | string | null; freshness?: { stale?: boolean } }

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
    <div className="mx-auto grid max-w-3xl gap-4 p-4">
      <div className="flex items-center"><h2 className="flex-1 font-semibold text-lg">Usage</h2><Button variant="outline" size="sm" onClick={() => void load(true)}><RefreshCwIcon />Refresh</Button></div>
      {failure && <p className="text-destructive text-sm">{failure}</p>}
      {accounts?.map(account => (
        <Card key={account.id}>
          <CardHeader className="flex flex-row items-center gap-2">
            <CardTitle>{account.provider}</CardTitle>
            {account.plan?.name && <Badge variant="secondary">{account.plan.name}</Badge>}
            {account.windows.some(window => (window.usedPercent ?? 0) >= 100) && <Badge variant="destructive">spent</Badge>}
            {account.freshness?.stale && <Badge variant="outline">stale</Badge>}
          </CardHeader>
          <CardContent className="grid gap-3">
            {account.error && <p className="text-destructive text-sm">{typeof account.error === 'string' ? account.error : account.error.message}</p>}
            {account.windows.filter(window => window.usedPercent !== null).map(window => (
              <div key={window.id} className="grid grid-cols-[4rem_1fr_3rem] items-center gap-x-3 text-sm sm:grid-cols-[5rem_1fr_3rem_8rem]">
                <span>{window.label}</span>
                <Progress value={Math.min(100, window.usedPercent ?? 0)} className={(window.usedPercent ?? 0) >= 90 ? '[&>*]:bg-destructive' : ''} />
                <span className="text-right tabular-nums">{window.usedPercent}%</span>
                <span className="col-start-2 col-end-4 text-muted-foreground text-xs sm:col-auto">{until(window.resetAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
