export type Appearance = 'light' | 'night'
export type AuthMethod = 'password' | 'key'


export interface SessionInput {
  id?: string
  name: string
  host: string
  port: number
  username: string
  auth: AuthMethod
  password?: string
  privateKeyPath?: string
  passphrase?: string
  group?: string
}

export interface SessionPublic {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: AuthMethod
  privateKeyPath?: string
  group: string
  hasPassword: boolean
  hasPassphrase: boolean
  createdAt: number
  lastUsedAt?: number
}

export interface Snippet {
  id: string
  name: string
  command: string
  group: string
}

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  mtime: number
}

export type TabStatus = 'connecting' | 'connected' | 'closed' | 'error'

export interface SshConnectPayload {
  tabId: string
  sessionId: string
  cols: number
  rows: number
}

export interface InvokeResult<T = void> {
  ok: boolean
  data?: T
  error?: string
}

export type AiProvider = 'minimax' | 'deepseek' | 'openai' | 'qwen' | 'ollama' | 'custom'

export const AI_PRESETS: Record<AiProvider, { label: string; baseUrl: string; model: string; hint: string }> = {
  // OpenAI-compatible. CN default; international is https://api.minimax.io/v1 (MINIMAX_BASE_URL).
  minimax: {
    label: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M3',
    hint: 'MiniMax-M3，OpenAI 兼容接口'
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    hint: '便宜好用，适合半夜排障'
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '官方接口'
  },
  qwen: {
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: '阿里云兼容模式'
  },
  ollama: {
    label: 'Ollama 本地',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    hint: '本机模型，一般不用填 Key'
  },
  custom: {
    label: '自定义',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    hint: '任意 OpenAI 兼容接口'
  }
}

export interface AiSettingsInput {
  provider: AiProvider
  baseUrl: string
  model: string
  apiKey?: string
}

export interface AiSettingsPublic {
  provider: AiProvider
  baseUrl: string
  model: string
  hasKey: boolean
}

export type AiMode = 'ask' | 'agent' | 'plan'
export type AiDeltaKind = 'content' | 'reasoning'

export interface AiAskPayload {
  id: number
  messages: AiChatMessage[]
  context?: AiContext
  agent?: boolean
  mode?: AiMode
}

export interface AiChoiceItem {
  id: string
  title: string
  detail?: string
  command?: string
}

export interface AiChoices {
  recommend?: string
  reason?: string
  items: AiChoiceItem[]
}

export interface AiToolCall {
  id: string
  name: string
  arguments: string
}

export interface AiExecResult {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
}

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  reasoning?: string
  toolCalls?: AiToolCall[]
  toolCallId?: string
  command?: string
  exitCode?: number | null
  toolStatus?: 'ok' | 'err' | 'denied' | 'timeout' | 'running'
  planPending?: boolean
}

export interface AiContext {
  sessionName?: string
  host?: string
  username?: string
  cwd?: string
  recentCommands?: string[]
  terminal?: string
}

export interface AiThread {
  id: string
  title: string
  updatedAt: number
  messages: AiChatMessage[]
}

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'unavailable'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'unsupported'

export interface AppUpdateStatus {
  phase: AppUpdatePhase
  quiet: boolean
  currentVersion: string
  version?: string
  percent?: number
  message?: string
}
