import { describe, expect, it } from 'vitest'
import { accessFor } from '../use-project-access'
import { isSendingComment, oldestFirst, type CommentPages } from '../use-task-comments'
import type { Project, TaskComment } from '@/lib/vikunja-types'

const ME = 1
const maya = { id: 2, username: 'maya', name: 'Maya' }
const me = { id: ME, username: 'rendy', name: 'Rendy' }

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 7,
    title: 'Home',
    description: '',
    parent_project_id: 0,
    is_archived: false,
    hex_color: '',
    position: 1,
    created: '',
    updated: '',
    ...overrides,
  }
}

function comment(id: number): TaskComment {
  return { id, comment: `<p>${id}</p>`, author: me, created: '2026-10-10T10:00:00Z', updated: '2026-10-10T10:00:00Z' }
}

describe('accessFor (cross-app semantics 9.1)', () => {
  it('is private when you are the only member', () => {
    expect(accessFor(project({ max_permission: 2 }), [me], ME)).toEqual({ shared: false, members: [me], permission: 2 })
  })

  it('is shared when someone else is a member, with you first', () => {
    const access = accessFor(project({ max_permission: 1 }), [maya, me], ME)
    expect(access.shared).toBe(true)
    expect(access.members.map((m) => m.id)).toEqual([ME, 2])
  })

  it('counts a project someone else owns as shared before its members are known', () => {
    expect(accessFor(project({ owner: maya }), undefined, ME)).toEqual({ shared: true, members: [], permission: 1 })
    expect(accessFor(project({ owner: me }), undefined, ME).shared).toBe(false)
  })

  it('reads an archived project as read only and an unknown permission as read and write', () => {
    expect(accessFor(project({ is_archived: true, max_permission: 2 }), [me], ME).permission).toBe(0)
    expect(accessFor(project(), [me], ME).permission).toBe(1)
  })

  it('is private while you are not known', () => {
    expect(accessFor(project(), [maya, me], null).shared).toBe(false)
  })
})

describe('comment pages', () => {
  it('flatten oldest first, each comment once', () => {
    const data: CommentPages = {
      pages: [
        { items: [comment(5), comment(4)], page: 1, totalPages: 2 },
        // A comment that moved to the next page while new ones arrived.
        { items: [comment(4), comment(3)], page: 2, totalPages: 2 },
      ],
      pageParams: [1, 2],
    }
    expect(oldestFirst(data).map((c) => c.id)).toEqual([3, 4, 5])
    expect(oldestFirst(undefined)).toEqual([])
  })

  it('tells a comment still on its way from a queued one', () => {
    expect(isSendingComment({ id: -1_000_000_001 })).toBe(true)
    expect(isSendingComment({ id: -3 })).toBe(false)
    expect(isSendingComment({ id: 42 })).toBe(false)
  })
})
