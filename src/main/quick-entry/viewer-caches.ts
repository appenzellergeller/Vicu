import { fetchProjects, searchProjectUsers } from '../api-client'
import { createTtlCache } from '../ttl-cache'
import { createActiveProjectIds } from './active-projects'
import { createViewerCollab } from './viewer-collab'

/** Brief memory for what Quick View's refreshes keep asking for (D-IPC-6). */

/** The list view id of each project, for the position sort. Views change rarely. */
export const VIEW_ID_TTL_MS = 2 * 60_000
export const projectListViewIds = createTtlCache<number, number>(VIEW_ID_TTL_MS)

/** The active project ids, to hide tasks of archived or removed projects. */
export const activeProjects = createActiveProjectIds({
  fetchProjects: () => fetchProjects(false),
  now: () => Date.now(),
})

/** Who can see each project, for custom lists with collaboration conditions. */
export const viewerCollab = createViewerCollab({ members: searchProjectUsers })

/** A project was created, changed or deleted, or the account changed. */
export function invalidateViewerCaches(): void {
  projectListViewIds.clear()
  activeProjects.invalidate()
  viewerCollab.clear()
}
