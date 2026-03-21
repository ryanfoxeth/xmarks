import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'
import { hostname, userInfo } from 'os'

export interface SourceConfig {
  enabled: boolean
}

export interface YouTubeSourceConfig extends SourceConfig {
  watchPath?: string
  watchPaths?: string[]
}

export interface SourcesConfig {
  twitter?: SourceConfig
  youtube?: YouTubeSourceConfig
}

export interface XmarksConfig {
  vaultPath: string
  syncIntervalMinutes: number
  model: string
  twitterAuth?: {
    authToken: string // encrypted
    ct0: string       // encrypted
  }
  anthropicApiKey?: string // encrypted
  sources?: SourcesConfig
}

const CONFIG_FILENAME = 'xmarks.config.json'

function getConfigPath(vaultPath: string): string {
  return join(vaultPath, CONFIG_FILENAME)
}

// Derive a machine-specific key from hostname + username
// Not military-grade, but prevents plain-text credential storage
function deriveKey(): Buffer {
  const material = `xmarks:${hostname()}:${userInfo().username}`
  return createHash('sha256').update(material).digest()
}

export function encrypt(text: string): string {
  const key = deriveKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

export function decrypt(text: string): string {
  const key = deriveKey()
  const [ivHex, encrypted] = text.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

export function loadConfig(vaultPath: string): XmarksConfig | null {
  const configPath = getConfigPath(vaultPath)
  if (!existsSync(configPath)) return null
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

export function saveConfig(config: XmarksConfig): void {
  const configPath = getConfigPath(config.vaultPath)
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

export function ensureVaultStructure(vaultPath: string): void {
  const dirs = ['bookmarks', 'media']
  for (const dir of dirs) {
    const fullPath = join(vaultPath, dir)
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true })
    }
  }
}

export function getDecryptedCredentials(config: XmarksConfig): {
  authToken: string | null
  ct0: string | null
  apiKey: string | null
} {
  return {
    authToken: config.twitterAuth ? decrypt(config.twitterAuth.authToken) : null,
    ct0: config.twitterAuth ? decrypt(config.twitterAuth.ct0) : null,
    apiKey: config.anthropicApiKey ? decrypt(config.anthropicApiKey) : null,
  }
}
