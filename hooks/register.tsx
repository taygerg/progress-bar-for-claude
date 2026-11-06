import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Progress } from '../types'

const IDLE: Progress = { isActive: false, now: 0, total: 0, done: 0, current: '', firstStartAt: 0, lastDoneAt: 0, doneInTurn: 0, workMs: 0 }
const progress = atom({ plugin: 'glass-progress', key: 'progress' } as const, IDLE)
// /glas-aus is remembered for the session, so a reload does not switch the backdrop back on.
const backdropOff = atom({ plugin: 'glass-progress', key: 'backdropOff' } as const, false)

type Task = { id: string; subject: string; status: string }

const W = 600
const H = 56

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

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Rough text width in px for the system font: SVG text cannot be measured here.
function textWidth(t: string, px: number): number {
  let u = 0
  for (const c of t) {
    const cp = c.codePointAt(0) ?? 0
    u +=
      cp > 0xffff ? 1.3 // emoji and other astral symbols
      : cp > 0x24f ? 1.05 // CJK, dashes, symbols, other scripts: count them wide
      : /[iljtfr.,:;'!| ]/.test(c) ? 0.3
      : /[mwMW@%ŴŵŒœÆæ]/.test(c) ? 0.95
      : /[A-ZÄÖÜ0-9#&]/.test(c) ? 0.68
      : 0.56
  }
  return u * px
}

// Cut whole characters (emoji and joined emoji stay intact), then add "…".
function fit(t: string, px: number, max: number): string {
  if (textWidth(t, px) <= max) return t
  const parts =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? Array.from(new Intl.Segmenter().segment(t), x => x.segment)
      : Array.from(t)
  while (parts.length > 1 && textWidth(parts.join('') + '…', px) > max) parts.pop()
  return parts.join('').trimEnd() + '…'
}

// One liquid-glass pill: the step and its count on top, a slim bar below that
// glides from the share shown last to the new one (once, when the count changes).
function pill(fraction: number, from: number, current: string, right: string): string {
  const pad = 22
  const bx = pad
  const by = 40
  const bw = W - 2 * pad
  const bh = 6
  const r1 = (n: number) => Math.round(n * 10) / 10
  const fw = r1(Math.max(bh, bw * Math.min(1, fraction)))
  const ffw = r1(Math.max(bh, bw * Math.min(1, from)))
  const rightText = fit(right, 12, bw * 0.6)
  const leftText = fit(current, 13 * 1.1, bw - textWidth(rightText, 12) - 28)
  const glide =
    ffw === fw
      ? ''
      : `.fl,.hi{animation:.45s cubic-bezier(.32,.72,0,1) both}
  .fl{animation-name:gw}.hi{animation-name:gh}
  @keyframes gw{from{width:${ffw}px}}
  @keyframes gh{from{width:${r1(Math.max(0, ffw - 4))}px}}
  @media (prefers-reduced-motion: reduce){.fl,.hi{animation:none}}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>
  text{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif}
  .a{fill:#F5F5F7}.b{fill:#D1D1D6}.glas{fill:url(#gl);stroke:rgba(255,255,255,.16)}.kante{stroke:url(#ka)}
  .spur{fill:rgba(255,255,255,.10)}
  .f1{stop-color:#ffffff}.f2{stop-color:#eef0ff}.f3{stop-color:#c7cdf5}
  @media (prefers-color-scheme: light){.a{fill:#1D1D1F}.b{fill:#5E5E63}.glas{fill:url(#gh2);stroke:rgba(0,0,0,.08)}.spur{fill:rgba(0,0,0,.08)}.f1{stop-color:#9aa5f2}.f2{stop-color:#7884e3}.f3{stop-color:#5f6bd1}}
  ${glide}
  </style>
  <defs>
    <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".13"/><stop offset="1" stop-color="#fff" stop-opacity=".04"/></linearGradient>
    <linearGradient id="gh2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/></linearGradient>
    <linearGradient id="ka" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop class="f1" offset="0"/><stop class="f2" offset=".55"/><stop class="f3" offset="1"/></linearGradient>
    <linearGradient id="hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="g" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect class="glas" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${(H - 2) / 2}" stroke-width="1"/>
  <rect class="kante" x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="${(H - 3) / 2}" fill="none" stroke-width="1"/>
  <text class="a" x="${pad}" y="27" font-size="13" font-weight="600">${esc(leftText)}</text>
  <text class="b" x="${W - pad}" y="27" font-size="12" text-anchor="end">${esc(rightText)}</text>
  <rect class="spur" x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${bh / 2}"/>
  <rect class="fl" x="${bx}" y="${by}" width="${fw}" height="${bh}" rx="${bh / 2}" fill="url(#f)" filter="url(#g)"/>
  <rect class="hi" x="${bx + 2}" y="${by + 0.8}" width="${r1(Math.max(0, fw - 4))}" height="2" rx="1" fill="url(#hl)"/>
</svg>`
}

// Dark baby-blue gradient behind the whole window (light variant for a light theme);
// the desktop app frosts its own panels over it.
const BACKDROP = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<style>
.g0{stop-color:#0F141E}.g1{stop-color:#112437}.g2{stop-color:#16395A}
.l1{stop-color:#7FBAF0}.l2{stop-color:#2A74BE}.l3{stop-color:#8FCBF3}
@media (prefers-color-scheme: light){.g0{stop-color:#F4F9FE}.g1{stop-color:#E3F0FB}.g2{stop-color:#CFE5F8}.l2{stop-color:#8FCBF3}}
</style>
<defs>
<linearGradient id="grund" x1="0" y1="0" x2="1" y2="1"><stop class="g0" offset="0"/><stop class="g1" offset=".55"/><stop class="g2" offset="1"/></linearGradient>
<radialGradient id="licht1" cx=".78" cy=".2" r=".55"><stop class="l1" offset="0" stop-opacity=".38"/><stop class="l1" offset="1" stop-opacity="0"/></radialGradient>
<radialGradient id="licht2" cx=".15" cy=".85" r=".6"><stop class="l2" offset="0" stop-opacity=".45"/><stop class="l2" offset="1" stop-opacity="0"/></radialGradient>
<radialGradient id="licht3" cx=".5" cy=".55" r=".35"><stop class="l3" offset="0" stop-opacity=".12"/><stop class="l3" offset="1" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1600" height="1000" fill="url(#grund)"/>
<rect width="1600" height="1000" fill="url(#licht1)"/>
<rect width="1600" height="1000" fill="url(#licht2)"/>
<rect width="1600" height="1000" fill="url(#licht3)"/>
</svg>`

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
    // The share shown before the last change of the count (or of the list's size).
    prevShown: done !== p.done || total !== p.total ? (p.total ? p.done / p.total : 0) : p.prevShown,
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
    await $.command.register({ name: 'glas-aus', description: 'Babyblau-Hintergrund in dieser Sitzung ausschalten' })
    if (!(await read($, backdropOff))) await $.ui.backdrop({ id: 'babyblau', glass: { blur: 28, opacity: 0.22, tint: '#0F141E' } })
    return r
  })

  on('command.run', { command: 'glas-aus' }, async $ => {
    await update($, backdropOff, () => true)
    await $.ui.backdrop(undefined)

    return { text: 'Hintergrund aus.' }
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== 'glass-progress' || e.props.id !== 'babyblau') return next(e)
    const els = $.ui.resolve(e)
    if (!('Svg' in els)) return next(e)
    return <els.Svg source={BACKDROP} alt="Dunkler Babyblau-Verlauf" />
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
    const step = `Schritt ${p.done + 1} von ${p.total}`
    const alt = `${p.current || 'Claude arbeitet'}, ${step}, ${p.done} von ${p.total} erledigt, ${eta}`
    const filled = Math.round(fraction * 20)

    return (
      <Box flexDirection="column" alignItems="center" width="100%">
        {e.surface !== 'terminal' && 'Svg' in els ? (
          <els.Svg
            source={pill(fraction, Math.min(p.prevShown ?? fraction, 1), p.current || 'Claude arbeitet', step + ' · ' + eta)}
            alt={alt}
            width={W}
            height={H}
          />
        ) : (
          <Text>{'▰'.repeat(filled) + '▱'.repeat(20 - filled)}</Text>
        )}
        {!(e.surface !== 'terminal' && 'Svg' in els) ? (
        <Box flexDirection="row" justifyContent="center" width="100%" gap={1}>
          <Box flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">{p.current || 'Claude arbeitet'}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text dimColor>{'· ' + step + ' · ' + eta}</Text>
          </Box>
        </Box>
        ) : null}
      </Box>
    )
  })
}
