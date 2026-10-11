import type { CommentAction } from './types'

// The thread of a task shows what the server has plus what is still waiting in the offline queue
// (cross-app semantics 9.6): comments written offline at the end, marked pending; queued edits in
// place, marked pending; queued deletes gone. Pure, so the IPC handler and the tests share it.

interface ServerComment {
  id?: unknown
  comment?: unknown
  author?: { id?: unknown } | null
  created?: unknown
}

/** A comment as the renderer receives it: the server's fields plus `pending` for a queued change. */
export interface ThreadComment {
  id: number
  comment: string
  author: { id: number; username: string; name: string } | null
  created: string
  updated: string
  pending?: true
}

/**
 * Apply the queued comment changes of one task to a page of server comments, newest first as the
 * server sends them. Comments created offline are the newest, so they go on page 1 only.
 */
export function overlayComments(
  items: readonly unknown[],
  actions: readonly CommentAction[],
  page: number,
  me: number | undefined
): unknown[] {
  const deleted = new Set<number>()
  const edited = new Map<number, string>()
  for (const action of actions) {
    if (action.type === 'delete-comment') deleted.add(action.commentId)
    else if (action.type === 'update-comment') edited.set(action.commentId, action.comment)
  }

  const fromServer = items
    .filter((item) => !deleted.has(Number((item as ServerComment).id)))
    .map((item) => {
      const id = Number((item as ServerComment).id)
      const text = edited.get(id)
      return text === undefined ? item : { ...(item as object), comment: text, pending: true }
    })

  if (page !== 1) return fromServer
  const created: ThreadComment[] = actions
    .filter((a): a is Extract<CommentAction, { type: 'create-comment' }> => a.type === 'create-comment' && !deleted.has(a.tempCommentId))
    .map((a) => ({
      id: a.tempCommentId,
      comment: edited.get(a.tempCommentId) ?? a.comment,
      author: me !== undefined ? { id: me, username: '', name: '' } : null,
      created: a.createdAt,
      updated: a.createdAt,
      pending: true,
    }))
  // Newest first, like the server's page.
  return [...created.reverse(), ...fromServer]
}

/** How far the server's clock may run behind ours when matching a comment an earlier attempt may have stored. */
const CLOCK_SLACK_MS = 10 * 60 * 1000

/**
 * The comment an unconfirmed create would have produced, among the newest comments of the task:
 * the same HTML, by the signed-in user when known, created no earlier than the queued action
 * (with some slack for clocks). Null when there is none.
 */
export function findQueuedComment(
  items: readonly unknown[],
  html: string,
  since: string,
  me: number | undefined
): { id: number } | null {
  const earliest = Date.parse(since) - CLOCK_SLACK_MS
  for (const item of items) {
    const c = item as ServerComment
    if (typeof c.id !== 'number' || c.comment !== html) continue
    if (me !== undefined && Number(c.author?.id) !== me) continue
    const created = typeof c.created === 'string' ? Date.parse(c.created) : NaN
    if (Number.isFinite(earliest) && Number.isFinite(created) && created < earliest) continue
    return { id: c.id }
  }
  return null
}
