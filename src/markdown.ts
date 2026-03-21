import { existsSync, writeFileSync, readdirSync, readFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import type { TweetData } from './twitter-api.js'

const TWEET_INDEX_FILE = '.tweet-ids'

function getIndexPath(vaultPath: string): string {
  return join(vaultPath, TWEET_INDEX_FILE)
}

// Generic index functions for multi-source support

export function loadItemIndex(vaultPath: string, indexFile: string): Set<string> {
  const indexPath = join(vaultPath, indexFile)
  if (!existsSync(indexPath)) return new Set()
  const content = readFileSync(indexPath, 'utf8')
  return new Set(content.split('\n').filter(Boolean))
}

export function appendToItemIndex(vaultPath: string, indexFile: string, id: string): void {
  appendFileSync(join(vaultPath, indexFile), id + '\n', 'utf8')
}

export function getUncategorizedItems(vaultPath: string, folders: string[]): { filepath: string; content: string }[] {
  const uncategorized: { filepath: string; content: string }[] = []
  for (const folder of folders) {
    const dir = join(vaultPath, folder)
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.endsWith('.md'))
    for (const file of files) {
      const filepath = join(dir, file)
      const content = readFileSync(filepath, 'utf8')
      if (content.includes('categorized: false')) {
        uncategorized.push({ filepath, content })
      }
    }
  }
  return uncategorized
}

export function getItemCount(vaultPath: string, folders: string[]): { total: number; categorized: number; uncategorized: number } {
  let total = 0
  let categorized = 0
  let uncategorized = 0
  for (const folder of folders) {
    const dir = join(vaultPath, folder)
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.endsWith('.md'))
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf8')
      total++
      if (content.includes('categorized: false')) uncategorized++
      else categorized++
    }
  }
  return { total, categorized, uncategorized }
}

export function loadTweetIndex(vaultPath: string): Set<string> {
  const indexPath = getIndexPath(vaultPath)
  if (!existsSync(indexPath)) {
    // Build index from existing files on first run
    return rebuildTweetIndex(vaultPath)
  }
  const content = readFileSync(indexPath, 'utf8')
  return new Set(content.split('\n').filter(Boolean))
}

export function rebuildTweetIndex(vaultPath: string): Set<string> {
  const bookmarksDir = join(vaultPath, 'bookmarks')
  const ids = new Set<string>()
  if (!existsSync(bookmarksDir)) return ids

  const files = readdirSync(bookmarksDir).filter(f => f.endsWith('.md'))
  for (const file of files) {
    const content = readFileSync(join(bookmarksDir, file), 'utf8')
    const match = content.match(/^tweetId: "(\d+)"$/m)
    if (match) ids.add(match[1])
  }

  // Write the index file
  writeFileSync(getIndexPath(vaultPath), [...ids].join('\n') + '\n', 'utf8')
  return ids
}

export function appendToTweetIndex(vaultPath: string, tweetId: string): void {
  appendFileSync(getIndexPath(vaultPath), tweetId + '\n', 'utf8')
}

function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .replace(/-$/, '')
}

function formatDate(date: Date | null): string {
  if (!date) return new Date().toISOString().split('T')[0]
  return date.toISOString().split('T')[0]
}

export function tweetToMarkdown(tweet: TweetData): string {
  const date = formatDate(tweet.createdAt)
  const now = new Date().toISOString()

  let frontmatter = `---\n`
  frontmatter += `tweetId: "${tweet.tweetId}"\n`
  frontmatter += `author: "@${tweet.authorHandle}"\n`
  frontmatter += `authorName: "${tweet.authorName.replace(/"/g, '\\"')}"\n`
  frontmatter += `date: ${date}\n`
  frontmatter += `bookmarkedAt: ${now}\n`
  frontmatter += `categories: []\n`
  frontmatter += `semanticTags: []\n`
  frontmatter += `source: bookmark\n`
  frontmatter += `url: https://x.com/${tweet.authorHandle}/status/${tweet.tweetId}\n`
  frontmatter += `categorized: false\n`
  frontmatter += `---\n`

  let body = `\n${tweet.text}\n`

  if (tweet.mediaUrls.length > 0) {
    body += `\n## Media\n`
    for (const media of tweet.mediaUrls) {
      const filename = `${tweet.tweetId}-${tweet.mediaUrls.indexOf(media)}.jpg`
      body += `![[media/${filename}]]\n`
    }
  }

  if (tweet.urls.length > 0) {
    body += `\n## Links\n`
    for (const url of tweet.urls) {
      body += `- ${url}\n`
    }
  }

  return frontmatter + body
}

export function generateFilename(tweet: TweetData): string {
  const date = formatDate(tweet.createdAt)
  const slug = slugify(tweet.text) || tweet.tweetId
  return `${date}-@${tweet.authorHandle}-${slug}.md`
}

export function writeBookmark(vaultPath: string, tweet: TweetData, index?: Set<string>): boolean {
  // Use index for O(1) lookup if provided, fall back to file scan
  if (index) {
    if (index.has(tweet.tweetId)) return false
  } else if (bookmarkExists(vaultPath, tweet.tweetId)) {
    return false
  }

  const filename = generateFilename(tweet)
  const filepath = join(vaultPath, 'bookmarks', filename)
  const content = tweetToMarkdown(tweet)
  writeFileSync(filepath, content, 'utf8')

  // Update index
  if (index) {
    index.add(tweet.tweetId)
    appendToTweetIndex(vaultPath, tweet.tweetId)
  }

  return true // written
}

export function bookmarkExists(vaultPath: string, tweetId: string): boolean {
  const bookmarksDir = join(vaultPath, 'bookmarks')
  if (!existsSync(bookmarksDir)) return false

  const files = readdirSync(bookmarksDir).filter(f => f.endsWith('.md'))
  for (const file of files) {
    const content = readFileSync(join(bookmarksDir, file), 'utf8')
    if (content.includes(`tweetId: "${tweetId}"`)) return true
  }
  return false
}

export function getUncategorizedBookmarks(vaultPath: string): { filepath: string; content: string }[] {
  const bookmarksDir = join(vaultPath, 'bookmarks')
  if (!existsSync(bookmarksDir)) return []

  const files = readdirSync(bookmarksDir).filter(f => f.endsWith('.md'))
  const uncategorized: { filepath: string; content: string }[] = []

  for (const file of files) {
    const filepath = join(bookmarksDir, file)
    const content = readFileSync(filepath, 'utf8')
    if (content.includes('categorized: false')) {
      uncategorized.push({ filepath, content })
    }
  }

  return uncategorized
}

export function updateFrontmatter(
  filepath: string,
  updates: Record<string, string | string[] | boolean>,
): void {
  const content = readFileSync(filepath, 'utf8')
  const fmEnd = content.indexOf('---', 3)
  if (fmEnd === -1) return

  let frontmatter = content.slice(0, fmEnd + 3)
  const body = content.slice(fmEnd + 3)

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}:.*$`, 'm')
    let formatted: string
    if (Array.isArray(value)) {
      formatted = `${key}: [${value.join(', ')}]`
    } else if (typeof value === 'boolean') {
      formatted = `${key}: ${value}`
    } else {
      formatted = `${key}: ${value}`
    }

    if (regex.test(frontmatter)) {
      frontmatter = frontmatter.replace(regex, formatted)
    } else {
      // Insert before closing ---
      frontmatter = frontmatter.replace(/---\s*$/, `${formatted}\n---`)
    }
  }

  writeFileSync(filepath, frontmatter + body, 'utf8')
}

export function getBookmarkCount(vaultPath: string): { total: number; categorized: number; uncategorized: number } {
  const bookmarksDir = join(vaultPath, 'bookmarks')
  if (!existsSync(bookmarksDir)) return { total: 0, categorized: 0, uncategorized: 0 }

  const files = readdirSync(bookmarksDir).filter(f => f.endsWith('.md'))
  let categorized = 0
  let uncategorized = 0

  for (const file of files) {
    const content = readFileSync(join(bookmarksDir, file), 'utf8')
    if (content.includes('categorized: false')) {
      uncategorized++
    } else {
      categorized++
    }
  }

  return { total: files.length, categorized, uncategorized }
}
