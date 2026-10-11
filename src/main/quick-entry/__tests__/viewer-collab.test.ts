import { describe, expect, it, vi } from 'vitest'
import type { ApiResult } from '../../api-result'
import { VIEWER_MEMBERS_TTL_MS, createViewerCollab } from '../viewer-collab'

const SERVER = 'https://tasks.example'
const ME = 1

/** Members per project: 20 is shared with user 2, 30 only has you. */
const MEMBERS: Record<number, number[]> = { 20: [1, 2], 21: [2, 1, 3], 30: [1] }

function setup(overrides: Partial<Record<number, ApiResult<unknown[]>>> = {}) {
  let clock = 0
  const members = vi.fn(async (projectId: number): Promise<ApiResult<unknown[]>> => {
    const override = overrides[projectId]
    if (override) return override
    return { success: true, data: (MEMBERS[projectId] ?? []).map((id) => ({ id, username: `user${id}` })) }
  })
  const collab = createViewerCollab({ members, now: () => clock })
  return { collab, members, advance: (ms: number) => { clock += ms } }
}

describe('createViewerCollab', () => {
  it('calls a project shared when its members include someone besides you', async () => {
    const { collab } = setup()
    const context = await collab.contextFor(SERVER, ME, [20, 30, 21, 20])
    expect(context.me).toBe(ME)
    expect(context.isShared?.(20)).toBe(true)
    expect(context.isShared?.(21)).toBe(true)
    expect(context.isShared?.(30)).toBe(false)
    expect(context.isShared?.(99)).toBe(false)
  })

  it('asks once per project and keeps the answer for ten minutes', async () => {
    const { collab, members, advance } = setup()
    await collab.contextFor(SERVER, ME, [20, 30])
    await collab.contextFor(SERVER, ME, [20, 30])
    expect(members).toHaveBeenCalledTimes(2)
    advance(VIEWER_MEMBERS_TTL_MS)
    await collab.contextFor(SERVER, ME, [20])
    expect(members).toHaveBeenCalledTimes(3)
  })

  it('shares one request between overlapping questions', async () => {
    const { collab, members } = setup()
    await Promise.all([collab.contextFor(SERVER, ME, [20]), collab.contextFor(SERVER, ME, [20])])
    expect(members).toHaveBeenCalledTimes(1)
  })

  it('treats a project whose members cannot be read as not shared, and asks again next time', async () => {
    const { collab, members } = setup({ 20: { success: false, error: 'offline' } })
    expect((await collab.contextFor(SERVER, ME, [20])).isShared?.(20)).toBe(false)
    await collab.contextFor(SERVER, ME, [20])
    expect(members).toHaveBeenCalledTimes(2)
  })

  it('shares nothing and asks nothing while you are not known', async () => {
    const { collab, members } = setup()
    const context = await collab.contextFor(SERVER, null, [20, 21])
    expect(context.me).toBeNull()
    expect(context.isShared?.(20)).toBe(false)
    expect(members).not.toHaveBeenCalled()
  })

  it('forgets everything on clear (another account)', async () => {
    const { collab, members } = setup()
    await collab.contextFor(SERVER, ME, [20])
    collab.clear()
    await collab.contextFor(SERVER, ME, [20])
    expect(members).toHaveBeenCalledTimes(2)
  })
})
