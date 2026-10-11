import { create } from 'zustand'

interface UIState {
  theme: 'light' | 'dark' | 'system'
  commandPaletteOpen: boolean
  /** Bumped to ask the app shell to show the sign-in screen (the sync panel's "Sign in" button). */
  reauthRequestId: number
  /**
   * Whether the comments pane shows beside an open card. Sticky for the session: once open, every
   * card of a shared project shows it; a private project's card hides it without changing this.
   */
  commentsPaneOpen: boolean
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  toggleCommandPalette: () => void
  requestReauth: () => void
  setCommentsPaneOpen: (open: boolean) => void
  toggleCommentsPane: () => void
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'system',
  commandPaletteOpen: false,
  reauthRequestId: 0,
  commentsPaneOpen: false,

  setTheme: (theme) => set({ theme }),

  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  requestReauth: () => set((state) => ({ reauthRequestId: state.reauthRequestId + 1 })),

  setCommentsPaneOpen: (open) => set({ commentsPaneOpen: open }),

  toggleCommentsPane: () => set((state) => ({ commentsPaneOpen: !state.commentsPaneOpen })),
}))
