import { execSync } from 'child_process'
import { getDecryptedCredentials, type XmarksConfig } from './config.js'
import { syncBookmarks } from './sync.js'
import { categorizeBookmarks } from './categorize.js'
import { getBookmarkCount } from './markdown.js'

function sendNotification(title: string, message: string): void {
  try {
    execSync(
      `osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`,
    )
  } catch {
    // Notification is best-effort, don't crash if it fails
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
  const creds = getDecryptedCredentials(config)

  if (!creds.authToken || !creds.ct0) {
    console.error('  Twitter credentials not configured. Run: xmarks setup')
    sendNotification('xmarks', 'Twitter credentials not configured. Run: xmarks setup')
    process.exit(1)
  }

  const intervalMs = config.syncIntervalMinutes * 60 * 1000

  console.log(`\n  xmarks daemon`)
  console.log(`  ─────────────`)
  console.log(`  Vault: ${config.vaultPath}`)
  console.log(`  Interval: every ${config.syncIntervalMinutes} minutes`)
  console.log(`  Model: ${config.model}`)
  console.log(`  Press Ctrl+C to stop\n`)

  // Run immediately on start
  await runSyncCycle(config, creds)

  // Then on interval
  const timer = setInterval(() => void runSyncCycle(config, creds), intervalMs)

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n  Stopping daemon...')
    clearInterval(timer)
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function runSyncCycle(
  config: XmarksConfig,
  creds: { authToken: string | null; ct0: string | null; apiKey: string | null },
): Promise<void> {
  const now = new Date().toLocaleTimeString()
  console.log(`  [${now}] Syncing...`)

  try {
    const result = await syncBookmarks(
      config.vaultPath,
      creds.authToken!,
      creds.ct0!,
    )

    if (result.error) {
      console.log(`  [${now}] Sync error: ${result.error}`)
      if (isAuthError(result.error)) {
        sendNotification(
          'xmarks — Cookies Expired',
          'Twitter session cookies have expired. Run: xmarks setup to refresh.',
        )
        console.log('  Stopping daemon — cookies expired. Run: xmarks setup')
        process.exit(1)
      }
      return
    }

    console.log(`  [${now}] Synced: ${result.imported} new, ${result.skipped} existing, ${result.mediaDownloaded} thumbnails`)

    // Auto-categorize if API key is configured and there are new bookmarks
    if (creds.apiKey && result.imported > 0) {
      console.log(`  [${now}] Categorizing ${result.imported} new bookmarks...`)
      const catResult = await categorizeBookmarks(
        config.vaultPath,
        creds.apiKey,
        config.model,
      )
      console.log(`  [${now}] Categorized: ${catResult.categorized} done, ${catResult.errors} errors`)
    }

    const counts = getBookmarkCount(config.vaultPath)
    console.log(`  [${now}] Total: ${counts.total} bookmarks (${counts.categorized} categorized, ${counts.uncategorized} pending)`)
    console.log(`  [${now}] Next sync in ${config.syncIntervalMinutes} minutes`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`  [${now}] Error: ${msg}`)

    if (isAuthError(msg)) {
      sendNotification(
        'xmarks — Cookies Expired',
        'Twitter session cookies have expired. Run: xmarks setup to refresh.',
      )
      console.log('  Stopping daemon — cookies expired. Run: xmarks setup')
      process.exit(1)
    }
  }
}
