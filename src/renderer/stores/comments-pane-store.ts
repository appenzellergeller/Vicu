import { create } from 'zustand'
import type { Task } from '@/lib/vikunja-types'

// The task the comments pane follows: the open card publishes its task here while it is expanded
// (with the row's live data, so a count or title change shows in the pane at once), and clears it
// when it collapses. The pane itself lives in the app shell, beside the content region.

interface CommentsPaneState {
  task: Task | null
  showCardTask: (task: Task) => void
  /** The card of this task closed (or its row went away). */
  clearCardTask: (taskId: number) => void
}

export const useCommentsPaneStore = create<CommentsPaneState>((set) => ({
  task: null,
  showCardTask: (task) => set((state) => (state.task === task ? state : { task })),
  clearCardTask: (taskId) => set((state) => (state.task?.id === taskId ? { task: null } : state)),
}))

// Unsent text per task, for the session: closing the pane or switching cards keeps what was typed.
const drafts = new Map<number, string>()

export function commentDraft(taskId: number): string {
  return drafts.get(taskId) ?? ''
}

export function saveCommentDraft(taskId: number, text: string): void {
  if (text) drafts.set(taskId, text)
  else drafts.delete(taskId)
}

/** The id of the card's Comments button, for returning focus when the pane closes from inside. */
export const commentsButtonId = (taskId: number) => `task-${taskId}-comments`
