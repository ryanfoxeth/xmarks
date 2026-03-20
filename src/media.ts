import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { TweetData } from './twitter-api.js'

export async function downloadThumbnails(vaultPath: string, tweet: TweetData): Promise<number> {
  let downloaded = 0
  const mediaDir = join(vaultPath, 'media')

  for (let i = 0; i < tweet.mediaUrls.length; i++) {
    const media = tweet.mediaUrls[i]
    const filename = `${tweet.tweetId}-${i}.jpg`
    const filepath = join(mediaDir, filename)

    if (existsSync(filepath)) continue

    try {
      const res = await fetch(media.thumbnailUrl)
      if (!res.ok) continue
      const buffer = Buffer.from(await res.arrayBuffer())
      writeFileSync(filepath, buffer)
      downloaded++
    } catch {
      // Skip failed downloads silently — thumbnails are nice-to-have
    }
  }

  return downloaded
}
