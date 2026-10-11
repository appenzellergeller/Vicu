import type { TaskQueryParams } from './vikunja-types'

// Whether task list requests also ask for `comment_count` and `is_unread` (cross-app semantics 9.4).
// Only while at least one project is shared, so a user who shares nothing pays nothing. The value
// is remembered across starts so the first lists of a session already carry the counts; the
// project access hook corrects it as soon as the members are known.

const STORAGE_KEY = 'vicu.collab-signals'

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let wanted = readStored()

export function collabSignalsWanted(): boolean {
  return wanted
}

/** Set the flag; true when it changed (the caller then refetches the task lists once). */
export function setCollabSignalsWanted(next: boolean): boolean {
  if (wanted === next) return false
  wanted = next
  try {
    if (next) globalThis.localStorage?.setItem(STORAGE_KEY, '1')
    else globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // Without storage the flag lives for the session only.
  }
  return true
}

/** The params of a task list request, with the collaboration expand while something is shared. */
export function withCollabSignals(params: TaskQueryParams): TaskQueryParams {
  return wanted ? { ...params, collab_signals: true } : params
}
