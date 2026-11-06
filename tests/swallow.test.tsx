import { expect, mock, test } from 'claude-code/testing'

const BAND = { plugin: 'glass-progress', component: 'AbovePrompt', requestId: 'above-prompt', props: { hasSurvey: false, bodyColumns: 80 } } as const
async function band($: any) {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = ((await ui.findAll?.({ type: 'Text' })) ?? [await ui.find({ type: 'Text' })]).filter(Boolean)
  const all = texts.map((t: any) => t.text).join(' | ')
  await ui.unmount()
  return all
}

function setup(on: any, mode: 'throw' | 'error') {
  const tasks = [
    { id: '1', subject: 'A', status: 'pending' },
    { id: '2', subject: 'B', status: 'pending' },
  ]
  const ctl: any = { armed: false, n: 0 }
  ctl.firstEntered = new Promise<void>(r => { ctl.entered = r })
  ctl.gate = new Promise<void>(r => { ctl.release = r })
  on('tool.call', async ($: any, e: any) => {
    if (e.tool === 'TaskUpdate') { const t = tasks.find(x => x.id === e.taskId)!; t.status = e.status; return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } } }
    if (e.tool === 'TaskList') {
      const snap = tasks.map(t => ({ ...t, blockedBy: [] }))
      if (ctl.armed) {
        const k = ctl.n++
        if (k === 0) { ctl.entered(); await ctl.gate; return { result: { tasks: snap } } }
        if (k === 1) { if (mode === 'throw') throw new Error('TaskList kaputt'); return { isError: true, result: 'Fehler' } }
      }
      return { result: { tasks: snap } }
    }
    return { result: {} }
  })
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($: any, e: any) => { const { Box } = $.ui.resolve(e); return <Box /> })
  return ctl
}

for (const mode of ['throw', 'error'] as const) {
  test(`Neueste TaskList scheitert (${mode}), ältere liefert alles erledigt: Bar muss weg`, { timeoutMs: 60_000 }, async ($, on) => {
    mock.clock(on, { now: 1_800_000_000_000 })
    const ctl = setup(on, mode)
    await $.turn.start({ text: 'los', turnId: 't1' } as never)
    expect(await band($)).toContain('Schritt 1 von 2')
    ctl.armed = true
    const p1 = $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
    await ctl.firstEntered
    try { await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' } as never) } catch {}
    ctl.release()
    await p1
    const after = await band($)
    expect(after).toBe('')
  })
}
