import { execSync } from 'child_process'
import type { XmarksConfig } from './config.js'
import { getDecryptedCredentials } from './config.js'
import { getConfiguredSources, getAllFolders } from './sources/index.js'
import { categorizeItems } from './categorize.js'
import { enrichItems, getEnrichmentCount } from './enrich.js'
import { getItemCount } from './markdown.js'

function sendNotification(title: string, message: string): void {
  try {
    execSync(
      `osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`,
    )
  } catch {
    // Notification is best-effort
  }
}

function isAuthError(error: string): boolean {
  const authPatterns = [
    'status 401',
    'status 403',
    'Unauthorized',
    'Forbidden',
    'auth failed',
    'expired',
    'BadRequest',
    'Could not authenticate',
  ]
  return authPatterns.some(p => error.includes(p))
}

export async function runDaemon(config: XmarksConfig): Promise<void> {
  const sources = getConfiguredSources(config)

  if (sources.length === 0) {
    console.error('  No sources configured. Run: xmarks setup')
    process.exit(1)
  }

  const intervalMs = config.syncIntervalMinutes * 60 * 1000

  console.log(`\n  xmarks daemon`)
  console.log(`  ─────────────`)
  console.log(`  Vault: ${config.vaultPath}`)
  console.log(`  Sources: ${sources.map(s => s.name).join(', ')}`)
  console.log(`  Interval: every ${config.syncIntervalMinutes} minutes`)
  console.log(`  Model: ${config.model}`)
  console.log(`  Press Ctrl+C to stop\n`)

  // Run immediately on start
  await runSyncCycle(config, sources)

  // Then on interval
  const timer = setInterval(() => void runSyncCycle(config, sources), intervalMs)

  const shutdown = () => {
    console.log('\n  Stopping daemon...')
    clearInterval(timer)
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function runSyncCycle(config: XmarksConfig, sources: ReturnType<typeof getConfiguredSources>): Promise<void> {
  const now = new Date().toLocaleTimeString()
  let totalImported = 0

  for (const source of sources) {
    console.log(`  [${now}] Syncing ${source.name}...`)

    try {
      const result = await source.sync(config.vaultPath, config)

      if (result.error) {
        console.log(`  [${now}] ${source.name} error: ${result.error}`)

        if (source.name === 'twitter' && isAuthError(result.error)) {
          sendNotification(
            'xmarks — Cookies Expired',
            'Twitter session cookies have expired. Run: xmarks setup to refresh.',
          )
          console.log('  Twitter cookies expired — other sources will continue.')
        }
        continue
      }

      console.log(`  [${now}] ${source.name}: ${result.imported} new, ${result.skipped} existing, ${result.mediaDownloaded} media`)
      totalImported += result.imported
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  [${now}] ${source.name} error: ${msg}`)

      if (source.name === 'twitter' && isAuthError(msg)) {
        sendNotification(
          'xmarks — Cookies Expired',
          'Twitter session cookies have expired. Run: xmarks setup to refresh.',
        )
        console.log('  Twitter cookies expired — other sources will continue.')
      }
    }
  }

  // Auto-categorize if API key is configured and there are new items
  const creds = getDecryptedCredentials(config)
  if (creds.apiKey && totalImported > 0) {
    const folders = getAllFolders(config)
    console.log(`  [${now}] Categorizing ${totalImported} new items...`)
    const catResult = await categorizeItems(
      config.vaultPath,
      folders,
      creds.apiKey,
      config.model,
    )
    console.log(`  [${now}] Categorized: ${catResult.categorized} done, ${catResult.errors} errors`)
  }

  // Auto-enrich link-only bookmarks
  const enrichCounts = getEnrichmentCount(config.vaultPath)
  if (enrichCounts.needsEnrichment > 0) {
    console.log(`  [${now}] Enriching ${enrichCounts.needsEnrichment} link-only bookmarks...`)
    const enrichResult = await enrichItems(config.vaultPath, config)
    console.log(`  [${now}] Enriched: ${enrichResult.enriched} done, ${enrichResult.failed} failed`)
  }

  const folders = getAllFolders(config)
  const counts = getItemCount(config.vaultPath, folders)
  console.log(`  [${now}] Total: ${counts.total} items (${counts.categorized} categorized, ${counts.uncategorized} pending)`)
  console.log(`  [${now}] Next sync in ${config.syncIntervalMinutes} minutes`)
}
