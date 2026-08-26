import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app, safeStorage } from 'electron'
import type { Appearance, AiSettingsInput, AiSettingsPublic, AiThread, SessionInput, SessionPublic, Snippet } from '../shared/types'
import { AI_PRESETS } from '../shared/types'
import { builtinApiKey } from './secret'

interface StoredSession extends SessionInput {
  id: string
  createdAt: number
  lastUsedAt?: number
  password?: string
  passphrase?: string
}

interface StoreFile {
  sessions: StoredSession[]
  snippets: Snippet[]
  history: string[]
  knownHosts: Record<string, string>
  appearance: Appearance
  ai?: {
    provider: AiSettingsPublic['provider']
    baseUrl: string
    model: string
    apiKey?: string
  }
  aiChats?: AiThread[]
}

const MINIMAX_MODEL = 'MiniMax-M3'

const DEFAULT_SNIPPETS: Snippet[] = [
  {
    id: 'sys-overview',
    name: '系统概览',
    group: '巡检',
    command:
      'echo "=== 主机 ===" && hostname && uname -a && echo "=== 负载 ===" && uptime && echo "=== 内存 ===" && free -h && echo "=== 磁盘 ===" && df -hT'
  },
  {
    id: 'listen-ports',
    name: '监听端口',
    group: '网络',
    command: 'ss -lntup 2>/dev/null || netstat -lntup'
  },
  {
    id: 'recent-login',
    name: '最近登录',
    group: '安全',
    command: 'last -n 20'
  },
  {
    id: 'restart-nginx',
    name: '重启 Nginx',
    group: '服务',
    command: 'systemctl restart nginx && systemctl status nginx --no-pager -l'
  },
  {
    id: 'journal-err',
    name: '近期错误日志',
    group: '排障',
    command: 'journalctl -p err -n 50 --no-pager'
  }
]

function storePath(): string {
  return join(app.getPath('userData'), 'duty-happy.json')
}

function seal(value?: string): string | undefined {
  if (!value) return undefined
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString('base64')}`
  }
  return `plain:${value}`
}

function unseal(value?: string): string | undefined {
  if (!value) return undefined
  if (value.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    } catch {
      return undefined
    }
  }
  if (value.startsWith('plain:')) return value.slice(6)
  return value
}

function emptyStore(): StoreFile {
  return { sessions: [], snippets: DEFAULT_SNIPPETS, history: [], knownHosts: {}, appearance: 'light', aiChats: [] }
}

let cache: StoreFile | null = null

export function loadStore(): StoreFile {
  if (cache) return cache
  const file = storePath()
  try {
    if (!existsSync(file)) {
      cache = emptyStore()
      return cache
    }
    cache = { ...emptyStore(), ...JSON.parse(readFileSync(file, 'utf8')) } as StoreFile
    if (cache.appearance !== 'night') cache.appearance = 'light'
    if (migrateStaleAiSettings(cache)) saveStore()
    return cache
  } catch {
    cache = emptyStore()
    return cache
  }
}

function saveStore(): void {
  const file = storePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(loadStore(), null, 2), 'utf8')
}

function toPublic(session: StoredSession): SessionPublic {
  return {
    id: session.id,
    name: session.name,
    host: session.host,
    port: session.port,
    username: session.username,
    auth: session.auth,
    privateKeyPath: session.privateKeyPath,
    group: session.group || '默认',
    hasPassword: Boolean(session.password),
    hasPassphrase: Boolean(session.passphrase),
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt
  }
}

export function listSessions(): SessionPublic[] {
  return loadStore()
    .sessions.map(toPublic)
    .sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt))
}

export function getSessionSecret(id: string): StoredSession | undefined {
  const session = loadStore().sessions.find((item) => item.id === id)
  if (!session) return undefined
  return {
    ...session,
    password: unseal(session.password),
    passphrase: unseal(session.passphrase)
  }
}

export function upsertSession(input: SessionInput): SessionPublic {
  const store = loadStore()
  const now = Date.now()
  const existing = input.id ? store.sessions.find((item) => item.id === input.id) : undefined
  const session: StoredSession = {
    id: existing?.id || randomUUID(),
    name: input.name.trim(),
    host: input.host.trim(),
    port: Number(input.port) || 22,
    username: input.username.trim(),
    auth: input.auth,
    privateKeyPath: input.privateKeyPath,
    group: input.group?.trim() || '默认',
    createdAt: existing?.createdAt || now,
    lastUsedAt: existing?.lastUsedAt,
    password: input.password ? seal(input.password) : existing?.password,
    passphrase: input.passphrase ? seal(input.passphrase) : existing?.passphrase
  }

  if (existing) {
    store.sessions = store.sessions.map((item) => (item.id === existing.id ? session : item))
  } else {
    store.sessions.unshift(session)
  }
  saveStore()
  return toPublic(session)
}

export function deleteSession(id: string): void {
  const store = loadStore()
  store.sessions = store.sessions.filter((item) => item.id !== id)
  saveStore()
}

export function touchSession(id: string): void {
  const store = loadStore()
  store.sessions = store.sessions.map((item) =>
    item.id === id ? { ...item, lastUsedAt: Date.now() } : item
  )
  saveStore()
}

export function listSnippets(): Snippet[] {
  return loadStore().snippets
}

export function upsertSnippet(snippet: Snippet): Snippet {
  const store = loadStore()
  const next = { ...snippet, id: snippet.id || randomUUID() }
  const index = store.snippets.findIndex((item) => item.id === next.id)
  if (index >= 0) store.snippets[index] = next
  else store.snippets.push(next)
  saveStore()
  return next
}

export function deleteSnippet(id: string): void {
  const store = loadStore()
  store.snippets = store.snippets.filter((item) => item.id !== id)
  saveStore()
}

export function listHistory(): string[] {
  return loadStore().history
}

export function addHistory(command: string): string[] {
  const store = loadStore()
  const next = command.trim()
  if (!next) return store.history
  store.history = [next, ...store.history.filter((item) => item !== next)].slice(0, 200)
  saveStore()
  return store.history
}

export function clearHistory(): void {
  loadStore().history = []
  saveStore()
}

export function getKnownHost(id: string): string | undefined {
  return loadStore().knownHosts[id]
}

export function setKnownHost(id: string, fingerprint: string): void {
  loadStore().knownHosts[id] = fingerprint
  saveStore()
}

export function getAppearance(): Appearance {
  return loadStore().appearance === 'night' ? 'night' : 'light'
}

export function setAppearance(appearance: Appearance): Appearance {
  const store = loadStore()
  store.appearance = appearance === 'night' ? 'night' : 'light'
  saveStore()
  return store.appearance
}

function minimaxConfig(): { provider: 'minimax'; baseUrl: string; model: string } {
  const preset = AI_PRESETS.minimax
  return {
    provider: 'minimax',
    // MINIMAX_BASE_URL: CN https://api.minimaxi.com/v1  or intl https://api.minimax.io/v1
    baseUrl: process.env.MINIMAX_BASE_URL?.trim() || preset.baseUrl,
    model: MINIMAX_MODEL
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

function isOtherPresetBaseUrl(baseUrl: string, provider: 'minimax'): boolean {
  const normalized = normalizeBaseUrl(baseUrl)
  if (provider === 'minimax' && /deepseek\.com/i.test(baseUrl)) return true
  for (const [name, preset] of Object.entries(AI_PRESETS)) {
    if (name === provider) continue
    const other = normalizeBaseUrl(preset.baseUrl)
    if (normalized === other || normalized.startsWith(`${other}/`)) return true
  }
  return false
}

function isForeignAiStore(ai: NonNullable<StoreFile['ai']>, provider: 'minimax'): boolean {
  if (ai.provider && ai.provider !== provider) return true
  if (ai.baseUrl && isOtherPresetBaseUrl(ai.baseUrl, provider)) return true
  return false
}

/** DeepSeek / classic OpenAI: `sk-` + alphanumerics only. MiniMax coding keys use extra hyphens (e.g. sk-cp-). */
function isForeignKeyForProvider(key: string, provider: 'minimax'): boolean {
  if (provider !== 'minimax') return false
  return /^sk-[A-Za-z0-9]+$/.test(key)
}

function storedAiKeyForCurrentProvider(): string | undefined {
  const stored = loadStore().ai
  if (!stored?.apiKey) return undefined
  const provider = minimaxConfig().provider
  if (isForeignAiStore(stored, provider)) return undefined
  const key = unseal(stored.apiKey)?.trim()
  if (!key || isForeignKeyForProvider(key, provider)) return undefined
  return key
}

function migrateStaleAiSettings(store: StoreFile): boolean {
  const ai = store.ai
  if (!ai) return false
  const current = minimaxConfig()
  const foreignStore = isForeignAiStore(ai, current.provider)
  const storedKey = unseal(ai.apiKey)?.trim()
  const dropKey = foreignStore || Boolean(storedKey && isForeignKeyForProvider(storedKey, current.provider))
  const nextKey = dropKey ? undefined : ai.apiKey
  const next = {
    provider: current.provider,
    baseUrl: foreignStore || !ai.baseUrl ? current.baseUrl : ai.baseUrl,
    model: current.model,
    ...(nextKey ? { apiKey: nextKey } : {})
  }
  const changed =
    ai.provider !== next.provider ||
    ai.baseUrl !== next.baseUrl ||
    ai.model !== next.model ||
    ai.apiKey !== next.apiKey
  if (!changed) return false
  store.ai = next
  return true
}

function resolveAiKey(): string | undefined {
  const env = process.env.MINIMAX_API_KEY?.trim()
  if (env) return env
  const stored = storedAiKeyForCurrentProvider()
  if (stored) return stored
  return builtinApiKey()
}

export function getAiPublic(): AiSettingsPublic {
  const minimax = minimaxConfig()
  return {
    provider: minimax.provider,
    baseUrl: minimax.baseUrl,
    model: minimax.model,
    hasKey: Boolean(resolveAiKey())
  }
}

export function getAiSecret(): { baseUrl: string; model: string; apiKey?: string; provider: AiSettingsPublic['provider'] } {
  const minimax = minimaxConfig()
  return {
    provider: minimax.provider,
    baseUrl: minimax.baseUrl,
    model: minimax.model,
    apiKey: resolveAiKey()
  }
}

export function saveAiSettings(input: AiSettingsInput): AiSettingsPublic {
  const store = loadStore()
  const existing = storedAiKeyForCurrentProvider() ? store.ai?.apiKey : undefined
  const minimax = minimaxConfig()
  const nextKey = input.apiKey?.trim() ? seal(input.apiKey.trim()) : existing
  store.ai = {
    provider: minimax.provider,
    baseUrl: minimax.baseUrl,
    model: minimax.model,
    ...(nextKey ? { apiKey: nextKey } : {})
  }
  saveStore()
  return getAiPublic()
}

function threadTitle(messages: AiThread['messages']): string {
  const first = messages.find((item) => item.role === 'user' && item.content.trim())
  const text = (first?.content || '未命名对话').replace(/\s+/g, ' ').trim()
  return text.slice(0, 28) || '未命名对话'
}

export function listAiThreads(): AiThread[] {
  return [...(loadStore().aiChats || [])].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function upsertAiThread(input: AiThread): AiThread[] {
  const store = loadStore()
  const messages = input.messages
    .filter((item) => item.content.trim() || (item.toolCalls && item.toolCalls.length > 0) || item.role === 'tool')
    .slice(-80)
  if (messages.length === 0) return listAiThreads()
  const thread: AiThread = {
    id: input.id,
    title: input.title.trim() || threadTitle(messages),
    updatedAt: input.updatedAt || Date.now(),
    messages
  }
  const chats = store.aiChats || []
  store.aiChats = [thread, ...chats.filter((item) => item.id !== thread.id)].slice(0, 40)
  saveStore()
  return listAiThreads()
}

export function deleteAiThread(id: string): AiThread[] {
  const store = loadStore()
  store.aiChats = (store.aiChats || []).filter((item) => item.id !== id)
  saveStore()
  return listAiThreads()
}
