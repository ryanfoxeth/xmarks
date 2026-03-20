import { appendFileSync } from 'fs'
import { join } from 'path'
import { fetchBookmarksPage } from './twitter-api.js'
import { writeBookmark, loadTweetIndex } from './markdown.js'
import { downloadThumbnails } from './media.js'
import type { TweetData } from './twitter-api.js'

export interface SyncResult {
  imported: number
  skipped: number
  mediaDownloaded: number
  error?: string
}

export async function syncBookmarks(
  vaultPath: string,
  authToken: string,
  ct0: string,
  onProgress?: (msg: string) => void,
): Promise<SyncResult> {
  let imported = 0
  let skipped = 0
  let mediaDownloaded = 0
  let cursor: string | undefined
  const MAX_PAGES = 50

  // Load tweet ID index for O(1) dedup lookups instead of scanning all files
  const index = loadTweetIndex(vaultPath)
  onProgress?.(`Loaded index: ${index.size} known tweets`)

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      onProgress?.(`Fetching page ${page + 1}...`)
      const { tweets, nextCursor } = await fetchBookmarksPage(authToken, ct0, cursor)

      if (page === 0 && tweets.length === 0) {
        onProgress?.('No bookmarks found (or API response format changed)')
        break
      }

      // Check if we've reached bookmarks we already have
      let allExist = true

      for (const tweet of tweets) {
        if (index.has(tweet.tweetId)) {
          skipped++
          continue
        }

        allExist = false
        const written = writeBookmark(vaultPath, tweet, index)
        if (written) {
          imported++
          // Download thumbnails
          const dl = await downloadThumbnails(vaultPath, tweet)
          mediaDownloaded += dl
        } else {
          skipped++
        }
      }

      // If all tweets on this page already exist, we've caught up
      if (allExist && tweets.length > 0) {
        onProgress?.('Caught up — all remaining bookmarks already synced')
        break
      }

      if (!nextCursor || tweets.length === 0) break
      cursor = nextCursor

      // Small delay between pages
      await new Promise(r => setTimeout(r, 300))
    }

    // Log sync result
    const logLine = `${new Date().toISOString()} | imported: ${imported}, skipped: ${skipped}, media: ${mediaDownloaded}\n`
    appendFileSync(join(vaultPath, 'sync.log'), logLine, 'utf8')

    return { imported, skipped, mediaDownloaded }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const logLine = `${new Date().toISOString()} | ERROR: ${error}\n`
    appendFileSync(join(vaultPath, 'sync.log'), logLine, 'utf8')
    return { imported, skipped, mediaDownloaded, error }
  }
}
