# xmarks

A content ingest system for Obsidian. Syncs X/Twitter bookmarks and YouTube videos into structured markdown files with AI-powered categorization and article enrichment.

xmarks runs as a background daemon, polling your sources and writing each item as a structured markdown file with frontmatter — ready for Dataview queries, graph exploration, and AI-assisted search via Claude Code.

## Features

- **Multi-source ingest** — Twitter bookmarks and YouTube videos (extensible to more sources)
- **AI categorization** — Claude automatically tags items with categories, semantic tags, and entities
- **Article enrichment** — Fetches linked article content for link-only bookmarks (GitHub repos, blog posts, X Articles, etc.)
- **Obsidian-native** — Each item is a `.md` file with structured frontmatter
- **Thumbnails** — Media thumbnails downloaded locally
- **Encrypted credentials** — Cookies and API keys encrypted at rest (AES-256-CBC)
- **Cookie expiry detection** — macOS notification when session cookies expire
- **Cost estimation** — Shows estimated API cost before running categorization
- **Incremental sync** — O(1) dedup via ID indexes, only processes new items
- **launchd service** — Auto-start on macOS login

## Setup

```bash
git clone https://github.com/ryanfoxeth/xmarks.git
cd xmarks
npm install
```

### Configure

```bash
npm run xmarks -- setup
```

This will ask for:
1. **Twitter cookies** — `auth_token` and `ct0` from your browser (x.com → DevTools → Application → Cookies)
2. **Anthropic API key** — For AI categorization (optional, sync works without it)
3. **YouTube watch paths** — Directories containing YouTube transcript JSON files (optional)
4. **Sync interval** — How often to check for new items (default: 5 minutes)
5. **AI model** — Which Claude model to use (default: Haiku for cost efficiency)

Credentials are encrypted and stored in `xmarks.config.json` inside your vault.

## Usage

```bash
# One-shot sync all sources
npm run xmarks -- sync

# Sync a specific source
npm run xmarks -- sync --source twitter
npm run xmarks -- sync --source youtube

# AI categorize uncategorized items
npm run xmarks -- categorize

# Fetch article content for link-only bookmarks
npm run xmarks -- enrich

# Background daemon (sync + categorize + enrich)
npm run xmarks -- daemon

# Check status
npm run xmarks -- status
```

### Options

```
--vault <path>        Vault path (default: ~/Obsidian/xmarks)
--source <name>       Filter to a specific source (twitter, youtube)
--interval <minutes>  Override daemon sync interval
```

## Install as macOS Service

```bash
# Creates and loads a launchd plist (auto-starts on login)
bash launchd/install.sh
```

## Vault Structure

```
~/Obsidian/xmarks/
  ├── bookmarks/         ← one .md per Twitter bookmark
  ├── youtube/           ← one .md per YouTube video
  ├── media/             ← downloaded thumbnails
  ├── xmarks.config.json ← encrypted credentials
  ├── sync.log           ← sync history
  ├── .tweet-ids         ← Twitter dedup index
  └── .youtube-ids       ← YouTube dedup index
```

## Item Formats

### Twitter Bookmark

`bookmarks/2026-03-08-@someuser-just-shipped-a-new-tool.md`:

```yaml
---
tweetId: "1234567890"
author: "@someuser"
authorName: "Some User"
date: 2026-03-08
bookmarkedAt: 2026-03-08T12:00:00.000Z
categories: [ai, tech]
semanticTags: [large-language-models, developer-tools]
source: bookmark
url: https://x.com/someuser/status/1234567890
categorized: true
enriched: true
---

Just shipped a new tool for...

## Article Title

*From GitHub*

Full extracted article content here...

## Media
![[media/1234567890-0.jpg]]

## Links
- https://example.com

## Entities
- @anthropic
- Claude
```

### YouTube Video

`youtube/2026-03-20-no-priors-ai-machine-andrej-karpathy-on-code-agents.md`:

```yaml
---
videoId: "kwSVtQ7dziU"
title: "Andrej Karpathy on Code Agents"
channel: "No Priors"
url: https://www.youtube.com/watch?v=kwSVtQ7dziU
date: 2026-03-20
ingestedAt: 2026-03-21T16:21:10.000Z
duration: 3992
viewCount: 56916
likeCount: 2122
source: youtube
categories: [ai, tech]
semanticTags: [ai-agents, code-generation]
categorized: true
---

# Andrej Karpathy on Code Agents

**Channel:** No Priors
**Duration:** 1:06:32

AI summary or transcript excerpt...
```

## Article Enrichment

When xmarks encounters a bookmark that's just a URL with no real text content, the `enrich` command fetches the linked article and injects the content into the markdown file.

**Supported sources:**
- **Regular web pages** (GitHub, blogs, Substack, news sites) — HTML fetch with content extraction from `<article>`, `<main>`, JSON-LD, and meta tags
- **X Articles** (`x.com/i/article/...`) — Fetches title and preview text via Twitter's GraphQL API

Enrichment runs automatically in the daemon after each sync cycle, or manually via `xmarks enrich`.

## Architecture

```
xmarks (Node.js daemon)
  1. Poll sources on interval (Twitter API, YouTube watch dirs)
  2. New item → write .md file to vault
  3. Download media thumbnails
  4. Run Claude to categorize + tag
  5. Fetch article content for link-only bookmarks
  6. Update frontmatter with results

Sources are pluggable — each implements sync(), folder, and indexFile.
```

## QMD Integration (Recommended)

[QMD](https://github.com/tobi/qmd) is a local semantic search engine for markdown files. Adding your xmarks vault as a QMD collection gives you semantic search, query expansion, and reranking across all your items — far more powerful than grep for finding conceptually related content.

```bash
# Install QMD
npm install -g @tobilu/qmd

# Add your xmarks vault as a collection in ~/.config/qmd/index.yml:
#   xmarks:
#     path: ~/Obsidian/xmarks
#     glob: "**/*.md"

# Index your vault
qmd embed -c xmarks

# Search
qmd search "AI agent frameworks" -c xmarks
qmd query "what are people saying about open source LLMs" -c xmarks
```

With QMD indexed, you can search by meaning rather than exact keywords — e.g., searching "startup fundraising" will surface bookmarks about seed rounds, pitch decks, and VC even if none of them contain the word "fundraising."

## Claude Code Skill

xmarks includes a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill for natural-language querying of your vault. Copy the skill file to your Claude Code skills directory:

```bash
mkdir -p ~/.claude/skills/xmarks
cp SKILL.md ~/.claude/skills/xmarks/SKILL.md
```

Then use `/xmarks` in any Claude Code session:

- `/xmarks what have I bookmarked about AI agents this month`
- `/xmarks find everything from @anthropic`
- `/xmarks summarize the crypto bookmarks from last week`
- `/xmarks find YouTube videos about code agents`

The skill uses QMD for semantic search when available, and falls back to grep/glob for precise filtering. It can also trigger syncs and categorization directly from the conversation.

## Security

- **No keychain access** — You explicitly provide your own cookies via the setup wizard
- **No server/tunnel** — Runs entirely on localhost
- **Encrypted at rest** — Credentials stored with AES-256-CBC using a machine-derived key
- **Direct API calls only** — Talks to `x.com` and `api.anthropic.com`, nothing else

## License

MIT
