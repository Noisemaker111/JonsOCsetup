/** @jsxImportSource @opentui/solid */
import {createMemo,createSignal,onCleanup,onMount,For,Show} from 'solid-js'
import {useKeyboard} from '@opentui/solid'
import {readAccountUsage} from '../account-api'
import {getUsageExperience} from '../experience-api'
import type {ExperienceQuery} from '../experience'
import {evidenceNumber,evidenceTime,evidenceSummary,quotaPlot} from '../tui-evidence'

/** Mounted by the real /usage dialog. Reads cached evidence; never changes policy. */
export function UsageEvidencePanel(props:{context:any}){
 const [accounts,setAccounts]=createSignal(readAccountUsage().accounts)
 const [accountIndex,setAccountIndex]=createSignal(0),[poolIndex,setPoolIndex]=createSignal(0)
 const [view,setView]=createSignal<'summary'|'timeline'|'requests'>('summary')
 const [source,setSource]=createSignal<ExperienceQuery['source']>('opencode')
 const [details,setDetails]=createSignal(false)
 const [epochIndex,setEpochIndex]=createSignal(0),[offset,setOffset]=createSignal(0),[revision,setRevision]=createSignal(0)
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone
 const account=()=>accounts()[accountIndex()]
 const pools=()=>account()?.windows??[]
 const pool=()=>pools()[poolIndex()]
 const color=()=>props.context.theme?.current??props.context.theme??{}
 const fg=()=>color().text?.default??color().text??'#d8d4ca'
 const muted=()=>color().text?.muted??color().textMuted??fg()
 const reset=()=>{setOffset(0);setEpochIndex(0)}
 const changeAccount=()=>{setAccountIndex((accountIndex()+1)%Math.max(1,accounts().length));setPoolIndex(0);reset()}
 const changePool=()=>{setPoolIndex((poolIndex()+1)%Math.max(1,pools().length));reset()}
 const changeView=()=>{const next=view()==='summary'?'timeline':view()==='timeline'?'requests':'summary';setView(next);setOffset(next==='timeline'?Math.max(0,(base()?.value?.history.selectedSamples??0)-100):next==='requests'?Math.max(0,(base()?.value?.activity.terminalRequests??0)+(base()?.value?.activity.runningRequests??0)-12):0);setDetails(false)}
 const base=createMemo(()=>{revision();if(!account()||!pool())return undefined;try{return {value:getUsageExperience({accountID:account()!.id,windowID:pool()!.id,source:source(),view:'summary',limit:100,timeZone:zone})}}catch(error){return {error:String(error)}}})
 const epochs=()=>base()?.value?.history.epochs.items??[]
 const data=createMemo(()=>{revision();const summary=base();if(!summary?.value)return summary;try{const epoch=epochs()[epochIndex()];return {value:getUsageExperience({accountID:account()!.id,windowID:pool()!.id,source:source(),view:view(),offset:offset(),limit:view()==='timeline'?100:12,timeZone:zone,...(epoch?{resetAt:epoch.resetAt,regime:epoch.regime}:{})})}}catch(error){return {error:String(error)}}})
 const page=()=>view()==='timeline'?data()?.value?.timeline:data()?.value?.requests
 const next=()=>{const n=page()?.nextOffset;if(n!=null)setOffset(n)}
 const previous=()=>setOffset(Math.max(0,offset()-(page()?.limit??12)))
 const cycleEpoch=()=>{setEpochIndex((epochIndex()+1)%Math.max(1,epochs().length));setOffset(0)}
 const cycleSource=()=>{const sources=['opencode','codex','opencode-host'] as const;setSource(sources[(sources.indexOf(source()!)+1)%sources.length]);setOffset(0)}
 const refresh=()=>{setAccounts(readAccountUsage().accounts);setRevision(revision()+1)}
 useKeyboard(key=>{
  if(key.ctrl||key.meta||key.name==='escape')return
  const action=({a:changeAccount,p:changePool,v:changeView,e:cycleEpoch,s:cycleSource,n:next,b:previous,r:refresh,d:()=>setDetails(!details())} as Record<string,()=>void>)[key.name]
  if(action){key.preventDefault();key.stopPropagation();action()}
 })
 onMount(()=>{const timer=setInterval(refresh,30000);onCleanup(()=>clearInterval(timer))})
 const button=(label:string,action:()=>void)=><text fg={color().primary??fg()} onMouseUp={(event:any)=>{event.stopPropagation?.();action()}}>{label}</text>
 return <box flexDirection="column" gap={1} flexShrink={0}>
  <box flexDirection="row" flexWrap="wrap" gap={2}>{button('[a] Account',changeAccount)}{button('[p] Pool',changePool)}{button('[v] View: '+view(),changeView)}</box>
  <Show when={account()} fallback={<text fg={muted()}>No cached accounts yet. Waiting for the account collector.</text>}>
   <text fg={fg()}>{account()?.provider} · {account()?.plan.name} · {pool()?.label}</text>
   <Show when={data()?.error}><text fg={color().warning??fg()} wrapMode="word">{data()?.error}</text></Show>
   <Show when={data()?.value}>{value=><>
    <Show when={view()==='summary'}><For each={evidenceSummary(value())}>{line=><text fg={fg()} wrapMode="word">{line}</text>}</For></Show>
    <Show when={view()!=='summary'}>
     <box flexDirection="row" flexWrap="wrap" gap={2}>{button('[e] Reset period',cycleEpoch)}{button('[s] Source: '+source(),cycleSource)}</box>
     <text fg={muted()} wrapMode="word">{value().history.current?'Current':'Historical'} reset: {evidenceTime(value().history.selectedEpoch.resetAt,zone)} · {zone}</text>
     <Show when={view()==='timeline'}>
      <For each={quotaPlot(value(),Math.min(90,Number(props.context.renderer?.width??80)-14))}>{line=><text fg={fg()} wrapMode="word">{line}</text>}</For>
      {button(details()?'[d] Hide exact values':'[d] Show exact values',()=>setDetails(!details()))}
      <Show when={details()}><For each={value().timeline?.items??[]}>{point=><text fg={muted()} wrapMode="word">{evidenceTime(point.at,zone)} · {point.usedPoints} used points{point.breakBefore?' · segment start':''}</text>}</For></Show>
      <text fg={muted()} wrapMode="word">{value().history.gapCount} gaps over 5 minutes. Meter precision and reporting delay may be unknown.</text>
     </Show>
     <Show when={view()==='requests'}>
      <text fg={muted()} wrapMode="word">Request counters · independent of account quota; sources may overlap.</text>
      <Show when={(value().requests?.items.length??0)>0} fallback={<text fg={muted()}>No account-bound requests in this source.</text>}>
       <For each={value().requests?.items??[]}>{request=><box flexDirection="column" flexShrink={0}>
        <text fg={fg()} wrapMode="word">{evidenceTime(request.startedAt,zone)} · {request.state} · {request.modelID}</text>
        <text fg={muted()} wrapMode="word">Input {evidenceNumber(request.inputTokens)} · cached {evidenceNumber(request.cacheReadTokens)} · output + reasoning {request.state==='running'?'pending':evidenceNumber(request.outputIncludingReasoning)}</text>
       </box>}</For>
      </Show>
     </Show>
     <box flexDirection="row" flexWrap="wrap" gap={2}>{button('[b] Previous',previous)}{button('[n] Next',next)}<text fg={muted()}>{Math.min(offset()+1,page()?.total??0)}–{Math.min(offset()+(page()?.limit??12),page()?.total??0)} of {page()?.total??0}</text></box>
    </Show>
   </>}</Show>
  </Show>
  <text fg={muted()} wrapMode="word">[r] Reread cache · Esc closes · keys or click to navigate</text>
 </box>
}
