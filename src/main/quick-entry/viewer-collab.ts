import type { ApiResult } from '../api-result'
import { isSharedProject } from '../../shared/collaboration'
import type { CustomListContext } from '../../shared/custom-list-filter'
import { createTtlCache } from '../ttl-cache'

// Which projects are shared, for a Quick View custom list with collaboration conditions
// (cross-app semantics 3.3). The members come from the same lookup as the main window
// (`users/search` with an empty query) and are kept as long: ten minutes per server and project.
// Only the projects of the fetched tasks are asked about, a few at a time.

export const VIEWER_MEMBERS_TTL_MS = 10 * 60_000
const LOOKUP_CONCURRENCY = 4

export interface ViewerCollabDeps {
  /** The members of a project. */
  members: (projectId: number) => Promise<ApiResult<unknown[]>>
  now?: () => number
}

export interface ViewerCollab {
  /** The evaluator context for tasks of `projectIds`; a project whose members cannot be read is not shared. */
  contextFor(server: string, me: number | null, projectIds: Iterable<number>): Promise<CustomListContext>
  clear(): void
}

function memberId(value: unknown): number | null {
  const id = (value as { id?: unknown } | null)?.id
  return typeof id === 'number' && Number.isInteger(id) ? id : null
}

export function createViewerCollab(deps: ViewerCollabDeps): ViewerCollab {
  const cache = createTtlCache<string, readonly number[]>(VIEWER_MEMBERS_TTL_MS, deps.now)
  const inFlight = new Map<string, Promise<readonly number[] | null>>()

  function memberIds(server: string, projectId: number): Promise<readonly number[] | null> {
    const key = `${server}\n${projectId}`
    const cached = cache.get(key)
    if (cached) return Promise.resolve(cached)
    let pending = inFlight.get(key)
    if (!pending) {
      pending = deps.members(projectId)
        .then((result) => {
          if (!result.success) return null
          const ids = result.data.map(memberId).filter((id): id is number => id !== null)
          cache.set(key, ids)
          return ids
        })
        .catch(() => null)
        .finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    return pending
  }

  return {
    async contextFor(server, me, projectIds) {
      const shared = new Set<number>()
      if (me !== null) {
        const unique = [...new Set(projectIds)]
        for (let start = 0; start < unique.length; start += LOOKUP_CONCURRENCY) {
          const batch = unique.slice(start, start + LOOKUP_CONCURRENCY)
          const lists = await Promise.all(batch.map((projectId) => memberIds(server, projectId)))
          batch.forEach((projectId, index) => {
            const ids = lists[index]
            if (ids && isSharedProject(ids, me)) shared.add(projectId)
          })
        }
      }
      return { me, isShared: (projectId) => shared.has(projectId) }
    },
    clear() {
      cache.clear()
    },
  }
}
