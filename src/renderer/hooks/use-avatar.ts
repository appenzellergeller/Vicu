import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { apiError } from '@/lib/mutation-errors'

/**
 * Every avatar is fetched at one size and scaled down: one request per person, sharp up to 32 px on
 * a 2x screen. The main process keeps them for the session as well.
 */
export const AVATAR_FETCH_SIZE = 64

/** A person's avatar as a data URL (`GET avatar/{username}`), or undefined while loading or when it failed. */
export function useAvatar(username: string | null | undefined) {
  return useQuery<string>({
    queryKey: ['avatar', username ?? ''],
    queryFn: async () => {
      const result = await api.fetchAvatar(username!, AVATAR_FETCH_SIZE)
      if (!result.success) throw apiError(result)
      return result.data
    },
    enabled: !!username,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  })
}
