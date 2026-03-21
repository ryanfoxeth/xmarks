import { createInterface } from 'readline'
import { existsSync } from 'fs'
import { encrypt, saveConfig, ensureVaultStructure, type XmarksConfig } from './config.js'
import { testConnection } from './twitter-api.js'
import Anthropic from '@anthropic-ai/sdk'

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()))
  })
}

export async function runSetup(vaultPath: string): Promise<XmarksConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log('\n  xmarks setup')
  console.log('  ────────────\n')

  if (!existsSync(vaultPath)) {
    console.log(`  Vault path not found: ${vaultPath}`)
    rl.close()
    process.exit(1)
  }
  console.log(`  Vault: ${vaultPath}\n`)

  const config: XmarksConfig = {
    vaultPath,
    syncIntervalMinutes: 5,
    model: 'claude-haiku-4-5-20251001',
    sources: {},
  }

  // --- Twitter/X Source ---
  console.log('  Sources')
  console.log('  ───────\n')
  console.log('  1. Twitter/X Bookmarks')
  console.log('  To get cookies: x.com → DevTools (F12) → Application → Cookies\n')

  const setupTwitter = await prompt(rl, '  Configure Twitter? (Y/n): ')
  if (setupTwitter.toLowerCase() !== 'n') {
    const authToken = await prompt(rl, '  auth_token: ')
    const ct0 = await prompt(rl, '  ct0: ')

    if (authToken && ct0) {
      process.stdout.write('\n  Testing Twitter connection... ')
      try {
        await testConnection(authToken, ct0)
        console.log('connected!')
        config.twitterAuth = {
          authToken: encrypt(authToken),
          ct0: encrypt(ct0),
        }
        config.sources!.twitter = { enabled: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`failed: ${msg}`)
        console.log('  Skipping Twitter — you can re-run setup later.')
      }
    } else {
      console.log('  Skipping Twitter.')
    }
  }

  // --- YouTube Source ---
  console.log('\n  2. YouTube Transcripts')
  console.log('  Point to a directory containing json/ and ai_summary/ subdirectories\n')

  const ytPath = await prompt(rl, '  YouTube directory (or Enter to skip): ')
  if (ytPath) {
    if (existsSync(ytPath)) {
      const jsonDir = `${ytPath}/json`
      if (existsSync(jsonDir)) {
        const { readdirSync } = await import('fs')
        const count = readdirSync(jsonDir).filter(f => f.endsWith('.json')).length
        console.log(`  Found ${count} JSON files in ${jsonDir}`)
        config.sources!.youtube = { enabled: true, watchPath: ytPath }
      } else {
        console.log(`  Warning: ${jsonDir} not found — YouTube source won't sync until json/ exists`)
        config.sources!.youtube = { enabled: true, watchPath: ytPath }
      }
    } else {
      console.log(`  Path not found: ${ytPath}`)
      console.log('  Skipping YouTube.')
    }
  }

  // --- Anthropic API Key ---
  console.log('\n  AI Categorization')
  console.log('  Get your key at: https://console.anthropic.com\n')

  const apiKey = await prompt(rl, '  Anthropic API key (sk-ant-...): ')

  if (apiKey) {
    process.stdout.write('  Testing Anthropic connection... ')
    try {
      const client = new Anthropic({ apiKey })
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      })
      console.log('connected!')
      config.anthropicApiKey = encrypt(apiKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`failed: ${msg}`)
      console.log('  You can add the API key later in xmarks.config.json')
    }
  } else {
    console.log('  Skipped — sync works without it, but categorization requires an API key.')
  }

  // --- Options ---
  console.log('')
  const intervalStr = await prompt(rl, '  Sync interval in minutes (default: 5): ')
  config.syncIntervalMinutes = parseInt(intervalStr, 10) || 5

  const modelStr = await prompt(rl, '  AI model (default: claude-haiku-4-5-20251001): ')
  config.model = modelStr || 'claude-haiku-4-5-20251001'

  rl.close()

  // Save
  ensureVaultStructure(config.vaultPath)
  saveConfig(config)

  const configuredSources = []
  if (config.twitterAuth) configuredSources.push('twitter')
  if (config.sources?.youtube?.enabled) configuredSources.push('youtube')

  console.log('\n  Setup complete!')
  console.log(`  Config saved to: ${config.vaultPath}/xmarks.config.json`)
  console.log(`  Sources: ${configuredSources.join(', ') || 'none'}`)
  console.log(`  Sync interval: every ${config.syncIntervalMinutes} minutes`)
  console.log(`\n  Next steps:`)
  console.log(`    xmarks sync       # Sync all configured sources`)
  console.log(`    xmarks daemon     # Start background sync`)
  console.log('')

  return config
}
