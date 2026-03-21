import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import type { Source, SyncResult } from './types.js'
import type { XmarksConfig } from '../config.js'
import { loadItemIndex, appendToItemIndex } from '../markdown.js'
import { downloadMedia } from '../media.js'

interface YouTubeVideo {
  video_id: string
  url: string
  title: string
  thumbnail: string
  description: string
  duration: number
  like_count: number
  view_count: number
  channel: string
  channel_id: string
  channel_url: string
  published_at: string
  transcript_text: string
}

function slugify(text: string, maxLen = 50): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .replace(/-$/, '')
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function videoToMarkdown(video: YouTubeVideo, aiSummary: string | null): string {
  const date = video.published_at ? video.published_at.split('T')[0] : new Date().toISOString().split('T')[0]
  const now = new Date().toISOString()
  const escapedTitle = (video.title ?? '').replace(/"/g, '\\"')
  const escapedChannel = (video.channel ?? '').replace(/"/g, '\\"')

  let fm = `---\n`
  fm += `videoId: "${video.video_id}"\n`
  fm += `title: "${escapedTitle}"\n`
  fm += `channel: "${escapedChannel}"\n`
  fm += `url: ${video.url}\n`
  fm += `date: ${date}\n`
  fm += `ingestedAt: ${now}\n`
  fm += `duration: ${video.duration ?? 0}\n`
  fm += `viewCount: ${video.view_count ?? 0}\n`
  fm += `likeCount: ${video.like_count ?? 0}\n`
  fm += `source: youtube\n`
  fm += `categories: []\n`
  fm += `semanticTags: []\n`
  fm += `categorized: false\n`
  fm += `---\n`

  let body = `\n# ${video.title}\n\n`
  body += `**Channel:** ${video.channel}\n`
  body += `**Duration:** ${formatDuration(video.duration ?? 0)}\n`
  body += `**Views:** ${(video.view_count ?? 0).toLocaleString()}\n`

  if (video.thumbnail) {
    body += `\n![[media/yt-${video.video_id}.jpg]]\n`
  }

  if (aiSummary) {
    body += `\n${aiSummary}\n`
  } else if (video.transcript_text) {
    const maxLen = 3000
    const text = video.transcript_text
    const truncated = text.length > maxLen
      ? text.slice(0, maxLen) + '\n\n*[transcript truncated]*'
      : text
    body += `\n## Transcript\n\n${truncated}\n`
  }

  return fm + body
}

function generateFilename(video: YouTubeVideo): string {
  const date = video.published_at ? video.published_at.split('T')[0] : new Date().toISOString().split('T')[0]
  const channelSlug = slugify(video.channel ?? 'unknown', 20)
  const titleSlug = slugify(video.title ?? video.video_id, 50)
  return `${date}-${channelSlug}-${titleSlug}.md`
}

export const youtubeSource: Source = {
  name: 'youtube',
  folder: 'youtube',

  isConfigured(config: XmarksConfig): boolean {
    const ytConfig = config.sources?.youtube
    return !!(ytConfig?.enabled && ytConfig?.watchPath)
  },

  async sync(vaultPath: string, config: XmarksConfig, onProgress?: (msg: string) => void): Promise<SyncResult> {
    const ytConfig = config.sources?.youtube
    if (!ytConfig?.watchPath) {
      return { source: 'youtube', imported: 0, skipped: 0, mediaDownloaded: 0, error: 'YouTube watchPath not configured' }
    }

    const jsonDir = join(ytConfig.watchPath, 'json')
    const summaryDir = join(ytConfig.watchPath, 'ai_summary')
    const youtubeDir = join(vaultPath, 'youtube')

    if (!existsSync(jsonDir)) {
      return { source: 'youtube', imported: 0, skipped: 0, mediaDownloaded: 0, error: `JSON directory not found: ${jsonDir}` }
    }

    if (!existsSync(youtubeDir)) {
      mkdirSync(youtubeDir, { recursive: true })
    }

    let imported = 0
    let skipped = 0
    let mediaDownloaded = 0

    const index = loadItemIndex(vaultPath, '.youtube-ids')
    onProgress?.(`[youtube] Loaded index: ${index.size} known videos`)

    const jsonFiles = readdirSync(jsonDir).filter(f => f.endsWith('.json'))
    onProgress?.(`[youtube] Found ${jsonFiles.length} JSON files`)

    for (const jsonFile of jsonFiles) {
      try {
        const raw = readFileSync(join(jsonDir, jsonFile), 'utf8')
        const video: YouTubeVideo = JSON.parse(raw)

        if (!video.video_id) {
          skipped++
          continue
        }

        if (index.has(video.video_id)) {
          skipped++
          continue
        }

        // Look for matching AI summary
        const summaryFilename = jsonFile.replace(/\.json$/, '.txt')
        const summaryPath = join(summaryDir, summaryFilename)
        let aiSummary: string | null = null
        if (existsSync(summaryPath)) {
          aiSummary = readFileSync(summaryPath, 'utf8')
        }

        const filename = generateFilename(video)
        const content = videoToMarkdown(video, aiSummary)
        writeFileSync(join(youtubeDir, filename), content, 'utf8')

        index.add(video.video_id)
        appendToItemIndex(vaultPath, '.youtube-ids', video.video_id)
        imported++

        // Download thumbnail
        if (video.thumbnail) {
          const dl = await downloadMedia(vaultPath, [{
            url: video.thumbnail,
            filename: `yt-${video.video_id}.jpg`,
          }])
          mediaDownloaded += dl
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        onProgress?.(`[youtube] Error processing ${jsonFile}: ${msg}`)
        skipped++
      }
    }

    const logLine = `${new Date().toISOString()} | youtube | imported: ${imported}, skipped: ${skipped}, media: ${mediaDownloaded}\n`
    appendFileSync(join(vaultPath, 'sync.log'), logLine, 'utf8')

    return { source: 'youtube', imported, skipped, mediaDownloaded }
  },
}
