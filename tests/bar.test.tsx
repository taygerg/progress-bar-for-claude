import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'glass-progress',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, bodyColumns: 80 },
} as const

type T = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }

// Stands for the engine: a real task list the plugin can only read through TaskList.
function engine(on: On, start: T[] = []) {
  const tasks: T[] = [...start]
  on('tool.call', ($, e: any) => {
    if (e.tool === 'TaskCreate') {
      const t: T = { id: String(tasks.length + 1), subject: e.subject, status: 'pending' }
      tasks.push(t)
      return { result: { task: { id: t.id, subject: t.subject } } }
    }
    if (e.tool === 'TaskUpdate') {
      const t = tasks.find(x => x.id === e.taskId)
      if (t && e.status) t.status = e.status
      return { result: { success: !!t, taskId: e.taskId, updatedFields: ['status'] } }
    }
    if (e.tool === 'TaskList') return { result: { tasks: tasks.map(t => ({ ...t, blockedBy: [] })) } }
    return { result: {} }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

async function band($: any, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const texts = ((await ui.findAll?.({ type: 'Text' })) ?? [await ui.find({ type: 'Text' })]).filter(Boolean)
  const all = texts.map((t: any) => t.text).join(' | ')
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  return { all, svg }
}

test('vier Schritte: Bar, Schritt X von Y, Restzeit, verschwindet am Ende', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  engine(on)

  // Ohne Plan: nichts.
  await $.turn.start({ text: 'los', turnId: 't1' } as never)
  expect((await band($, 'terminal')).all).toBe('')

  for (const s of ['Eins', 'Zwei', 'Drei', 'Vier']) {
    await $.tool.call({ tool: 'TaskCreate', subject: s, description: s, activeForm: s + ' läuft' } as never)
  }
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' } as never)
  let b = await band($, 'terminal')
  expect(b.all).toContain('Eins läuft | · Schritt 1 von 4')
  expect(b.all).toContain('Restzeit nach dem ersten Schritt')
  expect((await band($, 'desktop')).svg).toBeDefined()

  // Schritt 1 dauert 20 s.
  await clock.advance(20_000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' } as never)
  b = await band($, 'terminal')
  expect(b.all).toContain('Zwei läuft | · Schritt 2 von 4')
  expect(b.all).toContain('noch ca. 1 Min.') // 3 Schritte × 20 s
  expect(b.all).toContain('▰')

  // 10 s in Schritt 2: noch 50 s.
  await clock.advance(10_000)
  expect((await band($, 'terminal')).all).toContain('noch unter 1 Min.')

  // Schritt 2 überzieht: 70 s statt 20 s.
  await clock.advance(60_000)
  expect((await band($, 'terminal')).all).toContain('dauert länger als geschätzt')

  for (const id of ['2', '3', '4']) {
    await $.tool.call({ tool: 'TaskUpdate', taskId: id, status: 'completed' } as never)
  }
  expect((await band($, 'terminal')).all).toBe('')
  expect((await band($, 'desktop')).svg).toBeUndefined()
})

test('Liste aus einem früheren Zug, Schritt direkt abgehakt: echte Dauer statt sofort überzogen', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  engine(on)
  await $.turn.start({ text: 'plan', turnId: 't2' } as never)
  for (const s of ['Eins', 'Zwei', 'Drei']) {
    await $.tool.call({ tool: 'TaskCreate', subject: s, description: s } as never)
  }
  await $.turn.complete({ reason: 'answer', answer: '' } as never)

  await clock.advance(300_000)
  await $.turn.start({ text: 'weiter', turnId: 't3' } as never)
  await clock.advance(30_000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  const b = await band($, 'terminal')
  expect(b.all).toContain('Schritt 2 von 3')
  expect(b.all).toContain('noch ca. 1 Min.') // 2 Schritte × 30 s
})

test('Subagent endet mitten im Zug: Bar bleibt', { timeoutMs: 60_000 }, async ($, on) => {
  mock.clock(on, { now: 1_800_000_000_000 })
  engine(on)
  await $.turn.start({ text: 'los', turnId: 't4' } as never)
  for (const s of ['Eins', 'Zwei']) {
    await $.tool.call({ tool: 'TaskCreate', subject: s, description: s } as never)
  }
  await $.turn.complete({ reason: 'answer', answer: '', agentId: 'a1' } as never)
  expect((await band($, 'terminal')).all).toContain('Schritt 1 von 2')
  await $.turn.complete({ reason: 'answer', answer: '' } as never)
  expect((await band($, 'terminal')).all).toBe('')
})

test('Fertige Liste bleibt in TaskList: alte Schritte zählen nicht als in diesem Zug erledigt', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  engine(on)
  await $.turn.start({ text: 'eins', turnId: 't5' } as never)
  for (const s of ['A', 'B']) await $.tool.call({ tool: 'TaskCreate', subject: s, description: s } as never)
  for (const id of ['1', '2']) await $.tool.call({ tool: 'TaskUpdate', taskId: id, status: 'completed' } as never)
  await $.turn.complete({ reason: 'answer', answer: '' } as never)

  await clock.advance(60_000)
  await $.turn.start({ text: 'zwei', turnId: 't6' } as never)
  for (const s of ['C', 'D', 'E']) await $.tool.call({ tool: 'TaskCreate', subject: s, description: s, activeForm: s + ' läuft' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'in_progress' } as never)
  let b = await band($, 'terminal')
  expect(b.all).toContain('C läuft | · Schritt 3 von 5')
  expect(b.all).toContain('Restzeit nach dem ersten Schritt')

  await clock.advance(10_000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'completed' } as never)
  b = await band($, 'terminal')
  expect(b.all).toContain('Schritt 4 von 5')
  expect(b.all).toContain('noch unter 1 Min.') // 2 Schritte × 10 s
})

test('Schritt abgehakt, noch keiner läuft: kein alter Schrittname', { timeoutMs: 60_000 }, async ($, on) => {
  mock.clock(on, { now: 1_800_000_000_000 })
  engine(on)
  await $.turn.start({ text: 'los', turnId: 't1' } as never)
  for (const s of ['Eins', 'Zwei', 'Drei']) await $.tool.call({ tool: 'TaskCreate', subject: s, description: s, activeForm: s + ' läuft' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  const b = await band($, 'terminal')
  expect(b.all).toContain('Claude arbeitet | · Schritt 2 von 3')
  expect(b.all).not.toContain('Eins läuft')
})

test('Fortgesetzte Sitzung: offene Liste erscheint beim Zugstart, erster Schritt zählt', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  // Liste aus der Zeit vor dem Neustart: das Plugin hat sie nie gesehen.
  engine(on, [
    { id: '1', subject: 'A', status: 'in_progress' },
    { id: '2', subject: 'B', status: 'pending' },
    { id: '3', subject: 'C', status: 'pending' },
  ])
  await $.turn.start({ text: 'weiter', turnId: 't1' } as never)
  expect((await band($, 'terminal')).all).toContain('A | · Schritt 1 von 3')
  await clock.advance(15_000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  expect((await band($, 'terminal')).all).toContain('noch unter 1 Min.')
})

test('TodoWrite eines Subagenten überschreibt die Hauptliste nicht', { timeoutMs: 60_000 }, async ($, on) => {
  mock.clock(on, { now: 1_800_000_000_000 })
  on('tool.call', ($, e: any) => {
    if (e.tool === 'TodoWrite') return { result: { oldTodos: [], newTodos: e.todos } }
    return { result: {} }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.turn.start({ text: 'los', turnId: 't1' } as never)
  const todo = (c: string, st: string) => ({ content: c, status: st, activeForm: c + ' läuft' })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'in_progress'), todo('B', 'pending'), todo('C', 'pending')] } as never)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'sub1', todos: [todo('X', 'completed'), todo('Y', 'completed')] } as never)
  expect((await band($, 'terminal')).all).toContain('A läuft | · Schritt 1 von 3')
})

test('Balken gleitet vom zuletzt gezeigten Anteil, auch wenn ein Schritt dazukommt', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  engine(on)
  const quelle = async () => {
    const ui = await ($ as any).ui.mount({ ...BAND, surface: 'desktop' })
    const svg: any = await ui.find({ type: 'Svg' })
    await ui.unmount()
    return String(svg?.props?.source ?? svg?.source ?? '')
  }
  await $.turn.start({ text: 'los', turnId: 't1' } as never)
  for (const s of ['A', 'B', 'C', 'D', 'E']) await $.tool.call({ tool: 'TaskCreate', subject: s, description: s } as never)
  for (const id of ['1', '2', '3']) await $.tool.call({ tool: 'TaskUpdate', taskId: id, status: 'completed' } as never)
  // 3 von 5 gezeigt; jetzt kommt ein Schritt dazu: 3 von 6.
  await $.tool.call({ tool: 'TaskCreate', subject: 'F', description: 'F' } as never)
  const q = await quelle()
  expect(q).toContain('@keyframes gw{from{width:333.6px}}') // 3/5 von 556 px
  expect(q).toContain('width="278"') // 3/6 von 556 px
  // Nur die Uhr läuft: gleiche Quelle, keine neue Animation.
  await clock.advance(61_000)
  expect(await quelle()).toBe(q)
})

test('Sehr lange Namen mit Emoji werden nie mitten im Zeichen gekürzt', { timeoutMs: 120_000 }, async ($, on) => {
  mock.clock(on, { now: 1_800_000_000_000 })
  engine(on)
  await $.turn.start({ text: 'los', turnId: 't1' } as never)
  const halb = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
  // Viele Längen, damit jeder Schnittpunkt einmal vorkommt.
  for (let n = 20; n <= 60; n++) {
    const id = String(n - 19)
    const lang = 'a' + '🚀'.repeat(n)
    await $.tool.call({ tool: 'TaskCreate', subject: 'X' + n, description: 'X', activeForm: lang } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: id, status: 'in_progress' } as never)
    const ui = await ($ as any).ui.mount({ ...BAND, surface: 'desktop' })
    const svg: any = await ui.find({ type: 'Svg' })
    await ui.unmount()
    const q = String(svg?.props?.source ?? svg?.source ?? '')
    expect(halb.test(q)).toBe(false)
    expect(q).not.toContain('\ufffd') // ein halbes Zeichen kommt als Ersatzzeichen an
    expect(String(svg?.props?.alt ?? svg?.alt ?? '')).toContain(lang)
    await $.tool.call({ tool: 'TaskUpdate', taskId: id, status: 'completed' } as never)
  }
})
