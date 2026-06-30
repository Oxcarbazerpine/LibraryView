import type { LibraryViewApi } from '../shared/types'

declare global {
  interface Window {
    api: LibraryViewApi
  }
}
