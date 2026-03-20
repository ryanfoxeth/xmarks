#!/usr/bin/env node
import { homedir } from 'os'
import { join } from 'path'
import { loadConfig, getDecryptedCredentials, ensureVaultStructure } from './config.js'
import { runSetup } from './setup.js'
import { syncBookmarks } from './sync.js'
import { categorizeBookmarks, estimateCost } from './categorize.js'
import { runDaemon } from './daemon.js'
import { getBookmarkCount } from './markdown.js'

const DEFAULT_VAULT = join(homedir(), 'Obsidian', 'xmarks')

function parseArgs(): { command: string; flags: Record<string, string> } {
  const args = process.argv.slice(2)
  const command = args[0] ?? 'help'
  const flags: Record<string, string> = {}

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = 'true'
      }
    }
  }

  return { command, flags }
}

function requireConfig(vaultPath: string) {
  const config = loadConfig(vaultPath)
  if (!config) {
    console.error('  No config found. Run: xmarks setup')
    process.exit(1)
  }
  return config
}

async function main() {
  const { command, flags } = parseArgs()
  const vaultPath = flags.vault ?? DEFAULT_VAULT

  switch (command) {
    case 'setup': {
      await runSetup(vaultPath)
      break
    }

    case 'sync': {
      const config = requireConfig(vaultPath)
      const creds = getDecryptedCredentials(config)

      if (!creds.authToken || !creds.ct0) {
        console.error('  Twitter credentials not configured. Run: xmarks setup')
        process.exit(1)
      }

      console.log('\n  Syncing bookmarks...')
      const result = await syncBookmarks(
        config.vaultPath,
        creds.authToken,
        creds.ct0,
        msg => console.log(`  ${msg}`),
      )

      if (result.error) {
        console.error(`  Error: ${result.error}`)
        process.exit(1)
      }

      console.log(`\n  Done: ${result.imported} imported, ${result.skipped} skipped, ${result.mediaDownloaded} thumbnails`)
      break
    }

    case 'categorize': {
      const config = requireConfig(vaultPath)
      const creds = getDecryptedCredentials(config)

      if (!creds.apiKey) {
        console.error('  Anthropic API key not configured. Run: xmarks setup')
        process.exit(1)
      }

      const counts = getBookmarkCount(config.vaultPath)
      if (counts.uncategorized === 0) {
        console.log('\n  All bookmarks are already categorized!')
        break
      }

      const cost = estimateCost(counts.uncategorized, config.model)
      console.log(`\n  ${counts.uncategorized} uncategorized bookmarks`)
      console.log(`  Estimated cost: ${cost} (using ${config.model})`)
      console.log(`  Categorizing...\n`)

      const result = await categorizeBookmarks(
        config.vaultPath,
        creds.apiKey,
        config.model,
        (done, total) => {
          process.stdout.write(`\r  Progress: ${done}/${total}`)
        },
      )

      console.log(`\n\n  Done: ${result.categorized} categorized, ${result.errors} errors`)
      break
    }

    case 'daemon': {
      const config = requireConfig(vaultPath)
      if (flags.interval) {
        config.syncIntervalMinutes = parseInt(flags.interval, 10) || 5
      }
      await runDaemon(config)
      break
    }

    case 'status': {
      const config = loadConfig(vaultPath)
      if (!config) {
        console.log('\n  xmarks is not configured.')
        console.log(`  Vault: ${vaultPath}`)
        console.log('  Run: xmarks setup\n')
        break
      }

      const counts = getBookmarkCount(config.vaultPath)
      const creds = getDecryptedCredentials(config)

      console.log('\n  xmarks status')
      console.log('  ─────────────')
      console.log(`  Vault: ${config.vaultPath}`)
      console.log(`  Bookmarks: ${counts.total} total (${counts.categorized} categorized, ${counts.uncategorized} pending)`)
      console.log(`  Sync interval: ${config.syncIntervalMinutes} minutes`)
      console.log(`  Model: ${config.model}`)
      console.log(`  Twitter auth: ${creds.authToken ? 'configured' : 'not set'}`)
      console.log(`  Anthropic key: ${creds.apiKey ? 'configured' : 'not set'}`)

      // Show last sync from log
      try {
        const { readFileSync } = await import('fs')
        const { join } = await import('path')
        const log = readFileSync(join(config.vaultPath, 'sync.log'), 'utf8')
        const lines = log.trim().split('\n')
        const lastLine = lines[lines.length - 1]
        console.log(`  Last sync: ${lastLine}`)
      } catch {
        console.log('  Last sync: never')
      }

      console.log('')
      break
    }

    case 'help':
    default: {
      console.log(`
  xmarks — Live X bookmark sync to Obsidian

  Usage: xmarks <command> [options]

  Commands:
    setup                 Interactive setup (cookies, API key, vault path)
    sync                  One-shot sync of bookmarks
    categorize            Run AI categorization on uncategorized bookmarks
    daemon                Background sync on interval (default: 5 min)
    status                Show sync status and bookmark counts

  Options:
    --vault <path>        Vault path (default: ${DEFAULT_VAULT})
    --interval <minutes>  Override sync interval for daemon

  Examples:
    xmarks setup
    xmarks sync
    xmarks categorize
    xmarks daemon
    xmarks daemon --interval 10
    xmarks status
`)
      break
    }
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
