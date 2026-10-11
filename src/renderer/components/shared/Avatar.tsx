import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { avatarInitial } from '@/lib/collaboration'
import { useAvatar } from '@/hooks/use-avatar'
import type { PersonRef } from '@/lib/vikunja-types'

/** The surface an avatar sits on: the ring that separates overlapping avatars takes its colour. */
export type AvatarSurface = 'page' | 'card' | 'sidebar'

const SURFACE_VAR: Record<AvatarSurface, string> = {
  page: 'var(--bg-primary)',
  card: 'var(--bg-card)',
  sidebar: 'var(--bg-sidebar)',
}

interface AvatarProps {
  person: PersonRef
  /** Diameter in px (16 to 26 in the designs). */
  size: number
  /** Draw the separating ring (every avatar after the first in a stack). */
  ring?: AvatarSurface
  className?: string
  style?: CSSProperties
}

/**
 * A person's avatar from the server (`GET avatar/{username}`), with their first letter on
 * `bg.selected` while it loads or when it cannot be read (design system section 4). Decorative: the
 * name is always said by the control or text next to it.
 */
export function Avatar({ person, size, ring, className, style }: AvatarProps) {
  const { data: src } = useAvatar(person.username)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'vicu-avatar relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-bg-selected font-semibold text-accent-blue',
        size >= 24 ? 'text-meta' : 'text-caption',
        className,
      )}
      style={{
        width: size,
        height: size,
        lineHeight: 1,
        ...(ring ? { boxShadow: `0 0 0 1.5px ${SURFACE_VAR[ring]}` } : {}),
        ...style,
      }}
    >
      {src ? <img src={src} alt="" draggable={false} className="h-full w-full object-cover" /> : avatarInitial(person)}
    </span>
  )
}

interface AvatarStackProps {
  /** Already in display order (you first). */
  people: readonly PersonRef[]
  size: number
  /** How many avatars before "+N". */
  max: number
  surface: AvatarSurface
  className?: string
}

/** Overlapping avatars (-5 px), at most `max`, then "+N" (design system section 4). Decorative. */
export function AvatarStack({ people, size, max, surface, className }: AvatarStackProps) {
  if (people.length === 0) return null
  const shown = people.length > max ? people.slice(0, max) : people
  const extra = people.length - shown.length
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center', className)}>
      {shown.map((person, index) => (
        <Avatar key={person.id} person={person} size={size} ring={index > 0 ? surface : undefined} style={index > 0 ? { marginLeft: -5 } : undefined} />
      ))}
      {extra > 0 && <span className="ml-1 text-caption text-text-secondary">+{extra}</span>}
    </span>
  )
}
