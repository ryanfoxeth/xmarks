#!/usr/bin/env node
import { homedir } from 'os'
import { join } from 'path'
import { loadConfig, getDecryptedCredentials, ensureVaultStructure } from './config.js'
import { runSetup } from './setup.js'
import { categorizeItems, estimateCost } from './categorize.js'
import { enrichItems, getEnrichmentCount } from './enrich.js'
import { runDaemon } from './daemon.js'
import { getItemCount } from './markdown.js'
import { allSources, getConfiguredSources, getAllFolders } from './sources/index.js'

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
      const sourceFilter = flags.source

      let sources = getConfiguredSources(config)
      if (sourceFilter) {
        sources = sources.filter(s => s.name === sourceFilter)
        if (sources.length === 0) {
          const available = allSources.map(s => s.name).join(', ')
          console.error(`  Unknown or unconfigured source: ${sourceFilter}`)
          console.error(`  Available sources: ${available}`)
          process.exit(1)
        }
      }

      if (sources.length === 0) {
        console.error('  No sources configured. Run: xmarks setup')
        process.exit(1)
      }

      console.log(`\n  Syncing ${sources.map(s => s.name).join(', ')}...`)

      for (const source of sources) {
        const result = await source.sync(config.vaultPath, config, msg => console.log(`  ${msg}`))

        if (result.error) {
          console.error(`  ${source.name} error: ${result.error}`)
          continue
        }

        console.log(`  ${source.name}: ${result.imported} imported, ${result.skipped} skipped, ${result.mediaDownloaded} media`)
      }

      console.log('')
      break
    }

    case 'categorize': {
      const config = requireConfig(vaultPath)
      const creds = getDecryptedCredentials(config)

      if (!creds.apiKey) {
        console.error('  Anthropic API key not configured. Run: xmarks setup')
        process.exit(1)
      }

      const folders = getAllFolders(config)
      const counts = getItemCount(config.vaultPath, folders)
      if (counts.uncategorized === 0) {
        console.log('\n  All items are already categorized!')
        break
      }

      const cost = estimateCost(counts.uncategorized, config.model)
      console.log(`\n  ${counts.uncategorized} uncategorized items across ${folders.join(', ')}`)
      console.log(`  Estimated cost: ${cost} (using ${config.model})`)
      console.log(`  Categorizing...\n`)

      const result = await categorizeItems(
        config.vaultPath,
        folders,
        creds.apiKey,
        config.model,
        (done, total) => {
          process.stdout.write(`\r  Progress: ${done}/${total}`)
        },
      )

      console.log(`\n\n  Done: ${result.categorized} categorized, ${result.errors} errors`)
      break
    }

    case 'enrich': {
      const config = requireConfig(vaultPath)
      const counts = getEnrichmentCount(config.vaultPath)

      if (counts.needsEnrichment === 0) {
        console.log('\n  No link-only bookmarks to enrich!')
        console.log(`  (${counts.enriched} already enriched)`)
        break
      }

      console.log(`\n  ${counts.needsEnrichment} link-only bookmarks to enrich`)
      console.log(`  (${counts.enriched} already enriched)`)
      console.log(`  Fetching article content...\n`)

      const result = await enrichItems(config.vaultPath, config, (done, total, msg) => {
        process.stdout.write(`\r  [${done}/${total}] ${msg ?? ''}`.padEnd(100))
      })

      console.log(`\n\n  Done: ${result.enriched} enriched, ${result.failed} failed`)
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

      const folders = getAllFolders(config)
      const counts = getItemCount(config.vaultPath, folders)
      const creds = getDecryptedCredentials(config)
      const configured = getConfiguredSources(config)

      console.log('\n  xmarks status')
      console.log('  ─────────────')
      console.log(`  Vault: ${config.vaultPath}`)
      console.log(`  Items: ${counts.total} total (${counts.categorized} categorized, ${counts.uncategorized} pending)`)
      console.log(`  Sources: ${configured.length > 0 ? configured.map(s => s.name).join(', ') : 'none configured'}`)

      // Per-source counts
      for (const source of configured) {
        const sourceCounts = getItemCount(config.vaultPath, [source.folder])
        console.log(`    ${source.name}: ${sourceCounts.total} items (${source.folder}/)`)
      }

      const enrichCounts = getEnrichmentCount(config.vaultPath)
      if (enrichCounts.needsEnrichment > 0 || enrichCounts.enriched > 0) {
        console.log(`  Enrichment: ${enrichCounts.enriched} enriched, ${enrichCounts.needsEnrichment} pending`)
      }

      console.log(`  Sync interval: ${config.syncIntervalMinutes} minutes`)
      console.log(`  Model: ${config.model}`)
      console.log(`  Twitter auth: ${creds.authToken ? 'configured' : 'not set'}`)
      console.log(`  Anthropic key: ${creds.apiKey ? 'configured' : 'not set'}`)

      if (config.sources?.youtube?.enabled) {
        const ytPaths = config.sources.youtube.watchPaths ?? (config.sources.youtube.watchPath ? [config.sources.youtube.watchPath] : [])
        for (const p of ytPaths) {
          console.log(`  YouTube watch: ${p}`)
        }
      }

      // Show last sync from log
      try {
        const { readFileSync } = await import('fs')
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
  xmarks — Content ingest system for Obsidian

  Usage: xmarks <command> [options]

  Commands:
    setup                 Interactive setup (sources, API keys)
    sync                  Sync all configured sources
    categorize            AI categorize uncategorized items
    enrich                Fetch article content for link-only bookmarks
    daemon                Background sync on interval (default: 5 min)
    status                Show sync status and item counts

  Options:
    --vault <path>        Vault path (default: ${DEFAULT_VAULT})
    --source <name>       Filter to a specific source (twitter, youtube)
    --interval <minutes>  Override sync interval for daemon

  Sources:
    twitter               X/Twitter bookmarks (requires cookies)
    youtube               YouTube transcripts (watches a directory)

  Examples:
    xmarks setup
    xmarks sync
    xmarks sync --source youtube
    xmarks categorize
    xmarks daemon
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
