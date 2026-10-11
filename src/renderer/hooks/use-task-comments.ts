import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { apiError } from '@/lib/mutation-errors'
import { mapTaskInCaches } from '@/lib/pending-cache'
import type { PersonRef, Task, TaskComment, TaskCommentPage } from '@/lib/vikunja-types'

// A task's comment thread (cross-app semantics 9.5). The server pages it newest first, 50 at a time;
// the pane shows it oldest first and loads older pages when scrolled to the top. Writes go through
// the main process write gate, so offline they are queued and shown as pending; the main process
// lays the queued changes over every page it returns.

export type CommentPages = InfiniteData<TaskCommentPage, unknown>

/** Ids of comments the renderer is still sending (below every queue temp id, which counts down from -1). */
const LOCAL_ID_BASE = -1_000_000_000
let nextLocalId = LOCAL_ID_BASE

/** A comment that has not reached the main process yet: it cannot be edited or deleted. */
export function isSendingComment(comment: Pick<TaskComment, 'id'>): boolean {
  return comment.id <= LOCAL_ID_BASE
}

export const commentsKey = (taskId: number) => ['task-comments', taskId] as const

/** The pages flattened, oldest first, each comment once (a page boundary can move while new comments arrive). */
export function oldestFirst(data: CommentPages | undefined): TaskComment[] {
  if (!data) return []
  const seen = new Set<number>()
  const newestFirst: TaskComment[] = []
  for (const page of data.pages) {
    for (const comment of page.items) {
      if (seen.has(comment.id)) continue
      seen.add(comment.id)
      newestFirst.push(comment)
    }
  }
  return newestFirst.reverse()
}

export function useTaskComments(taskId: number | null) {
  const query = useInfiniteQuery({
    queryKey: ['task-comments', taskId ?? 0],
    queryFn: async ({ pageParam }): Promise<TaskCommentPage> => {
      const result = await api.fetchTaskComments(taskId!, pageParam)
      if (!result.success) throw apiError(result)
      return result.data
    },
    initialPageParam: 1,
    getNextPageParam: (last: TaskCommentPage) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: taskId !== null && taskId !== 0,
  })
  const comments = useMemo(() => oldestFirst(query.data), [query.data])
  return { ...query, comments }
}

function mapComments(qc: QueryClient, taskId: number, change: (items: TaskComment[], pageIndex: number) => TaskComment[]) {
  qc.setQueryData<CommentPages>(commentsKey(taskId), (old) =>
    old ? { ...old, pages: old.pages.map((page, index) => ({ ...page, items: change(page.items, index) })) } : old,
  )
}

function bumpCommentCount(qc: QueryClient, taskId: number, by: number) {
  mapTaskInCaches(qc, taskId, (task) => ({ ...task, comment_count: Math.max(0, (task.comment_count ?? 0) + by) }))
}

interface CreateVars {
  task: Pick<Task, 'id' | 'title'>
  html: string
  me: PersonRef | null
}

type CreateOutcome = { queued: false; comment: TaskComment } | { queued: true; tempCommentId: number }

export function useCreateComment() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'post the comment' },
    mutationFn: async ({ task, html }: CreateVars): Promise<CreateOutcome> => {
      const result = await api.createTaskCommentOrQueue(task.id, html, task.title)
      if (!result.success) throw apiError(result)
      if ('queued' in result && result.queued) return { queued: true, tempCommentId: result.data.tempCommentId }
      return { queued: false, comment: result.data as TaskComment }
    },
    onMutate: async (vars) => {
      const key = commentsKey(vars.task.id)
      await qc.cancelQueries({ queryKey: key })
      const localId = --nextLocalId
      const now = new Date().toISOString()
      const optimistic: TaskComment = { id: localId, comment: vars.html, author: vars.me, created: now, updated: now, pending: true }
      const current = qc.getQueryData<CommentPages>(key)
      if (current && current.pages.length > 0) mapComments(qc, vars.task.id, (items, index) => (index === 0 ? [optimistic, ...items] : items))
      else qc.setQueryData<CommentPages>(key, { pages: [{ items: [optimistic], page: 1, totalPages: 1 }], pageParams: [1] })
      bumpCommentCount(qc, vars.task.id, 1)
      return { localId }
    },
    onSuccess: (outcome, vars, context) => {
      const key = commentsKey(vars.task.id)
      const now = new Date().toISOString()
      const saved: TaskComment = outcome.queued
        ? { id: outcome.tempCommentId, comment: vars.html, author: vars.me, created: now, updated: now, pending: true }
        : { ...outcome.comment, author: outcome.comment.author ?? vars.me, pending: false }
      const current = qc.getQueryData<CommentPages>(key)
      const present = current?.pages.some((page) => page.items.some((c) => c.id === context?.localId || c.id === saved.id))
      if (present) {
        mapComments(qc, vars.task.id, (items) =>
          items.map((c) => (c.id === context?.localId ? { ...c, ...saved, created: outcome.queued ? c.created : saved.created } : c)),
        )
      } else if (current && current.pages.length > 0) {
        // A refetch replaced the page while the comment was on its way: put it back on top.
        mapComments(qc, vars.task.id, (items, index) => (index === 0 ? [saved, ...items] : items))
      }
    },
    onError: (_error, vars, context) => {
      mapComments(qc, vars.task.id, (items) => items.filter((c) => c.id !== context?.localId))
      bumpCommentCount(qc, vars.task.id, -1)
    },
  })
}

interface UpdateVars {
  task: Pick<Task, 'id' | 'title'>
  comment: TaskComment
  html: string
}

export function useUpdateComment() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'save the comment' },
    mutationFn: async ({ task, comment, html }: UpdateVars) => {
      const result = await api.updateTaskCommentOrQueue(task.id, comment.id, html, task.title)
      if (!result.success) throw apiError(result)
      if ('queued' in result && result.queued) return null
      return result.data as TaskComment
    },
    onMutate: async ({ task, comment, html }) => {
      await qc.cancelQueries({ queryKey: commentsKey(task.id) })
      const now = new Date().toISOString()
      mapComments(qc, task.id, (items) => items.map((c) => (c.id === comment.id ? { ...c, comment: html, updated: now, pending: true } : c)))
      return { before: comment }
    },
    onSuccess: (saved, { task, comment }) => {
      mapComments(qc, task.id, (items) =>
        items.map((c) => {
          if (c.id !== comment.id) return c
          // A queued edit stays pending until the replay; a sent one takes the server's version.
          return saved ? { ...c, ...saved, author: saved.author ?? c.author, pending: false } : c
        }),
      )
    },
    onError: (_error, { task }, context) => {
      if (!context) return
      mapComments(qc, task.id, (items) => items.map((c) => (c.id === context.before.id ? context.before : c)))
    },
  })
}

interface DeleteVars {
  task: Pick<Task, 'id' | 'title'>
  comment: TaskComment
}

export function useDeleteComment() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'delete the comment' },
    mutationFn: async ({ task, comment }: DeleteVars) => {
      const result = await api.deleteTaskCommentOrQueue(task.id, comment.id, task.title)
      if (!result.success) throw apiError(result)
    },
    onMutate: async ({ task, comment }) => {
      const key = commentsKey(task.id)
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<CommentPages>(key)
      mapComments(qc, task.id, (items) => items.filter((c) => c.id !== comment.id))
      bumpCommentCount(qc, task.id, -1)
      return { before }
    },
    onError: (_error, { task }, context) => {
      if (context?.before) qc.setQueryData(commentsKey(task.id), context.before)
      bumpCommentCount(qc, task.id, 1)
    },
  })
}

/**
 * Mark a task's comments read (`PUT tasks/{id}/read`) when its thread is opened, and clear the
 * unread mark in every cache at once. Online only: a failure leaves the server's mark for the next
 * refresh to bring back.
 */
export function useMarkTaskRead() {
  const qc = useQueryClient()
  return useCallback(
    (taskId: number) => {
      if (taskId <= 0) return
      mapTaskInCaches(qc, taskId, (task) => (task.is_unread ? { ...task, is_unread: false } : task))
      void api.markTaskRead(taskId)
    },
    [qc],
  )
}

/** Whether you get a notification for every new comment on the task (`task.subscription`, single-task reads only). */
export function useTaskSubscription(taskId: number | null) {
  const qc = useQueryClient()
  const key = ['task-subscription', taskId ?? 0] as const
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<boolean> => {
      const result = await api.fetchTaskById(taskId!)
      if (!result.success) throw apiError(result)
      return !!result.data.subscription
    },
    enabled: taskId !== null && taskId > 0,
  })
  const mutation = useMutation({
    meta: { action: 'change notifications for the task' },
    mutationFn: async (subscribed: boolean) => {
      const result = await api.setTaskSubscription(taskId!, subscribed)
      if (!result.success) throw apiError(result)
    },
    onMutate: async (subscribed) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<boolean>(key)
      qc.setQueryData(key, subscribed)
      return { before }
    },
    onError: (_error, _subscribed, context) => {
      qc.setQueryData(key, context?.before)
    },
  })
  return { subscribed: query.data ?? false, known: query.data !== undefined, setSubscribed: mutation.mutate, isPending: mutation.isPending }
}
