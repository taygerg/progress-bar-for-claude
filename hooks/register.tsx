import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Progress } from '../types'

const IDLE: Progress = { isActive: false, now: 0, total: 0, done: 0, current: '', firstStartAt: 0, lastDoneAt: 0, doneInTurn: 0, workMs: 0 }
const progress = atom({ plugin: 'glass-progress', key: 'progress' } as const, IDLE)

type Task = { id: string; subject: string; status: string }

const W = 520
const H = 26

// Time left: average time per finished step this turn × steps left, minus what the
// current step has already used. No guess before the first step is done here.
// Whole minutes, so the bar only redraws when the text really changes.
function etaText(p: Progress): string {
  if (p.doneInTurn === 0) return 'Restzeit nach dem ersten Schritt'
  const left = (p.workMs / p.doneInTurn) * (p.total - p.done) - (p.now - p.lastDoneAt)
  if (left >= 60_000) return 'noch ca. ' + Math.ceil(left / 60_000) + ' Min.'
  if (left > 0) return 'noch unter 1 Min.'
  return 'dauert länger als geschätzt'
}

function bar(fraction: number | null): string {
  const x = 4
  const y = 7
  const w = W - 8
  const h = 12
  const fw = fraction === null ? 0 : Math.max(h, w * Math.min(1, fraction))
  const kx = x + fw
  const fill =
    fraction === null
      ? `<rect x="${x}" y="${y}" width="120" height="${h}" rx="6" fill="url(#f)" filter="url(#g)">
           <animate attributeName="x" values="${x - 120};${x + w};${x - 120}" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>
         </rect>`
      : `<rect x="${x}" y="${y}" width="${fw}" height="${h}" rx="6" fill="url(#f)" filter="url(#g)">
         </rect>
         <rect x="${x + 4}" y="${y + 1.5}" width="${Math.max(0, fw - 8)}" height="3" rx="1.5" fill="url(#hl)"/>
         <g transform="translate(${kx - 17} 2)">
           <rect width="34" height="22" rx="11" fill="url(#k)" stroke="url(#ks)" stroke-width=".8"/>
           <rect x="6" y="2.5" width="22" height="6" rx="3" fill="#ffffff" opacity=".55"/>
         </g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity=".10"/></linearGradient>
    <linearGradient id="ts" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>
    <linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#eef0ff"/><stop offset="1" stop-color="#c7cdf5"/></linearGradient>
    <linearGradient id="hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".5" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".22"/></linearGradient>
    <linearGradient id="ks" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></linearGradient>
    <filter id="g" x="-20%" y="-150%" width="140%" height="400%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="c"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/></clipPath>
  </defs>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="url(#t)" stroke="url(#ts)" stroke-width=".8"/>
  ${fraction === null ? `<g clip-path="url(#c)">${fill}</g>` : fill}
</svg>`
}

const labels = new Map<string, string>()

// The source of truth: the session's real task list, read straight from TaskList.
// TaskUpdate may run in parallel: an answer never overwrites one that was asked for later.
let syncSeq = 0
let appliedSeq = 0

async function sync($: EngineInterface): Promise<void> {
  const mine = ++syncSeq
  let tasks: Task[] | undefined
  // One retry: a failed read would otherwise leave the bar on an older count.
  for (let attempt = 0; attempt < 2 && !Array.isArray(tasks); attempt++) {
    try {
      const r: any = await $.tool.call({ tool: 'TaskList' })
      tasks = r?.result?.tasks
    } catch {
      tasks = undefined
    }
  }
  if (!Array.isArray(tasks)) return
  const now = await $.clock.now()
  if (mine < appliedSeq) return
  appliedSeq = mine
  const total = tasks.length
  const done = tasks.filter(t => t.status === 'completed').length
  const active = tasks.find(t => t.status === 'in_progress')
  const current = active ? labels.get(active.id) ?? active.subject : ''
  // Checked again inside: a newer answer may have been applied while this write waited.
  await update($, progress, p => (mine < appliedSeq ? p : applyCounts(p, now, total, done, current)))
}

function applyCounts(p: Progress, now: number, total: number, done: number, current: string): Progress {
  // A list met for the first time (new, or older than this turn) is the baseline:
  // its finished steps were not finished in this turn.
  const newlyDone = p.total === 0 ? 0 : Math.max(0, done - p.done)
  // Work starts when the turn starts, or when the list first appears within it.
  const firstStartAt = p.total === 0 && total > 0 ? now : p.firstStartAt || now
  return {
    ...p,
    now,
    total,
    done,
    current,
    firstStartAt,
    // Only time spent while steps were actually being finished counts as work.
    workMs: newlyDone > 0 ? p.workMs + (now - (p.lastDoneAt || firstStartAt)) : p.workMs,
    doneInTurn: p.doneInTurn + newlyDone,
    lastDoneAt: newlyDone > 0 ? now : p.lastDoneAt,
  }
}

let stopTick: (() => void) | undefined

// Keeps `now` moving while Claude works, but writes (and so redraws) only when the
// time-left text changes: a redraw every second made the bar flicker.
function startTick($: EngineInterface): void {
  stopTick?.()
  const timer = $.clock.every(1000, () => {
    void tick($)
  })
  stopTick = () => timer.cancel()
}

async function tick($: EngineInterface): Promise<void> {
  const n = await $.clock.now()
  const p = await read($, progress)
  if (etaText({ ...p, now: n }) !== etaText(p)) await update($, progress, q => ({ ...q, now: n }))
}

export const register: Register = on => {

  // A reload drops the module's timer: start it again while Claude is still working.
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    if ((await read($, progress)).isActive) startTick($)
    return r
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId) return next(e)
    const t = await $.clock.now()
    await update($, progress, p => {
      const finished = p.total > 0 && p.done >= p.total
      const base = finished ? IDLE : p
      return { ...base, isActive: true, now: t, firstStartAt: t, lastDoneAt: 0, doneInTurn: 0, workMs: 0 }
    })
    await sync($)
    startTick($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || r.isError || !r.result) return r
    const todos = r.result.newTodos
    const active = todos.find(t => t.status === 'in_progress')
    const now = await $.clock.now()
    await update($, progress, p =>
      applyCounts(p, now, todos.length, todos.filter(t => t.status === 'completed').length, active ? active.activeForm : ''),
    )
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r: any = await next(e)
    const id = r?.result?.task?.id
    if (id && e.activeForm) labels.set(id, e.activeForm)
    await sync($)
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (e.activeForm) labels.set(e.taskId, e.activeForm)
    await sync($)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ending is not the end of Claude's answer.
    if (e.agentId) return next(e)
    stopTick?.()
    stopTick = undefined
    await update($, progress, p => ({ ...p, isActive: false }))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, progress)
    if (!p.isActive || p.total === 0 || p.done >= p.total || e.props.hasSurvey) {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const fraction = p.done / p.total
    const eta = etaText(p)
    const label = `${p.current || 'Claude arbeitet'} · Schritt ${p.done + 1} von ${p.total}`
    const alt = `${p.done} von ${p.total} Schritten erledigt, ${eta}`
    const filled = Math.round(fraction * 20)

    return (
      <Box flexDirection="column" alignItems="center">
        {e.surface !== 'terminal' && 'Svg' in els ? (
          <els.Svg source={bar(fraction)} alt={alt} width={W} height={H} isInteractive />
        ) : (
          <Text>{'▰'.repeat(filled) + '▱'.repeat(20 - filled)}</Text>
        )}
        <Box>
          <Text>{label}</Text>
          <Text dimColor>{'  ' + eta}</Text>
        </Box>
      </Box>
    )
  })
}
