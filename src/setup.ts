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

  // Vault path
  if (!existsSync(vaultPath)) {
    console.log(`  Vault path not found: ${vaultPath}`)
    rl.close()
    process.exit(1)
  }
  console.log(`  Vault: ${vaultPath}\n`)

  // Twitter cookies
  console.log('  Twitter/X Credentials')
  console.log('  To get these: Open x.com → DevTools (F12) → Application tab')
  console.log('  → Cookies → x.com → copy auth_token and ct0 values\n')

  const authToken = await prompt(rl, '  auth_token: ')
  const ct0 = await prompt(rl, '  ct0: ')

  if (!authToken || !ct0) {
    console.log('\n  Both auth_token and ct0 are required.')
    rl.close()
    process.exit(1)
  }

  // Test Twitter connection
  process.stdout.write('\n  Testing Twitter connection... ')
  try {
    const count = await testConnection(authToken, ct0)
    console.log(`connected! Found bookmarks on first page.`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`failed: ${msg}`)
    rl.close()
    process.exit(1)
  }

  // Anthropic API key
  console.log('\n  Anthropic API Key')
  console.log('  Get yours at: https://console.anthropic.com\n')

  const apiKey = await prompt(rl, '  API key (sk-ant-...): ')

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`failed: ${msg}`)
      console.log('  You can add the API key later in xmarks.config.json')
    }
  } else {
    console.log('  Skipped — sync will work, but categorization requires an API key.')
  }

  // Sync interval
  console.log('')
  const intervalStr = await prompt(rl, '  Sync interval in minutes (default: 5): ')
  const syncIntervalMinutes = parseInt(intervalStr, 10) || 5

  // Model
  const modelStr = await prompt(rl, '  AI model (default: claude-haiku-4-5-20251001): ')
  const model = modelStr || 'claude-haiku-4-5-20251001'

  rl.close()

  // Build config
  const config: XmarksConfig = {
    vaultPath,
    syncIntervalMinutes,
    model,
    twitterAuth: {
      authToken: encrypt(authToken),
      ct0: encrypt(ct0),
    },
    ...(apiKey ? { anthropicApiKey: encrypt(apiKey) } : {}),
  }

  // Save
  ensureVaultStructure(vaultPath)
  saveConfig(config)

  console.log('\n  Setup complete!')
  console.log(`  Config saved to: ${vaultPath}/xmarks.config.json`)
  console.log(`  Sync interval: every ${syncIntervalMinutes} minutes`)
  console.log(`\n  Next steps:`)
  console.log(`    xmarks sync       # Run first sync`)
  console.log(`    xmarks daemon     # Start background sync`)
  console.log('')

  return config
}
