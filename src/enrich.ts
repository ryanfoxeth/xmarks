// Article enrichment pipeline
// Detects link-only bookmarks and fetches the linked article content

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { updateFrontmatter } from './markdown.js'
import type { XmarksConfig } from './config.js'
import { getDecryptedCredentials } from './config.js'

export interface EnrichResult {
  enriched: number
  skipped: number
  failed: number
}

interface ArticleContent {
  title: string
  text: string
  siteName?: string
}

// A bookmark needs enrichment if its body is basically just URLs with no real text
function needsEnrichment(content: string): boolean {
  if (content.includes('enriched: true')) return false
  if (content.includes('## Article')) return false

  // Only enrich bookmarks
  if (!content.includes('source: bookmark')) return false

  const fmEnd = content.indexOf('---', 3)
  if (fmEnd === -1) return false
  const body = content.slice(fmEnd + 3)

  // Get text before any ## sections
  const sectionStart = body.indexOf('\n## ')
  const mainText = (sectionStart === -1 ? body : body.slice(0, sectionStart)).trim()

  // Strip URLs and see what's left
  const withoutUrls = mainText.replace(/https?:\/\/\S+/g, '').trim()
  return withoutUrls.length < 50
}

// Extract URLs — first from ## Links section, then from body text as fallback
function extractLinkedUrls(content: string): string[] {
  const urls: string[] = []

  // Primary: ## Links section (expanded URLs)
  const linksMatch = content.match(/## Links\n([\s\S]*?)(?=\n## |$)/)
  if (linksMatch) {
    const lines = linksMatch[1].split('\n')
    for (const line of lines) {
      const urlMatch = line.match(/^- (https?:\/\/\S+)/)
      if (urlMatch) urls.push(urlMatch[1])
    }
  }

  // Fallback: non-t.co URLs from the body text (between frontmatter and first ##)
  // t.co links in tweet bodies are almost always media refs (photo/video), not articles
  if (urls.length === 0) {
    const fmEnd = content.indexOf('---', 3)
    if (fmEnd !== -1) {
      const body = content.slice(fmEnd + 3)
      const sectionStart = body.indexOf('\n## ')
      const mainText = sectionStart === -1 ? body : body.slice(0, sectionStart)
      const bodyUrls = mainText.match(/https?:\/\/\S+/g)
      if (bodyUrls) {
        // Only include non-t.co URLs — those are actual article/blog links
        urls.push(...bodyUrls.filter(u => !u.includes('t.co/')))
      }
    }
  }

  return urls
}

// Decode common HTML entities
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
}

// Strip HTML tags and clean whitespace
function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// Extract readable text from HTML page
function extractReadableText(html: string): ArticleContent | null {
  // Extract metadata
  const ogTitle = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]*)"[^>]*>/i)
  const htmlTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = stripHtml(ogTitle?.[1] ?? htmlTitle?.[1] ?? '')

  const siteMatch = html.match(/<meta\s+(?:property|name)="og:site_name"\s+content="([^"]*)"[^>]*>/i)
  const siteName = siteMatch ? decodeEntities(siteMatch[1]) : undefined

  // Remove unwanted blocks before extraction
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  // Try content selectors in order of specificity
  let text = ''
  const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)

  if (articleMatch) text = stripHtml(articleMatch[1])
  else if (mainMatch) text = stripHtml(mainMatch[1])
  else text = stripHtml(cleaned)

  // If too short, try meta description as fallback
  if (text.length < 100) {
    const ogDesc = html.match(/<meta\s+(?:property|name)="(?:og:)?description"\s+content="([^"]*)"[^>]*>/i)
    if (ogDesc && ogDesc[1].length > text.length) {
      text = stripHtml(ogDesc[1])
    }
  }

  // Also check for JSON-LD structured data (common on blogs)
  if (text.length < 100) {
    const jsonLd = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd[1])
        const body = data.articleBody ?? data.text ?? data.description ?? ''
        if (body.length > text.length) text = body
      } catch {
        // Invalid JSON-LD, skip
      }
    }
  }

  if (text.length < 50) return null

  // Cap at reasonable length
  if (text.length > 15000) text = text.slice(0, 15000) + '...'

  return { title, text, siteName }
}

// Fetch a URL and extract article content
async function fetchArticle(
  url: string,
  cookies?: { authToken: string; ct0: string },
): Promise<ArticleContent | null> {
  // X Articles (x.com/i/article/...) are SPAs — use Twitter API instead
  if (url.match(/x\.com\/i\/article\/\d+/)) {
    return cookies ? fetchXArticleViaApi(url, cookies) : null
  }

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  }

  try {
    const res = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) return null

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null
    }

    const html = await res.text()
    return extractReadableText(html)
  } catch {
    return null
  }
}

// Fetch X Article metadata via Twitter's TweetDetail GraphQL API
// Uses the bookmark's tweet ID to get article title + preview text
const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
const TWEET_DETAIL_QUERY_ID = 'nBS-WpgA6ZG0CyNHD517JQ'

async function fetchXArticleViaApi(
  articleUrl: string,
  cookies: { authToken: string; ct0: string },
): Promise<ArticleContent | null> {
  // We need the tweet ID that links to this article.
  // The article URL has the article ID, but the tweet ID is different.
  // We'll look it up from the bookmark file via the caller — but for API use,
  // we need to find the tweet that references this article.
  // Approach: use the article ID to search for it in the TweetDetail response.
  // For now, return null — the caller will pass the tweetId separately.
  return null
}

// Fetch X Article content given the tweet ID that contains it
async function fetchXArticleByTweetId(
  tweetId: string,
  cookies: { authToken: string; ct0: string },
): Promise<ArticleContent | null> {
  const variables = JSON.stringify({
    focalTweetId: tweetId,
    with_rux_injections: false,
    rankingMode: 'Relevance',
    includePromotedContent: false,
    withCommunity: false,
    withQuickPromoteEligibilityTweetFields: false,
    withBirdwatchNotes: false,
    withVoice: false,
  })
  const features = JSON.stringify({
    articles_preview_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  })

  const url = `https://x.com/i/api/graphql/${TWEET_DETAIL_QUERY_ID}/TweetDetail?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${BEARER}`,
        'X-Csrf-Token': cookies.ct0,
        Cookie: `auth_token=${cookies.authToken}; ct0=${cookies.ct0}`,
        'X-Twitter-Auth-Type': 'OAuth2Session',
        'X-Twitter-Active-User': 'yes',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()

    // Navigate to the tweet and extract article data
    const instructions =
      data?.data?.threaded_conversation_with_injections_v2?.instructions ?? []
    for (const inst of instructions) {
      for (const entry of inst.entries ?? []) {
        const result = entry?.content?.itemContent?.tweet_results?.result
        if (!result) continue
        const tweet =
          result.__typename === 'TweetWithVisibilityResults' ? result.tweet : result
        if (tweet?.rest_id !== tweetId) continue

        const article = tweet.article?.article_results?.result
        if (!article) continue

        const title = article.title ?? ''
        const previewText = article.preview_text ?? ''
        if (!title && !previewText) continue

        return {
          title,
          text: previewText,
          siteName: 'X Article',
        }
      }
    }
  } catch {
    // API call failed
  }
  return null
}

// Extract tweet ID from bookmark frontmatter
function extractTweetId(content: string): string | null {
  const match = content.match(/^tweetId: "(\d+)"$/m)
  return match?.[1] ?? null
}

// Check if any URL is an X Article
function hasXArticleUrl(urls: string[]): boolean {
  return urls.some(u => u.match(/x\.com\/i\/article\/\d+/))
}

interface UnenrichedItem {
  filepath: string
  content: string
  urls: string[]
  tweetId: string | null
}

// Get all bookmark files that need enrichment
function getUnenrichedItems(vaultPath: string): UnenrichedItem[] {
  const bookmarksDir = join(vaultPath, 'bookmarks')
  if (!existsSync(bookmarksDir)) return []

  const items: UnenrichedItem[] = []
  const files = readdirSync(bookmarksDir).filter(f => f.endsWith('.md'))

  for (const file of files) {
    const filepath = join(bookmarksDir, file)
    const content = readFileSync(filepath, 'utf8')

    if (needsEnrichment(content)) {
      const urls = extractLinkedUrls(content)
      if (urls.length > 0) {
        items.push({ filepath, content, urls, tweetId: extractTweetId(content) })
      }
    }
  }

  return items
}

// Inject article content into an existing bookmark markdown file
function injectArticleContent(filepath: string, content: string, article: ArticleContent): void {
  const fmEnd = content.indexOf('---', 3)
  if (fmEnd === -1) return

  const frontmatter = content.slice(0, fmEnd + 3)
  const body = content.slice(fmEnd + 3)

  // Build the article section
  let articleSection = '\n'
  articleSection += article.title ? `## ${article.title}\n\n` : '## Article\n\n'
  if (article.siteName) articleSection += `*From ${article.siteName}*\n\n`
  articleSection += article.text + '\n'

  // Insert article between tweet text and existing ## sections
  const firstSection = body.indexOf('\n## ')
  const tweetText = firstSection === -1 ? body : body.slice(0, firstSection)
  const existingSections = firstSection === -1 ? '' : body.slice(firstSection)

  const newContent = frontmatter + tweetText + '\n' + articleSection + existingSections
  writeFileSync(filepath, newContent, 'utf8')

  // Mark as enriched
  updateFrontmatter(filepath, { enriched: true })
}

// Main enrichment pipeline
export async function enrichItems(
  vaultPath: string,
  config: XmarksConfig,
  onProgress?: (done: number, total: number, msg?: string) => void,
): Promise<EnrichResult> {
  const items = getUnenrichedItems(vaultPath)
  if (items.length === 0) return { enriched: 0, skipped: 0, failed: 0 }

  const creds = getDecryptedCredentials(config)
  const cookies =
    creds.authToken && creds.ct0 ? { authToken: creds.authToken, ct0: creds.ct0 } : undefined

  let enriched = 0
  let skipped = 0
  let failed = 0

  for (const { filepath, content, urls, tweetId } of items) {
    const filename = filepath.split('/').pop() ?? filepath
    let articleContent: ArticleContent | null = null

    // For X Articles, use the Twitter API to fetch title + preview
    if (hasXArticleUrl(urls) && tweetId && cookies) {
      onProgress?.(enriched + skipped + failed, items.length, `X Article via API: ${filename}`)
      articleContent = await fetchXArticleByTweetId(tweetId, cookies)
    }

    // For regular URLs (or if X Article API didn't return content), try HTML fetch
    if (!articleContent || articleContent.text.length < 50) {
      for (const url of urls) {
        // Skip X Article URLs — they're SPAs, HTML fetch won't work
        if (url.match(/x\.com\/i\/article\/\d+/)) continue
        onProgress?.(enriched + skipped + failed, items.length, `Fetching ${url.slice(0, 60)}...`)
        articleContent = await fetchArticle(url, cookies)
        if (articleContent && articleContent.text.length >= 100) break
        articleContent = null
      }
    }

    if (!articleContent) {
      onProgress?.(enriched + skipped + failed + 1, items.length, `No content: ${filename}`)
      failed++
      await new Promise(r => setTimeout(r, 300))
      continue
    }

    injectArticleContent(filepath, content, articleContent)
    enriched++

    onProgress?.(
      enriched + skipped + failed,
      items.length,
      `Enriched: ${filename} (${articleContent.text.length} chars)`,
    )

    // Rate limit between fetches
    await new Promise(r => setTimeout(r, 500))
  }

  return { enriched, skipped, failed }
}

// Count items that need enrichment (matches actual pipeline logic — requires URLs)
export function getEnrichmentCount(
  vaultPath: string,
): { needsEnrichment: number; enriched: number } {
  const bookmarksDir = join(vaultPath, 'bookmarks')
  if (!existsSync(bookmarksDir)) return { needsEnrichment: 0, enriched: 0 }

  let needs = 0
  let done = 0
  const files = readdirSync(bookmarksDir).filter(f => f.endsWith('.md'))

  for (const file of files) {
    const content = readFileSync(join(bookmarksDir, file), 'utf8')
    if (content.includes('enriched: true')) done++
    else if (needsEnrichment(content) && extractLinkedUrls(content).length > 0) needs++
  }

  return { needsEnrichment: needs, enriched: done }
}
