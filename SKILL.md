---
name: xmarks
description: Search and query your content library — X/Twitter bookmarks and YouTube transcripts
allowed-tools: Read, Grep, Glob, mcp__qmd__query, mcp__qmd__get, mcp__qmd__multi_get, Bash(npx:*)
---

Search your xmarks content vault at `/Users/ryan/Obsidian/xmarks/`. Contains X/Twitter bookmarks and YouTube video transcripts with AI summaries, all with structured frontmatter and AI categorization.

## Vault Structure

```
~/Obsidian/xmarks/
  bookmarks/*.md   — X/Twitter bookmarks (source: bookmark)
  youtube/*.md     — YouTube videos with AI summaries (source: youtube)
  media/           — Thumbnails
```

### Twitter Bookmark Frontmatter
`tweetId`, `author`, `authorName`, `date`, `bookmarkedAt`, `categories`, `semanticTags`, `source`, `url`, `categorized`
Body: tweet text + optional `## Media`, `## Links`, `## Entities`

### YouTube Video Frontmatter
`videoId`, `title`, `channel`, `url`, `date`, `ingestedAt`, `duration`, `viewCount`, `likeCount`, `source`, `categories`, `semanticTags`, `categorized`
Body: title + metadata + AI summary (PHASE Analysis) or transcript excerpt

## Categories

tech, ai, business, design, culture, crypto, science, finance, health, productivity, marketing, engineering, open-source, startups, career, politics, humor, media, education, other

## How to Search

### QMD (semantic search — preferred)

```
mcp__qmd__query(
  searches: [
    { type: "lex", query: "keyword search terms" },
    { type: "vec", query: "natural language question" }
  ],
  collections: ["xmarks"],
  intent: "what you're looking for"
)
```

### Grep (precise filtering)

```bash
# Twitter: by author
Grep(pattern: 'author: "@elonmusk"', path: "~/Obsidian/xmarks/bookmarks")

# YouTube: by channel
Grep(pattern: 'channel: "All-In Podcast"', path: "~/Obsidian/xmarks/youtube")

# Either: by category or tag
Grep(pattern: 'categories:.*ai', path: "~/Obsidian/xmarks")

# Either: by semantic tag
Grep(pattern: 'semanticTags:.*large-language-models', path: "~/Obsidian/xmarks")
```

### Glob (date ranges)

```bash
# Twitter bookmarks from January 2026
Glob(pattern: "bookmarks/2026-01-*", path: "~/Obsidian/xmarks")

# YouTube videos from March 2026
Glob(pattern: "youtube/2026-03-*", path: "~/Obsidian/xmarks")

# All content from a date
Glob(pattern: "*/2026-03-15-*", path: "~/Obsidian/xmarks")
```

## Filtering by Source

When the user asks specifically about tweets/bookmarks, search only `bookmarks/`.
When they ask about YouTube/videos, search only `youtube/`.
When the query is general, search across both.

With QMD, all sources are in the `xmarks` collection. Use grep/glob path filtering to narrow by source when needed.

## Common Queries

When the user asks to:
- **Search all content**: QMD query with xmarks collection
- **Find tweets by author**: Grep for `author: "@handle"` in bookmarks/
- **Find videos by channel**: Grep for `channel: "Name"` in youtube/
- **Find by topic**: Grep for category/semanticTag, or QMD for fuzzy
- **Recent items**: Glob for date patterns
- **Summarize a topic**: Search, read matches, synthesize
- **Stats/counts**: Run `npm run xmarks -- status` from the xmarks project directory
- **Trigger sync**: Run `npm run xmarks -- sync` from the xmarks project directory
- **Categorize uncategorized**: Run `npm run xmarks -- categorize` from the xmarks project directory
