# xmarks

Live sync your X/Twitter bookmarks to an Obsidian vault with AI-powered categorization.

xmarks runs as a background daemon, polling your X bookmarks every few minutes and writing each one as a structured markdown file with frontmatter — ready for Dataview queries, graph exploration, and AI-assisted search via Claude Code.

## Features

- **Live sync** — Background daemon polls X bookmarks on a configurable interval
- **AI categorization** — Claude automatically tags bookmarks with categories, semantic tags, and entities
- **Obsidian-native** — Each bookmark is a `.md` file with structured frontmatter
- **Thumbnails** — Media thumbnails downloaded locally
- **Encrypted credentials** — Twitter cookies and API keys encrypted at rest (AES-256-CBC)
- **Cookie expiry detection** — macOS notification when session cookies expire
- **Cost estimation** — Shows estimated API cost before running categorization
- **Incremental sync** — O(1) dedup via tweet ID index, only fetches new bookmarks
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
3. **Sync interval** — How often to check for new bookmarks (default: 5 minutes)
4. **AI model** — Which Claude model to use (default: Haiku for cost efficiency)

Credentials are encrypted and stored in `xmarks.config.json` inside your vault.

## Usage

```bash
# One-shot sync
npm run xmarks -- sync

# AI categorize uncategorized bookmarks
npm run xmarks -- categorize

# Background daemon (sync + auto-categorize)
npm run xmarks -- daemon

# Check status
npm run xmarks -- status
```

### Options

```
--vault <path>        Vault path (default: ~/Obsidian/xmarks)
--interval <minutes>  Override daemon sync interval
```

## Install as macOS Service

```bash
# Creates and loads a launchd plist (auto-starts on login)
bash launchd/install.sh
```

## Bookmark Format

Each bookmark becomes a file like `bookmarks/2026-03-08-@someuser-just-shipped-a-new-tool.md`:

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
---

Just shipped a new tool for...

## Media
![[media/1234567890-0.jpg]]

## Links
- https://example.com

## Entities
- @anthropic
- Claude
```

## Architecture

```
xmarks (Node.js daemon)
  1. Poll x.com/i/api/graphql every N minutes
  2. New bookmark → write .md file to vault
  3. Download media thumbnails
  4. Run Claude to categorize + tag
  5. Update frontmatter with results

~/Obsidian/xmarks/
  ├── bookmarks/         ← one .md per bookmark
  ├── media/             ← downloaded thumbnails
  ├── xmarks.config.json ← encrypted credentials
  ├── sync.log           ← sync history
  └── .tweet-ids         ← dedup index
```

## QMD Integration (Recommended)

[QMD](https://github.com/tobi/qmd) is a local semantic search engine for markdown files. Adding your xmarks vault as a QMD collection gives you semantic search, query expansion, and reranking across all your bookmarks — far more powerful than grep for finding conceptually related content.

```bash
# Install QMD
npm install -g @tobilu/qmd

# Add your xmarks vault as a collection in ~/.config/qmd/index.yml:
#   xmarks:
#     path: ~/Obsidian/xmarks
#     glob: "bookmarks/**/*.md"

# Index your bookmarks
qmd embed -c xmarks

# Search
qmd search "AI agent frameworks" -c xmarks
qmd query "what are people saying about open source LLMs" -c xmarks
```

With QMD indexed, you can search by meaning rather than exact keywords — e.g., searching "startup fundraising" will surface bookmarks about seed rounds, pitch decks, and VC even if none of them contain the word "fundraising."

## Claude Code Skill

xmarks includes a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill for natural-language querying of your bookmarks. Copy the skill file to your Claude Code skills directory:

```bash
mkdir -p ~/.claude/skills/xmarks
cp SKILL.md ~/.claude/skills/xmarks/SKILL.md
```

Then use `/xmarks` in any Claude Code session:

- `/xmarks what have I bookmarked about AI agents this month`
- `/xmarks find everything from @anthropic`
- `/xmarks summarize the crypto bookmarks from last week`

The skill uses QMD for semantic search when available, and falls back to grep/glob for precise filtering. It can also trigger syncs and categorization directly from the conversation.

## Security

- **No keychain access** — You explicitly provide your own cookies via the setup wizard
- **No server/tunnel** — Runs entirely on localhost
- **Encrypted at rest** — Credentials stored with AES-256-CBC using a machine-derived key
- **Direct API calls only** — Talks to `x.com` and `api.anthropic.com`, nothing else

## License

MIT
