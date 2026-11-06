import { expect, mock, test } from 'claude-code/testing'

const BAND = { plugin: 'glass-progress', component: 'AbovePrompt', requestId: 'above-prompt', props: { hasSurvey: false, bodyColumns: 80 } } as const
async function band($: any) {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = ((await ui.findAll?.({ type: 'Text' })) ?? [await ui.find({ type: 'Text' })]).filter(Boolean)
  const all = texts.map((t: any) => t.text).join(' | ')
  await ui.unmount()
  return all
}

test('Zwei TaskUpdates gleichzeitig: eine ältere TaskList-Antwort überschreibt nicht die neuere', { timeoutMs: 60_000 }, async ($, on) => {
  mock.clock(on, { now: 1_800_000_000_000 })
  const tasks = [
    { id: '1', subject: 'A', status: 'pending' },
    { id: '2', subject: 'B', status: 'pending' },
  ]
  let armed = false
  let entered: () => void = () => {}
  const firstEntered = new Promise<void>(r => { entered = r })
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  let n = 0
  on('tool.call', async ($, e: any) => {
    if (e.tool === 'TaskUpdate') { const t = tasks.find(x => x.id === e.taskId)!; t.status = e.status; return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } } }
    if (e.tool === 'TaskList') {
      const snap = tasks.map(t => ({ ...t, blockedBy: [] }))
      if (armed && n++ === 0) { entered(); await gate }
      return { result: { tasks: snap } }
    }
    return { result: {} }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })

  await $.turn.start({ text: 'los', turnId: 't1' } as never)
  expect(await band($)).toContain('Schritt 1 von 2')
  armed = true
  const p1 = $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await firstEntered
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' } as never)
  release()
  await p1
  const after = await band($)
  expect(after).toBe('')
})
