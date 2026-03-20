// Twitter internal GraphQL API for bookmarks
// Uses session cookies (auth_token + ct0) — same approach as all unofficial Twitter tools

const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

const FEATURES = JSON.stringify({
  graphql_timeline_v2_bookmark_timeline: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: false,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
})

// Twitter's internal GraphQL query ID for Bookmarks
// This can change when Twitter deploys — update if you get 400 errors
const QUERY_ID = 'xLjCVTqYWz8CGSprLU349w'

export interface TweetData {
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  createdAt: Date | null
  mediaUrls: { type: string; url: string; thumbnailUrl: string }[]
  urls: string[]
  rawJson: string
}

interface MediaVariant {
  content_type?: string
  bitrate?: number
  url?: string
}

interface MediaEntity {
  type?: string
  media_url_https?: string
  video_info?: { variants?: MediaVariant[] }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TweetResult = any

export async function fetchBookmarksPage(
  authToken: string,
  ct0: string,
  cursor?: string,
): Promise<{ tweets: TweetData[]; nextCursor: string | null }> {
  const variables = JSON.stringify({
    count: 100,
    includePromotedContent: false,
    ...(cursor ? { cursor } : {}),
  })

  const url = `https://x.com/i/api/graphql/${QUERY_ID}/Bookmarks?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(FEATURES)}`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BEARER}`,
      'X-Csrf-Token': ct0,
      Cookie: `auth_token=${authToken}; ct0=${ct0}`,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Client-Language': 'en',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://x.com/i/bookmarks',
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Twitter auth failed (${res.status}). Cookies may be expired. Run: xmarks setup`)
    }
    throw new Error(`Twitter API error ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  return parsePage(data)
}

function parsePage(data: unknown): { tweets: TweetData[]; nextCursor: string | null } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instructions = (data as any)?.data?.bookmark_timeline_v2?.timeline?.instructions ?? []
  const tweets: TweetData[] = []
  let nextCursor: string | null = null

  for (const instruction of instructions) {
    if (instruction.type !== 'TimelineAddEntries') continue
    for (const entry of instruction.entries ?? []) {
      const content = entry.content
      if (content?.entryType === 'TimelineTimelineItem') {
        let tweet: TweetResult = content?.itemContent?.tweet_results?.result
        if (tweet?.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
          tweet = tweet.tweet
        }
        if (tweet?.rest_id) {
          tweets.push(extractTweetData(tweet))
        }
      } else if (
        content?.entryType === 'TimelineTimelineCursor' &&
        content?.cursorType === 'Bottom'
      ) {
        nextCursor = content.value ?? null
      }
    }
  }

  return { tweets, nextCursor }
}

function extractTweetData(tweet: TweetResult): TweetData {
  const legacy = tweet.legacy ?? {}
  const userLegacy = tweet.core?.user_results?.result?.legacy ?? {}
  const noteText = tweet.note_tweet?.note_tweet_results?.result?.text
  const text: string = noteText ?? legacy.full_text ?? ''

  const rawDate = legacy.created_at
  let createdAt: Date | null = null
  if (rawDate) {
    const d = new Date(rawDate)
    if (!isNaN(d.getTime())) createdAt = d
  }

  const mediaEntities: MediaEntity[] =
    legacy.extended_entities?.media ?? legacy.entities?.media ?? []

  const mediaUrls = mediaEntities
    .map((m: MediaEntity) => {
      const thumb = m.media_url_https ?? ''
      if (m.type === 'video' || m.type === 'animated_gif') {
        return { type: m.type === 'animated_gif' ? 'gif' : 'video', url: thumb, thumbnailUrl: thumb }
      }
      if (!thumb) return null
      return { type: 'photo', url: thumb, thumbnailUrl: thumb }
    })
    .filter(Boolean) as { type: string; url: string; thumbnailUrl: string }[]

  // Extract URLs from entities
  const urls: string[] = (legacy.entities?.urls ?? [])
    .map((u: { expanded_url?: string }) => u.expanded_url)
    .filter(Boolean)

  return {
    tweetId: tweet.rest_id,
    text,
    authorHandle: userLegacy.screen_name ?? 'unknown',
    authorName: userLegacy.name ?? 'Unknown',
    createdAt,
    mediaUrls,
    urls,
    rawJson: JSON.stringify(tweet),
  }
}

// Test connection by fetching first page
export async function testConnection(authToken: string, ct0: string): Promise<number> {
  const { tweets } = await fetchBookmarksPage(authToken, ct0)
  return tweets.length
}
