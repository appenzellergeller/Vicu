// collab-lists: custom lists that gather shared work (docs/cross-app-semantics-v1.md section 3.3).
//
//   A. "New list" shows the Shared projects section while a project is shared. A list with
//      Assigned "To me" shows the flights task (you and Maya) and nothing else.
//   B. "To someone else" shows the dinner task (Maya only); "To nobody" keeps the unassigned Lisbon
//      tasks and none of a private project.
//   C. Comments "Unread comments" shows flights and dinner. Opening the flights thread from that list
//      marks it read on the server, and the row keeps its place until you leave the list; back on the
//      list it is gone.
//   D. Changed "Today" sends `updated >= '<start of today>'` to the server and shows the tasks the
//      seed changed today.
//
// It marks a thread read on the server and syncs a custom list, so it is destructive (the harness
// re-seeds after it) and deletes the list in a finally block. Run it alone: --scenario collab-lists.

export const meta = {
  id: 'CL',
  wave: null,
  destructive: true,
  title: 'Collaboration lists: assigned to me or others, unread comments kept while reading, changed today',
}

const LIST_NAME = 'Harness shared work'

export default async function run(h) {
  const page = h.page
  const ids = h.ids
  if (!ids.people?.maya || !ids.tasks?.flights || !ids.tasks?.dinner) {
    h.emit({ t: 'skip', id: meta.id, message: 'the seed has no collaboration data: run node scripts/ui-verify/seed.mjs' })
    return
  }
  const { flights, dinner } = ids.tasks
  const nav = page.locator('nav[aria-label="Custom lists"]')
  const listButton = nav.getByRole('button', { name: LIST_NAME })
  const dialog = page.locator('dialog[open]')
  const until = async (fn, timeout = 8000) => {
    const end = Date.now() + timeout
    let last
    while (Date.now() < end) {
      last = await fn().catch(() => undefined)
      if (last) return last
      await h.wait(200)
    }
    return last
  }
  const shownIds = async () =>
    (await page.locator('main [data-task-id]').evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-task-id')))))
      .filter((id, index, all) => all.indexOf(id) === index)
  /** The ids shown once they equal `expected` (or what is shown after the wait). */
  const settleOn = async (expected) => {
    const want = JSON.stringify([...expected].sort((a, b) => a - b))
    const got = await until(async () => {
      const now = [...(await shownIds())].sort((a, b) => a - b)
      return JSON.stringify(now) === want ? now : undefined
    })
    return got ?? [...(await shownIds())].sort((a, b) => a - b)
  }
  const editList = async (change) => {
    await listButton.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await dialog.waitFor()
    await change()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await h.wait(600)
  }
  const select = (label) => dialog.getByLabel(label, { exact: true })

  try {
    await h.resize(1280, 820)
    await h.goto('/inbox')

    // ---- A. Assigned to me --------------------------------------------------------------------
    await page.getByRole('button', { name: 'New list' }).click()
    await dialog.waitFor()
    await h.assert('A: the editor shows the Shared projects section while a project is shared', (await dialog.locator('legend', { hasText: 'Shared projects' }).count()) === 1)
    await dialog.getByLabel('Name', { exact: true }).fill(LIST_NAME)
    await select('Assigned').selectOption('me')
    await h.capture('editor', { clip: { x: 0, y: 0, width: 1280, height: 820 } })
    await dialog.locator('legend', { hasText: 'Shared projects' }).scrollIntoViewIfNeeded()
    await h.capture('editor-shared', { clip: { x: 0, y: 0, width: 1280, height: 820 } })
    const editorAxe = await h.axe('dialog[open]', { label: 'list editor' })
    await h.assert('A: the list editor has no serious accessibility problems', { ok: !editorAxe.some((v) => v.impact === 'serious' || v.impact === 'critical'), detail: editorAxe.map((v) => v.id).join(',') })
    await dialog.getByRole('button', { name: 'Create' }).click()
    await listButton.waitFor({ timeout: 8000 })
    await listButton.click()
    const mine = await settleOn([flights])
    await h.assert('A: Assigned to me shows the flights task only', { ok: JSON.stringify(mine) === JSON.stringify([flights]), detail: JSON.stringify(mine) })
    await h.capture('assigned-to-me', { clip: { x: 0, y: 0, width: 1280, height: 820 } })

    // ---- B. To someone else, to nobody --------------------------------------------------------
    await editList(() => select('Assigned').selectOption('others'))
    const others = await settleOn([dinner])
    await h.assert('B: To someone else shows the dinner task only', { ok: JSON.stringify(others) === JSON.stringify([dinner]), detail: JSON.stringify(others) })

    await editList(() => select('Assigned').selectOption('nobody'))
    const lisbonOpen = (await h.api('GET', `/projects/${ids.lisbon}/tasks?filter=${encodeURIComponent('done = false')}&per_page=100`))
    const lisbonTasks = Array.isArray(lisbonOpen) ? lisbonOpen : (lisbonOpen?.items ?? [])
    const unassigned = lisbonTasks.filter((t) => !(t.assignees ?? []).length).map((t) => t.id)
    const nobody = await settleOn(unassigned)
    await h.assert('B: To nobody shows the unassigned Lisbon tasks and nothing of a private project', {
      ok: unassigned.length > 0 && JSON.stringify(nobody) === JSON.stringify([...unassigned].sort((a, b) => a - b)),
      detail: `${JSON.stringify(nobody)} vs ${JSON.stringify(unassigned)}`,
    })

    // ---- C. Unread comments, kept while reading -----------------------------------------------
    await editList(async () => {
      await select('Assigned').selectOption('')
      await select('Comments').selectOption('unread')
    })
    const unread = await settleOn([flights, dinner])
    await h.assert('C: Unread comments shows flights and dinner', { ok: JSON.stringify(unread) === JSON.stringify([flights, dinner].sort((a, b) => a - b)), detail: JSON.stringify(unread) })

    const flightsRow = page.locator(`main [data-task-id="${flights}"]`).first()
    await flightsRow.locator('button[aria-label*="comment"]').first().click()
    const read = await until(async () => {
      const list = await h.api('GET', `/tasks?filter=${encodeURIComponent(`id = ${flights}`)}&expand=is_unread`)
      const task = (Array.isArray(list) ? list : list?.items ?? []).find((t) => t.id === flights)
      // Vikunja leaves is_unread out once nothing is unread.
      return task && !task.is_unread ? task : undefined
    })
    await h.assert('C: opening the thread marks flights read on the server', !!read)
    await h.wait(800)
    await h.assert('C: the read row keeps its place while the list is open', (await shownIds()).includes(flights))
    await h.capture('kept-while-reading', { clip: { x: 0, y: 0, width: 1280, height: 820 } })
    await h.key('Escape')
    await h.dismiss()
    await h.goto('/inbox')
    await listButton.click()
    const afterLeaving = await settleOn([dinner])
    await h.assert('C: back on the list the read task is gone', { ok: JSON.stringify(afterLeaving) === JSON.stringify([dinner]), detail: JSON.stringify(afterLeaving) })

    // ---- D. Changed today ---------------------------------------------------------------------
    const mark = h.requests().length
    await editList(async () => {
      await select('Comments').selectOption('')
      await select('Changed').selectOption('1')
    })
    await until(async () => (await shownIds()).length > 0)
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    // The logged URLs write spaces as "+".
    const query = (url) => decodeURIComponent(url.replace(/\+/g, ' '))
    const listRequests = h.requests(mark).filter((r) => /\/tasks\?/.test(r.url) && query(r.url).includes('updated >='))
    await h.assert('D: Changed Today asks the server for tasks updated since the start of today', {
      ok: listRequests.some((r) => query(r.url).includes(`updated >= '${start.toISOString()}'`)),
      detail: listRequests.map((r) => query(r.url).replace(/^.*filter=/, '').slice(0, 160)).slice(0, 2).join(' | '),
    })
    const changed = await shownIds()
    await h.assert('D: Changed Today shows the tasks the seed changed today', { ok: changed.includes(flights) && changed.includes(dinner), detail: JSON.stringify(changed) })
  } finally {
    await h.dismiss().catch(() => {})
    if ((await listButton.count().catch(() => 0)) > 0) {
      await listButton.click({ button: 'right' }).catch(() => {})
      await page.getByRole('menuitem', { name: 'Delete' }).click().catch(() => {})
      await h.wait(800)
    }
  }
}
