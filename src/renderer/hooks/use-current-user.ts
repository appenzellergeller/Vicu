import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { PersonRef } from '@/lib/vikunja-types'

/** The signed-in person changes only with the account; it is kept with the saved lists (offline starts know it). */
const CURRENT_USER_STALE_MS = 60 * 60 * 1000

/**
 * You, as the collaboration rules need you (cross-app semantics 9.3: "You" first in every list).
 * Offline the query fails and keeps the last answer.
 */
export function useCurrentUser() {
  return useQuery<PersonRef>({
    queryKey: ['current-user'],
    queryFn: async () => {
      const user = await api.getUser()
      if (!user) throw new Error('Could not read the signed-in user')
      return { id: user.id, username: user.username, name: user.name || null }
    },
    staleTime: CURRENT_USER_STALE_MS,
    retry: false,
  })
}
