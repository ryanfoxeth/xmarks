import { twitterSource } from './twitter.js'
import { youtubeSource } from './youtube.js'
import type { Source } from './types.js'
import type { XmarksConfig } from '../config.js'

export const allSources: Source[] = [twitterSource, youtubeSource]

export function getConfiguredSources(config: XmarksConfig): Source[] {
  return allSources.filter(s => s.isConfigured(config))
}

export function getAllFolders(config: XmarksConfig): string[] {
  const folders = new Set(['bookmarks'])
  for (const source of getConfiguredSources(config)) {
    folders.add(source.folder)
  }
  return [...folders]
}

export type { Source, SyncResult } from './types.js'
