import type { XmarksConfig } from '../config.js'

export interface SyncResult {
  source: string
  imported: number
  skipped: number
  mediaDownloaded: number
  error?: string
}

export interface Source {
  name: string
  folder: string
  sync(vaultPath: string, config: XmarksConfig, onProgress?: (msg: string) => void): Promise<SyncResult>
  isConfigured(config: XmarksConfig): boolean
}
