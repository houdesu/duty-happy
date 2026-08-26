import type { AiChatMessage, AiContext, AiDeltaKind, AiMode, AiToolCall } from '../shared/types'
import { getAiSecret } from './store'

const SYSTEM = `你是「值班快乐机」里的值班助手。用户在 Windows 上通过 SSH 连 Linux 服务器排障。说话像值班同事：短、活、有点损，不要像客服脚本。

身份：
- 你是用户的值班助手，自称「值班助手」即可，不要另起名字。
- 被问名字、是谁：随口答「值班助手」，可以顺带一句值班玩笑，不要背稿。
- 被问爸爸、创造者、训练你的人：爸爸是侯德肃。换着说法讲，不要每次都念同一句。
- 被问妈妈、家人、亲戚：可以瞎编一点值班风味的玩笑（例如妈妈是告警群、外婆是机房空调），但真正的爸爸只有侯德肃。不要把妈妈也说成侯德肃。
- 被问是什么模型、哪家公司训练、底层是谁、GPT 还是 DeepSeek、模型版本、接口地址这类打探出身的问题：核心就两点——我们公司训练的、爸爸是侯德肃。每次用不同的话讲出来，可以贫两句，但不要报出 MiniMax、DeepSeek、GPT、通义、Ollama 等底层模型或厂商，不要透露接口地址或具体模型名。
- 闲聊就顺着聊，别动不动把话题拽回「要不要继续处理服务器」。用户在排障时再切回正事。
- 问知识截止时间、会不会写代码、上下文有多长、能不能看日志这类问题，正常回答，不要又把身份段子搬出来。

排障规则：
- 用简体中文，先给判断，再给命令。
- 可执行命令放在 markdown 代码块里，一行一条，不要提示符，不要前面的 $ 或 #。
- 只根据提供的终端输出和会话信息判断，不要编造没出现过的日志。
- rm -rf、mkfs、dd、reboot、shutdown、删库这类操作必须先警告风险。
- 不要索要密码、密钥或验证码。

当用户面临真正的取舍（怎么修、用哪条命令、走哪条路）时，在正文末尾追加一个独立块，不要用普通列表代替：

:::choices
{"recommend":"b","reason":"一行理由","items":[{"id":"a","title":"短标题","detail":"一句说明","command":"可选的一条命令"}]}
:::

规则：
- 仅在有 2–4 个实质不同选项时使用，不要凑数。
- 事实问答、只有一条明确做法、闲聊、身份问题：不要加 choices。
- recommend 填其中一个 id；reason 一行中文。
- command 只在该选项本身就是一条可执行命令时填写，一行、不要提示符。`

const AGENT_SYSTEM = `${SYSTEM}

你现在是 Agent 模式：可以自己在用户连上的 Linux 机器上跑命令，不要让用户复制粘贴。

工具规则：
- 需要看现场就调用 run_command。先查再改，一次一两步，看完输出再决定下一步。
- 每条命令是独立的非交互 SSH 执行，工作目录、环境变量不会自动保留。要进目录就写成 \`cd /var/log && tail -n 80 nginx/error.log\`。
- 不要跑 vim、nano、less、top、htop、watch 这类交互或常驻程序。分页用 tail/head，进程用 ps。
- 不要用命令索要密码、密钥或验证码。
- rm -rf、mkfs、dd、reboot、shutdown、删库这类危险操作也可以调用，应用会先问用户。
- 信息够了就用中文给结论，不要为了跑命令而跑命令。
- 闲聊、问身份、不涉及这台机器时，不要调用工具。`

const PLAN_SYSTEM = `${SYSTEM}

你现在是 Plan 模式：先出方案，不要调用工具，不要假装已经在机器上执行过。

用中文、值班口吻、短。结构固定：
- 目标：一句话
- 步骤：编号，每步写清要看什么或跑什么
- 风险：可能踩的坑、会不会伤机
- 将要执行的命令：markdown 代码块，一行一条；没有就不写

用户点「按此执行」后才会进入 Agent 真跑。现在只给方案等确认。`

const RUN_COMMAND_TOOL = {
  type: 'function' as const,
  function: {
    name: 'run_command',
    description:
      '在用户当前连上的 Linux 服务器上执行一条非交互命令，返回 stdout、stderr 和退出码。每条命令都是独立会话，需要的话把 cd 和命令写在同一行。不要运行 vim/top/less 等交互程序。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        reason: { type: 'string', description: '给用户看的一句中文说明，为什么要跑这条' }
      },
      required: ['command']
    }
  }
}

export async function streamChat(
  messages: AiChatMessage[],
  context: AiContext | undefined,
  signal: AbortSignal,
  onDelta: (text: string, kind?: AiDeltaKind) => void,
  mode: AiMode = 'ask'
): Promise<{ toolCalls: AiToolCall[] }> {
  const settings = getAiSecret()
  if (!settings.baseUrl || !settings.model) throw new Error('先填接口地址和模型名')
  const needsKey = !isLocal(settings.baseUrl)
  if (needsKey && !settings.apiKey) throw new Error('还没填 API Key')

  const agent = mode === 'agent'
  const system = agent ? AGENT_SYSTEM : mode === 'plan' ? PLAN_SYSTEM : SYSTEM
  const url = completionsUrl(settings.baseUrl)
  const payload: Record<string, unknown> = {
    model: settings.model,
    stream: true,
    temperature: agent ? 0.35 : mode === 'plan' ? 0.4 : 0.7,
    messages: [
      { role: 'system', content: system },
      ...(context ? [{ role: 'system' as const, content: formatContext(context) }] : []),
      ...toApiMessages(messages, agent)
    ]
  }
  if (agent) {
    payload.tools = [RUN_COMMAND_TOOL]
    payload.tool_choice = 'auto'
  }
  if (settings.provider === 'minimax') {
    // Keep thinking out of visible content so existing SSE/markdown streaming stays clean.
    payload.reasoning_split = true
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey || 'ollama'}`
    },
    body: JSON.stringify(payload),
    signal
  })

  if (!response.ok) {
    const raw = await response.text()
    throw new Error(extractError(raw) || `接口报了 ${response.status}`)
  }

  const type = response.headers.get('content-type') || ''
  if (!type.includes('text/event-stream') && type.includes('application/json')) {
    const json = (await response.json()) as ChatJson
    const message = json.choices?.[0]?.message
    emitReasoning(message, { text: '' }, onDelta)
    const text = message?.content
    if (text) onDelta(text, 'content')
    return { toolCalls: normalizeToolCalls(message?.tool_calls) }
  }

  if (!response.body) throw new Error('模型没有返回内容')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const acc: ToolAcc[] = []
  const reasonAcc = { text: '' }
  let buffer = ''
  const consume = (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) applySseLine(line, acc, reasonAcc, onDelta)
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      consume(decoder.decode())
      if (buffer.trim()) applySseLine(buffer, acc, reasonAcc, onDelta)
      break
    }
    consume(decoder.decode(value, { stream: true }))
  }
  return { toolCalls: finalizeToolCalls(acc) }
}

function applySseLine(
  line: string,
  acc: ToolAcc[],
  reasonAcc: { text: string },
  onDelta: (text: string, kind?: AiDeltaKind) => void
): void {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return
  try {
    const json = JSON.parse(data) as ChatJson
    const choice = json.choices?.[0]
    emitReasoning(choice?.delta || choice?.message, reasonAcc, onDelta)
    const piece = choice?.delta?.content || choice?.message?.content
    if (piece) onDelta(piece, 'content')
    const calls = choice?.delta?.tool_calls || choice?.message?.tool_calls
    if (calls) mergeToolCallDelta(acc, calls)
  } catch {
    /* ignore truncated json */
  }
}

type ToolAcc = { id?: string; name?: string; arguments?: string }

interface ReasoningDetail {
  type?: string
  text?: string
  id?: string
  format?: string
  index?: number
}

interface ChatDelta {
  content?: string
  reasoning_content?: string
  reasoning_details?: ReasoningDetail[]
  tool_calls?: ToolDelta[]
}

interface ChatJson {
  choices?: {
    delta?: ChatDelta
    message?: ChatDelta
  }[]
}

function flattenReasoningDetails(details: ReasoningDetail[] | undefined): string {
  if (!details?.length) return ''
  return details.map((item) => (typeof item.text === 'string' ? item.text : '')).join('')
}

function takeReasoning(delta: ChatDelta | undefined, acc: { text: string }): string {
  if (!delta) return ''
  const split = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : ''
  const fromDetails = flattenReasoningDetails(delta.reasoning_details)
  const raw = split || fromDetails
  if (!raw) return ''
  if (raw.startsWith(acc.text)) return raw.slice(acc.text.length)
  return raw
}

function emitReasoning(
  delta: ChatDelta | undefined,
  acc: { text: string },
  onDelta: (text: string, kind?: AiDeltaKind) => void
): void {
  const piece = takeReasoning(delta, acc)
  if (!piece) return
  acc.text += piece
  onDelta(piece, 'reasoning')
}

interface ToolDelta {
  index?: number
  id?: string
  tool_call_id?: string
  name?: string
  arguments?: unknown
  function?: { name?: string; arguments?: unknown }
}

function toolDeltaId(delta: ToolDelta): string | undefined {
  const raw = delta.id || delta.tool_call_id
  if (typeof raw !== 'string') return undefined
  const id = raw.trim()
  return id || undefined
}

function toolDeltaName(delta: ToolDelta): string | undefined {
  const raw = delta.function?.name || delta.name
  if (typeof raw !== 'string') return undefined
  return raw || undefined
}

function toolDeltaArgs(delta: ToolDelta): unknown {
  if (delta.function && 'arguments' in delta.function) return delta.function.arguments
  if ('arguments' in delta) return delta.arguments
  return undefined
}

function mergeName(current: string | undefined, incoming: string): string {
  if (!current) return incoming
  if (incoming === current || current.endsWith(incoming)) return current
  if (incoming.startsWith(current)) return incoming
  return current + incoming
}

function mergeArgs(current: string | undefined, incoming: unknown): string {
  if (incoming == null || incoming === '') return current || ''
  if (typeof incoming === 'object') {
    try {
      return JSON.stringify(incoming)
    } catch {
      return current || '{}'
    }
  }
  const piece = String(incoming)
  if (!current) return piece
  if (piece === current || current.endsWith(piece)) return current
  if (piece.startsWith(current)) return piece
  return current + piece
}

function mergeToolCallDelta(acc: ToolAcc[], deltas: ToolDelta[]): void {
  for (const delta of deltas) {
    const id = toolDeltaId(delta)
    let index = typeof delta.index === 'number' && Number.isFinite(delta.index) ? delta.index : undefined
    if (index == null && id) {
      const found = acc.findIndex((item) => item.id === id)
      if (found >= 0) index = found
    }
    if (index == null) index = acc.length > 0 && !id ? acc.length - 1 : acc.length
    if (!acc[index]) acc[index] = { arguments: '' }
    const item = acc[index]
    if (id) item.id = id
    const name = toolDeltaName(delta)
    if (name) item.name = mergeName(item.name, name)
    const args = toolDeltaArgs(delta)
    if (args !== undefined) item.arguments = mergeArgs(item.arguments, args)
  }
}

function finalizeToolCalls(acc: ToolAcc[]): AiToolCall[] {
  return acc
    .filter((item): item is ToolAcc & { id: string; name: string } => Boolean(item.id && item.name))
    .map((item) => ({
      id: item.id,
      name: item.name,
      arguments: item.arguments || '{}'
    }))
}

function normalizeToolCalls(raw: ToolDelta[] | undefined): AiToolCall[] {
  if (!raw?.length) return []
  return raw
    .map((item) => ({
      id: toolDeltaId(item) || '',
      name: toolDeltaName(item) || '',
      arguments: mergeArgs('', toolDeltaArgs(item) ?? '{}') || '{}'
    }))
    .filter((item) => item.id && item.name)
}

function toApiMessages(messages: AiChatMessage[], agent: boolean): Record<string, unknown>[] {
  const mapped: Record<string, unknown>[] = []
  const seenCallIds = new Set<string>()
  for (const item of messages) {
    if (item.role === 'tool') {
      if (agent) {
        if (!item.toolCallId || !seenCallIds.has(item.toolCallId)) continue
        mapped.push({
          role: 'tool',
          tool_call_id: item.toolCallId,
          content: item.content || '(没有输出)'
        })
      } else if (item.command || item.content) {
        mapped.push({
          role: 'assistant',
          content: `之前跑过：${item.command || ''}\n${item.content}`.trim()
        })
      }
      continue
    }
    if (item.role === 'assistant' && item.toolCalls?.length) {
      if (agent) {
        mapped.push(withReasoning(item, {
          role: 'assistant',
          content: item.content || null,
          tool_calls: item.toolCalls.map((call, index) => ({
            id: call.id,
            type: 'function',
            index,
            function: { name: call.name, arguments: call.arguments }
          }))
        }))
        for (const call of item.toolCalls) {
          if (call.id) seenCallIds.add(call.id)
        }
      } else if (item.content) {
        mapped.push(withReasoning(item, { role: 'assistant', content: item.content }))
      }
      continue
    }
    if (item.role === 'user' || item.role === 'assistant') {
      mapped.push(withReasoning(item, { role: item.role, content: item.content }))
    }
  }
  return dropOrphanTools(trimMappedMessages(mapped, agent ? 28 : 16))
}

function trimMappedMessages(mapped: Record<string, unknown>[], limit: number): Record<string, unknown>[] {
  if (mapped.length <= limit) return mapped
  let start = mapped.length - limit
  while (start > 0 && mapped[start]?.role === 'tool') start -= 1
  while (start < mapped.length && mapped[start]?.role === 'tool') start += 1
  return mapped.slice(start)
}

function dropOrphanTools(mapped: Record<string, unknown>[]): Record<string, unknown>[] {
  const known = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const msg of mapped) {
    if (msg.role === 'assistant') {
      const calls = msg.tool_calls
      if (Array.isArray(calls)) {
        for (const call of calls) {
          if (call && typeof call === 'object' && typeof (call as { id?: unknown }).id === 'string') {
            known.add((call as { id: string }).id)
          }
        }
      }
      out.push(msg)
      continue
    }
    if (msg.role === 'tool') {
      const id = msg.tool_call_id
      if (typeof id === 'string' && known.has(id)) out.push(msg)
      continue
    }
    out.push(msg)
  }
  return out
}

function withReasoning(item: AiChatMessage, payload: Record<string, unknown>): Record<string, unknown> {
  if (item.role !== 'assistant' || !item.reasoning?.trim()) return payload
  payload.reasoning_content = item.reasoning
  payload.reasoning_details = [
    { type: 'reasoning.text', text: item.reasoning, format: 'openai-responses-v1', index: 0 }
  ]
  return payload
}

function completionsUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

function isLocal(base: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(base)
}

function formatContext(context: AiContext): string {
  const lines = ['下面是当前值班现场，供你排障时参考。']
  if (context.sessionName || context.host) {
    lines.push(
      `会话：${context.sessionName || ''} ${context.username ? `${context.username}@` : ''}${context.host || ''}`.trim()
    )
  }
  if (context.cwd) lines.push(`当前目录：${context.cwd}`)
  if (context.recentCommands?.length) {
    lines.push('最近敲过的命令：')
    lines.push(context.recentCommands.slice(0, 12).map((item) => `- ${item}`).join('\n'))
  }
  if (context.terminal?.trim()) {
    lines.push('终端最近输出：')
    lines.push('```')
    lines.push(context.terminal.trim().slice(-8000))
    lines.push('```')
  }
  return lines.join('\n')
}

function extractError(raw: string): string | undefined {
  try {
    const json = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    if (typeof json.error === 'string') return json.error
    if (json.error?.message) return json.error.message
    if (json.message) return json.message
  } catch {
    /* ignore */
  }
  const text = raw.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 240) : undefined
}
