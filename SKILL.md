---
name: xmarks
description: Search and query your X/Twitter bookmarks
allowed-tools: Bash(npx:*), Read, Grep, Glob
---

Query your X/Twitter bookmarks stored in your xmarks Obsidian vault.

## Vault Structure

- `bookmarks/*.md` — One file per bookmarked tweet with YAML frontmatter
- Frontmatter fields: `tweetId`, `author`, `authorName`, `date`, `bookmarkedAt`, `categories`, `semanticTags`, `source`, `url`, `categorized`
- Body contains tweet text, optional `## Media`, `## Links`, `## Entities` sections

## Available Categories

tech, ai, business, design, culture, crypto, science, finance, health, productivity, marketing, engineering, open-source, startups, career, politics, humor, media, education, other

## How to Search

Use QMD for semantic search across bookmarks (if installed):

```
# Keyword search (fast)
mcp__qmd__search(query, collection: "xmarks")

# Semantic/meaning search (slower, finds related concepts)
mcp__qmd__vector_search(query, collection: "xmarks")

# Deep search (thorough, auto-expands query)
mcp__qmd__deep_search(query, collection: "xmarks")
```

Use Grep for precise filtering:

```bash
# Find bookmarks by author
Grep(pattern: 'author: "@elonmusk"', path: "~/Obsidian/xmarks/bookmarks")

# Find bookmarks by category
Grep(pattern: 'categories:.*ai', path: "~/Obsidian/xmarks/bookmarks")

# Find bookmarks by semantic tag
Grep(pattern: 'semanticTags:.*large-language-models', path: "~/Obsidian/xmarks/bookmarks")

# Find bookmarks by date range
Glob(pattern: "bookmarks/2026-01-*", path: "~/Obsidian/xmarks")
```

## Common Queries

When the user asks to:
- **Search bookmarks**: Use QMD search with the xmarks collection
- **Find by author**: Grep for `author: "@handle"`
- **Find by topic/category**: Grep for category or semanticTag, or use QMD for fuzzy matching
- **Recent bookmarks**: Glob for recent date patterns or sort by `bookmarkedAt`
- **Summarize a topic**: Search for the topic, read matching bookmarks, synthesize
- **Stats/counts**: Run `npm run xmarks -- status` from the xmarks project directory
- **Trigger sync**: Run `npm run xmarks -- sync` from the xmarks project directory
- **Categorize uncategorized**: Run `npm run xmarks -- categorize` from the xmarks project directory
