import { syncBookmarks } from '../sync.js'
import { getDecryptedCredentials, type XmarksConfig } from '../config.js'
import type { Source, SyncResult } from './types.js'

export const twitterSource: Source = {
  name: 'twitter',
  folder: 'bookmarks',

  isConfigured(config: XmarksConfig): boolean {
    const creds = getDecryptedCredentials(config)
    return !!(creds.authToken && creds.ct0)
  },

  async sync(vaultPath: string, config: XmarksConfig, onProgress?: (msg: string) => void): Promise<SyncResult> {
    const creds = getDecryptedCredentials(config)
    if (!creds.authToken || !creds.ct0) {
      return { source: 'twitter', imported: 0, skipped: 0, mediaDownloaded: 0, error: 'Twitter credentials not configured' }
    }

    const result = await syncBookmarks(vaultPath, creds.authToken, creds.ct0, onProgress)
    return { source: 'twitter', ...result }
  },
}
