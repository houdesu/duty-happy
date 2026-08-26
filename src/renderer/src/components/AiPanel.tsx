import { useEffect, useMemo, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import type {
  AiChatMessage,
  AiChoiceItem,
  AiChoices,
  AiContext,
  AiMode,
  AiThread,
  AiToolCall
} from '../../../shared/types'
import { snapshotTerm } from '../lib/term-log'
import { selectActiveTab, useApp, type ConfirmOptions } from '../store'

const mdPlugins = [remarkGfm, remarkBreaks]
const mdComponents: Components = {
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  },
  img({ alt }) {
    return alt ? <span>{alt}</span> : null
  },
  input({ checked, type }) {
    if (type === 'checkbox') {
      return <input type="checkbox" defaultChecked={Boolean(checked)} disabled />
    }
    return null
  },
  table({ children }) {
    return (
      <div className="ai-md-table">
        <table>{children}</table>
      </div>
    )
  }
}

const QUICK_ASK = ['看看终端里怎么了', '磁盘或内存怎么查', '服务起不来怎么排', '帮我写一条安全巡检']
const QUICK_AGENT = ['自己看一下这台机器健不健康', '磁盘和内存帮我查清楚', '有没有服务挂了，挂了就查原因', '帮我做一轮安全巡检']
const QUICK_PLAN = ['先出个排障方案，别急着跑', '磁盘满了怎么查，先列步骤', '服务挂了怎么处理，给方案', '做一轮安全巡检方案']
/** Local loop guard only — not a model/API limit. Stops runaway tool loops. */
const MAX_AGENT_STEPS = 80
const AGENT_STEP_CAP_MSG = '已达本轮步数上限，可继续让它接着干'
/** Flip to true to show Plan in the mode bar again. */
const SHOW_PLAN_MODE = false
/** Flip to true to show the thinking block in chat again. */
const SHOW_THINKING_IN_CHAT = false

export default function AiPanel() {
  const tab = useApp(selectActiveTab)
  const sessions = useApp((s) => s.sessions)
  const history = useApp((s) => s.history)
  const toast = useApp((s) => s.toast)
  const askConfirm = useApp((s) => s.askConfirm)
  const aiDraft = useApp((s) => s.aiDraft)
  const clearAiDraft = useApp((s) => s.clearAiDraft)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID())
  const [threads, setThreads] = useState<AiThread[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [withTerm, setWithTerm] = useState(true)
  const [mode, setMode] = useState<AiMode>(readMode)
  const [showThink, setShowThink] = useState(readThink)
  const [autopilot, setAutopilot] = useState(readAutopilot)
  const [agentStep, setAgentStep] = useState(0)
  const stream = useRef('')
  const reasonStream = useRef('')
  const chatId = useRef(0)
  const runId = useRef(0)
  const agentSteps = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef(messages)
  const threadIdRef = useRef(threadId)
  const persistRef = useRef<(id?: string, items?: AiChatMessage[]) => Promise<void>>(async () => {})
  const tabRef = useRef(tab)
  const sessionRef = useRef(sessions.find((item) => item.id === tab?.sessionId))
  const historyRef = useRef(history)
  const withTermRef = useRef(withTerm)
  const modeRef = useRef(mode)
  const autopilotRef = useRef(autopilot)
  const sessionAutoApproveRef = useRef(false)
  const toastRef = useRef(toast)
  const askConfirmRef = useRef(askConfirm)
  const onDoneRef = useRef<(payload: { id: number; aborted?: boolean; toolCalls?: AiToolCall[] }) => void>(
    () => {}
  )
  messagesRef.current = messages
  threadIdRef.current = threadId
  tabRef.current = tab
  sessionRef.current = sessions.find((item) => item.id === tab?.sessionId)
  historyRef.current = history
  withTermRef.current = withTerm
  modeRef.current = mode
  autopilotRef.current = autopilot
  toastRef.current = toast
  askConfirmRef.current = askConfirm

  const live = tab?.status === 'connected'

  useEffect(() => {
    void window.duty.ai.threads.list().then((list) => {
      setThreads(list)
      const latest = list[0]
      if (latest?.messages.length) {
        setThreadId(latest.id)
        setMessages(latest.messages)
      }
    })
  }, [])

  useEffect(() => {
    if (SHOW_PLAN_MODE || mode !== 'plan') return
    setMode('ask')
    writeMode('ask')
  }, [mode])

  useEffect(() => {
    const offDelta = window.duty.ai.onDelta(({ id, text, kind }) => {
      if (id !== chatId.current) return
      if (kind === 'reasoning') reasonStream.current += text
      else stream.current += text
      const content = stream.current
      const reasoning = reasonStream.current
      setMessages((current) => {
        const copy = [...current]
        const last = copy.at(-1)
        if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content, reasoning }
        return copy
      })
    })
    const offDone = window.duty.ai.onDone((payload) => onDoneRef.current(payload))
    const offError = window.duty.ai.onError(({ id, error }) => {
      if (id !== chatId.current) return
      setBusy(false)
      setAgentStep(0)
      setMessages((current) => {
        const copy = [...current]
        const last = copy.at(-1)
        if (last?.role === 'assistant' && !last.content && !last.reasoning && !last.toolCalls?.length) copy.pop()
        return copy
      })
      toastRef.current(error || '模型没回过神来', 'err')
      void persistRef.current()
    })
    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [])

  onDoneRef.current = ({ id, aborted, toolCalls }) => {
    if (id !== chatId.current) return
    if (aborted) {
      setBusy(false)
      setAgentStep(0)
      void persistRef.current()
      return
    }
    if (modeRef.current === 'agent' && toolCalls?.length) {
      void continueAgent(toolCalls)
      return
    }
    let persistItems = messagesRef.current
    if (modeRef.current === 'plan') {
      const copy = [...persistItems]
      const last = copy.at(-1)
      if (last?.role === 'assistant' && (last.content.trim() || last.reasoning?.trim())) {
        copy[copy.length - 1] = { ...last, planPending: true }
      }
      persistItems = copy
      messagesRef.current = copy
      setMessages(copy)
    }
    setBusy(false)
    setAgentStep(0)
    window.setTimeout(() => {
      void persistRef.current(threadIdRef.current, persistItems)
    }, 0)
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, busy, agentStep])

  useEffect(() => {
    if (!aiDraft) return
    setShowHistory(false)
    setInput(aiDraft)
    clearAiDraft()
    window.setTimeout(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 50)
  }, [aiDraft, clearAiDraft])

  async function persist(id = threadIdRef.current, items = messagesRef.current) {
    const usable = items.filter(
      (item) =>
        item.content.trim() ||
        Boolean(item.reasoning?.trim()) ||
        (item.toolCalls && item.toolCalls.length > 0) ||
        item.role === 'tool' ||
        Boolean(item.planPending)
    )
    if (usable.length === 0) return
    const first = usable.find((item) => item.role === 'user')?.content.replace(/\s+/g, ' ').trim() || '未命名对话'
    const list = await window.duty.ai.threads.upsert({
      id,
      title: first.slice(0, 28),
      updatedAt: Date.now(),
      messages: usable
    })
    setThreads(list)
  }
  persistRef.current = persist

  async function newChat() {
    runId.current += 1
    window.duty.ai.abort()
    await persist()
    setBusy(false)
    setAgentStep(0)
    setShowHistory(false)
    setThreadId(crypto.randomUUID())
    setMessages([])
    resetSessionAutoApprove()
  }

  async function openThread(thread: AiThread) {
    runId.current += 1
    window.duty.ai.abort()
    await persist()
    setBusy(false)
    setAgentStep(0)
    setShowHistory(false)
    setThreadId(thread.id)
    setMessages(thread.messages)
    resetSessionAutoApprove()
  }

  async function removeThread(id: string) {
    const ok = await askConfirm({
      title: '删除对话',
      message: '这段值班记录删了就没了。',
      ok: '删除',
      danger: true
    })
    if (!ok) return
    const list = await window.duty.ai.threads.delete(id)
    setThreads(list)
    if (id === threadId) {
      setThreadId(crypto.randomUUID())
      setMessages([])
      resetSessionAutoApprove()
    }
  }

  function buildContext(): AiContext | undefined {
    if (!withTermRef.current) return undefined
    const current = tabRef.current
    const currentSession = sessionRef.current
    return {
      sessionName: currentSession?.name || current?.title,
      host: currentSession?.host,
      username: currentSession?.username,
      cwd: current?.cwd,
      recentCommands: historyRef.current.slice(0, 10),
      terminal: current ? snapshotTerm(current.id) : ''
    }
  }

  function sendAsk(historyMsgs: AiChatMessage[], nextMode: AiMode) {
    stream.current = ''
    reasonStream.current = ''
    chatId.current += 1
    setMessages([...historyMsgs, { role: 'assistant', content: '', reasoning: '' }])
    setBusy(true)
    window.duty.ai.ask({
      id: chatId.current,
      messages: historyMsgs,
      context: buildContext(),
      mode: nextMode,
      agent: nextMode === 'agent'
    })
  }

  function ask(text: string) {
    const question = text.trim()
    if (!question || busy) return
    if (mode === 'agent' && tab?.status !== 'connected') {
      toast('Agent 要先连上终端，才会自己跑命令', 'err')
      return
    }
    const historyMsgs = [...messages, { role: 'user' as const, content: question }]
    runId.current += 1
    agentSteps.current = 1
    setAgentStep(mode === 'agent' ? 1 : 0)
    setInput('')
    sendAsk(historyMsgs, mode)
  }

  function executePlan(index: number) {
    if (tab?.status !== 'connected') {
      toast('按此执行要先连上终端', 'err')
      return
    }
    if (busy) return
    const next = messages.map((item, i) => (i === index ? { ...item, planPending: false } : item))
    setMode('agent')
    writeMode('agent')
    const historyMsgs = [
      ...next,
      { role: 'user' as const, content: '按此执行这份方案。先查再改，危险操作仍要等确认。' }
    ]
    runId.current += 1
    agentSteps.current = 1
    setAgentStep(1)
    sendAsk(historyMsgs, 'agent')
  }

  function keepPlan(index: number) {
    const next = messages.map((item, i) => (i === index ? { ...item, planPending: false } : item))
    setMessages(next)
    toast('先留着方案，不跑命令')
    void persist(threadId, next)
  }

  async function continueAgent(toolCalls: AiToolCall[]) {
    const myRun = runId.current
    const patched = patchAssistantTools(messagesRef.current, toolCalls)
    let working = patched
    setMessages(working)

    for (const call of toolCalls) {
      if (runId.current !== myRun) return
      const parsed = parseRunCommand(call)
      const pending: AiChatMessage = {
        role: 'tool',
        toolCallId: call.id,
        content: parsed.reason || '正在跑…',
        command: parsed.command,
        toolStatus: 'running'
      }
      working = [...working, pending]
      setMessages(working)

      const result = parsed.command
        ? await runAgentCommand(parsed.command, myRun)
        : { content: parsed.reason || '命令是空的，没跑。', exitCode: null as number | null, status: 'err' as const }
      if (runId.current !== myRun) return
      const done: AiChatMessage = {
        ...pending,
        content: result.content,
        exitCode: result.exitCode,
        toolStatus: result.status
      }
      working = working.map((item, index) => (index === working.length - 1 ? done : item))
      setMessages(working)
    }

    if (runId.current !== myRun) return
    void persistRef.current(threadIdRef.current, working)

    if (agentSteps.current >= MAX_AGENT_STEPS) {
      const capped = [
        ...working,
        { role: 'assistant' as const, content: AGENT_STEP_CAP_MSG }
      ]
      messagesRef.current = capped
      setMessages(capped)
      setBusy(false)
      setAgentStep(0)
      toastRef.current(AGENT_STEP_CAP_MSG)
      void persistRef.current(threadIdRef.current, capped)
      return
    }

    agentSteps.current += 1
    setAgentStep(agentSteps.current)
    sendAsk(working, 'agent')
  }

  async function runAgentCommand(command: string, myRun: number) {
    if (!command) {
      return { content: '命令是空的，没跑。', exitCode: null as number | null, status: 'err' as const }
    }
    if (command.length > 4000) {
      return { content: '命令太长，没跑。', exitCode: null, status: 'err' as const }
    }
    if (isInteractive(command)) {
      return {
        content: '这条是交互程序，Agent 跑不了。换成 ps、tail、head 这类非交互命令。',
        exitCode: null,
        status: 'err' as const
      }
    }
    const current = tabRef.current
    if (!current || current.status !== 'connected') {
      return { content: '终端掉了，这条没跑成。', exitCode: null, status: 'err' as const }
    }
    const dangerous = isDangerous(command)
    const autoApprove = autopilotRef.current || sessionAutoApproveRef.current
    if (!autoApprove) {
      const ok = await askConfirmRef.current(agentCommandConfirm(command, dangerous, enableSessionAutoApprove))
      if (runId.current !== myRun) {
        return { content: '已中止。', exitCode: null, status: 'denied' as const }
      }
      if (!ok) {
        return { content: '用户拒绝执行这条命令。', exitCode: null, status: 'denied' as const }
      }
    } else if (dangerous) {
      const ok = await askConfirmRef.current(agentCommandConfirm(command, true))
      if (runId.current !== myRun) {
        return { content: '已中止。', exitCode: null, status: 'denied' as const }
      }
      if (!ok) {
        return { content: '用户拒绝执行这条命令。', exitCode: null, status: 'denied' as const }
      }
    }
    const result = await window.duty.ssh.exec(current.id, command)
    if (!result.ok || !result.data) {
      return { content: result.error || '执行失败', exitCode: null, status: 'err' as const }
    }
    void window.duty.history.add(command).then((list) => useApp.setState({ history: list }))
    return {
      content: formatExecOutput(result.data),
      exitCode: result.data.code,
      status: result.data.timedOut ? ('timeout' as const) : result.data.code === 0 || result.data.code === null ? ('ok' as const) : ('err' as const)
    }
  }

  function stop() {
    runId.current += 1
    window.duty.ai.abort()
    setBusy(false)
    setAgentStep(0)
    setMessages((current) => {
      const next = current
        .filter((item, index, list) => {
          const last = index === list.length - 1
          if (last && item.role === 'assistant' && !item.content && !item.reasoning && !item.toolCalls?.length)
            return false
          return true
        })
        .map((item) =>
          item.role === 'tool' && item.toolStatus === 'running'
            ? { ...item, toolStatus: 'denied' as const, content: '已中止。' }
            : item
        )
      window.setTimeout(() => void persistRef.current(threadIdRef.current, next), 0)
      return next
    })
  }

  function switchMode(next: AiMode) {
    if (busy || next === mode) return
    if (!SHOW_PLAN_MODE && next === 'plan') return
    setMode(next)
    writeMode(next)
  }

  function setThinkPref(next: boolean) {
    setShowThink(next)
    writeThink(next)
  }

  function setAutopilotPref(next: boolean) {
    sessionAutoApproveRef.current = false
    setAutopilot(next)
    writeAutopilot(next)
  }

  function enableSessionAutoApprove() {
    sessionAutoApproveRef.current = true
    setAutopilot(true)
    toastRef.current('本次会话将自动执行，危险命令仍会确认', 'ok')
  }

  function resetSessionAutoApprove() {
    sessionAutoApproveRef.current = false
    setAutopilot(readAutopilot())
  }

  async function runCommand(command: string, execute: boolean) {
    if (!tab || tab.status !== 'connected') {
      toast('先连上一个终端', 'err')
      return
    }
    const lines = command
      .split(/\r?\n/)
      .map((line) => line.replace(/^[#$>]\s*/, '').trim())
      .filter(Boolean)
    if (execute && isDangerous(command)) {
      const ok = await askConfirm({
        title: '危险命令',
        message: '这条看起来不太善，确认让它执行？',
        code: command,
        ok: '还是执行',
        danger: true
      })
      if (!ok) return
    }
    if (lines.length === 0) return
    if (!execute) {
      window.duty.ssh.write(tab.id, lines.join('; '))
      toast('已经插入，自己按回车')
      return
    }
    for (const line of lines) window.duty.ssh.write(tab.id, `${line}\r`)
    toast(lines.length > 1 ? `已经丢进终端，共 ${lines.length} 条` : '已经丢进终端')
  }

  const emptyHint = useMemo(() => {
    if (mode === 'agent') {
      if (!tab) return 'Agent 要先连上机器，才会自己跑命令。'
      if (tab.status !== 'connected') return '机器还没连上，连上后再让 Agent 动手。'
      if (!autopilot) return withTerm ? '会看终端。每条命令先问你，点了才跑。' : '不带终端记录。每条命令先问你，点了才跑。'
      return withTerm ? '会看终端，也会自己在这台机器上跑命令。危险操作会先问你。' : '不带终端记录，但会自己跑命令。'
    }
    if (mode === 'plan') {
      if (!tab) return '还没连机器也可以先出方案。要点「按此执行」再连上。'
      if (tab.status !== 'connected') return '机器还没连上。可以先出方案，执行时再连。'
      return withTerm ? '先出方案，你点「按此执行」才会自己跑。' : '不带终端记录，先出方案等你确认。'
    }
    if (!tab) return '还没连机器。你也可以先问通用问题。'
    if (tab.status !== 'connected') return '机器还没连上，问通用问题也行。'
    return withTerm ? '会带上当前终端输出一起问。' : '这次不带终端，只听你说。'
  }, [tab, withTerm, mode, autopilot])

  const quick = mode === 'agent' ? QUICK_AGENT : mode === 'plan' ? QUICK_PLAN : QUICK_ASK
  const kicker = mode === 'agent' ? '值班助手 · Agent' : mode === 'plan' ? '值班助手 · Plan' : '值班助手'
  const placeholder =
    mode === 'agent' ? '说要查什么，它自己去跑' : mode === 'plan' ? '说目标，先出方案再决定跑不跑' : '报错贴过来，或直接问怎么查'
  const sendLabel = mode === 'agent' ? '干' : mode === 'plan' ? '规划' : '问'

  return (
    <div className="ai-pane">
      <div className="ai-toolbar">
        <button className="ghost" onClick={() => setShowHistory((value) => !value)}>
          {showHistory ? '返回' : '历史'}
        </button>
        <button className="ghost" onClick={() => void newChat()}>
          新对话
        </button>
      </div>
      {showHistory ? (
        <div className="ai-threads">
          {threads.length === 0 ? <div className="empty">还没有聊过。问完会自动记下来。</div> : null}
          {threads.map((thread) => (
            <div key={thread.id} className="ai-thread-row">
              <button
                className={`ai-thread ${thread.id === threadId ? 'active' : ''}`}
                onClick={() => void openThread(thread)}
              >
                <span className="dock-name">{thread.title}</span>
                <span className="dock-meta">{formatThreadTime(thread.updatedAt)}</span>
              </button>
              <button className="icon-btn" title="删除" onClick={() => void removeThread(thread.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
      <div ref={listRef} className="ai-list">
        {messages.length === 0 ? (
          <div className="ai-empty">
            <div className="kicker">{kicker}</div>
            <p>{emptyHint}</p>
            <div className="ai-quick">
              {quick.map((item) => (
                <button key={item} onClick={() => ask(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((item, index) => {
            if (item.role === 'tool') {
              return <ToolCard key={`tool-${item.toolCallId || index}`} item={item} />
            }
            const streaming = Boolean(busy && index === messages.length - 1 && item.role === 'assistant')
            if (item.role === 'assistant' && !item.content && !item.reasoning && !item.planPending && !streaming) return null
            const parsed = item.role === 'assistant' ? extractChoices(item.content, streaming) : { text: item.content }
            const bodyText =
              item.role === 'user' ? item.content : parsed.text || (streaming ? agentBusyText(agentStep) : '')
            const showThinking =
              SHOW_THINKING_IN_CHAT &&
              item.role === 'assistant' &&
              showThink &&
              (Boolean(item.reasoning?.trim()) || streaming)
            const showBubble =
              item.role === 'user' ||
              Boolean(bodyText) ||
              Boolean(parsed.choices && !streaming) ||
              Boolean(SHOW_PLAN_MODE && item.planPending && !streaming)
            return (
              <article key={`${item.role}-${index}`} className={`ai-msg ${item.role}`}>
                <div className="ai-role">{item.role === 'user' ? '你' : '值班助手'}</div>
                {showThinking ? <ThinkingBlock text={item.reasoning || ''} streaming={streaming} /> : null}
                {showBubble ? (
                  <div className="ai-bubble">
                    <AiBody
                      text={bodyText}
                      markdown={item.role === 'assistant'}
                      runnable={item.role === 'assistant' && !busy}
                      onInsert={(command) => void runCommand(command, false)}
                      onRun={(command) => void runCommand(command, true)}
                    />
                    {item.role === 'assistant' && parsed.choices && !streaming ? (
                      <ChoiceCards
                        choices={parsed.choices}
                        disabled={busy}
                        onPick={(choice) => ask(choiceFollowUp(choice))}
                        onInsert={(command) => void runCommand(command, false)}
                        onRun={(command) => void runCommand(command, true)}
                      />
                    ) : null}
                    {SHOW_PLAN_MODE && item.planPending && !streaming ? (
                      <div className="ai-plan-actions">
                        <button type="button" className="ghost" onClick={() => keepPlan(index)}>
                          只要方案
                        </button>
                        <button type="button" className="happy-btn" onClick={() => executePlan(index)}>
                          按此执行
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })
        )}
      </div>
      <div className="ai-composer">
        <div className="ai-composer-meta">
          <div className={`segment ai-mode ${SHOW_PLAN_MODE ? 'is-three' : ''} ${busy ? 'is-locked' : ''}`}>
            <button type="button" className={mode === 'ask' ? 'active' : ''} onClick={() => switchMode('ask')}>
              问答
            </button>
            {SHOW_PLAN_MODE ? (
              <button type="button" className={mode === 'plan' ? 'active' : ''} onClick={() => switchMode('plan')}>
                Plan
              </button>
            ) : null}
            <button
              type="button"
              className={mode === 'agent' ? 'active' : ''}
              onClick={() => switchMode('agent')}
              title={live ? '自己在这台机器上跑命令' : '先连上终端再开 Agent'}
            >
              Agent
            </button>
          </div>
          <ComposerOptions
            mode={mode}
            showThink={showThink}
            withTerm={withTerm}
            autopilot={autopilot}
            onThink={setThinkPref}
            onTerm={setWithTerm}
            onAutopilot={setAutopilotPref}
          />
        </div>
        <textarea
          ref={inputRef}
          rows={3}
          value={input}
          placeholder={placeholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              ask(input)
            }
          }}
        />
        <div className="ai-composer-actions">
          {messages.length > 0 ? (
            <button className="ghost" onClick={() => void newChat()}>
              新对话
            </button>
          ) : null}
          {busy ? (
            <button className="ghost" onClick={stop}>
              停
            </button>
          ) : (
            <button className="happy-btn" onClick={() => ask(input)}>
              {sendLabel}
            </button>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  )
}

function ComposerOptions({
  mode,
  showThink,
  withTerm,
  autopilot,
  onThink,
  onTerm,
  onAutopilot
}: {
  mode: AiMode
  showThink: boolean
  withTerm: boolean
  autopilot: boolean
  onThink: (next: boolean) => void
  onTerm: (next: boolean) => void
  onAutopilot: (next: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuBox, setMenuBox] = useState({ right: 8, bottom: 8 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const label = optionsSummary(mode, showThink, withTerm, autopilot)
  const hint = optionsTitle(mode, showThink, withTerm, autopilot)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const close = () => setOpen(false)
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    const rect = wrapRef.current?.getBoundingClientRect()
    if (rect) {
      setMenuBox({
        right: Math.max(8, window.innerWidth - rect.right),
        bottom: Math.max(8, window.innerHeight - rect.top + 4)
      })
    }
    setOpen(true)
  }

  return (
    <div className={`ai-opts ${open ? 'is-open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="ai-opts-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`选项：${hint}`}
        title={hint}
        onClick={toggle}
      >
        <span className="ai-opts-label">{label}</span>
        <span className="ai-opts-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="ai-opts-menu" role="menu" style={{ right: menuBox.right, bottom: menuBox.bottom }}>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={showThink}
            className={`ai-opts-item ${showThink ? 'is-on' : ''}`}
            onClick={() => onThink(!showThink)}
          >
            <span className="ai-opts-check" aria-hidden>
              {showThink ? '✓' : ''}
            </span>
              思考模式
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={withTerm}
            className={`ai-opts-item ${withTerm ? 'is-on' : ''}`}
            onClick={() => onTerm(!withTerm)}
          >
            <span className="ai-opts-check" aria-hidden>
              {withTerm ? '✓' : ''}
            </span>
            带上终端
          </button>
          {mode === 'agent' ? (
            <>
              <div className="ai-opts-sep" />
              <div className="ai-opts-group">驾驶方式</div>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={autopilot}
                className={`ai-opts-item ${autopilot ? 'is-on' : ''}`}
                title="普通命令直接跑，危险操作仍会问你"
                onClick={() => onAutopilot(true)}
              >
                <span className="ai-opts-check" aria-hidden>
                  {autopilot ? '✓' : ''}
                </span>
                自动驾驶
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!autopilot}
                className={`ai-opts-item ${!autopilot ? 'is-on' : ''}`}
                title="每条命令先问你，点了才跑"
                onClick={() => onAutopilot(false)}
              >
                <span className="ai-opts-check" aria-hidden>
                  {!autopilot ? '✓' : ''}
                </span>
                需确认
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function optionsSummary(mode: AiMode, showThink: boolean, withTerm: boolean, autopilot: boolean): string {
  const parts: string[] = []
  if (mode === 'agent') parts.push(autopilot ? '自动驾驶' : '需确认')
  if (!showThink) parts.push('思考关')
  if (!withTerm) parts.push('不带终端')
  return parts.length ? parts.join(' · ') : '选项'
}

function optionsTitle(mode: AiMode, showThink: boolean, withTerm: boolean, autopilot: boolean): string {
  const bits = [showThink ? '思考模式' : '思考关', withTerm ? '带上终端' : '不带终端']
  if (mode === 'agent') bits.unshift(autopilot ? '自动驾驶' : '需确认')
  return bits.join(' · ')
}

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  if (!text.trim() && !streaming) return null
  return (
    <div className={`ai-think ${streaming ? 'is-live' : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className="ai-think-head" onClick={() => setOpen((value) => !value)}>
        <span className="ai-think-label">
          {streaming ? <span className="ai-think-dot" aria-hidden /> : null}
          {streaming ? '思考中' : '思考'}
        </span>
        <span className="ai-think-toggle">{open ? '收起' : '展开'}</span>
      </button>
      {open ? <div className="ai-think-body">{text || '…'}</div> : null}
    </div>
  )
}

function ChoiceCards({
  choices,
  disabled,
  onPick,
  onInsert,
  onRun
}: {
  choices: AiChoices
  disabled: boolean
  onPick: (item: AiChoiceItem) => void
  onInsert: (command: string) => void
  onRun: (command: string) => void
}) {
  return (
    <div className="ai-choices">
      {choices.reason ? <p className="ai-choices-why">{choices.reason}</p> : null}
      {choices.items.map((item) => {
        const rec = Boolean(choices.recommend && item.id === choices.recommend)
        return (
          <div key={item.id} className={`ai-choice ${rec ? 'is-rec' : ''}`}>
            <button type="button" className="ai-choice-main" disabled={disabled} onClick={() => onPick(item)}>
              <span className="ai-choice-title">
                {item.title}
                {rec ? <span className="ai-choice-badge">推荐</span> : null}
              </span>
              {item.detail ? <span className="ai-choice-detail">{item.detail}</span> : null}
            </button>
            {item.command ? (
              <div className="ai-choice-cmd">
                <code>{item.command}</code>
                <div className="ai-code-actions">
                  <button type="button" className="ghost" disabled={disabled} onClick={() => onInsert(item.command || '')}>
                    插入
                  </button>
                  <button type="button" className="happy-btn" disabled={disabled} onClick={() => onRun(item.command || '')}>
                    执行
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ToolCard({ item }: { item: AiChatMessage }) {
  const [open, setOpen] = useState(item.toolStatus === 'running' || item.toolStatus === 'err' || item.toolStatus === 'timeout')
  const running = item.toolStatus === 'running'
  useEffect(() => {
    if (item.toolStatus === 'running') setOpen(true)
  }, [item.toolStatus])
  return (
    <article className={`ai-tool ${item.toolStatus || ''}`}>
      <button type="button" className="ai-tool-head" onClick={() => setOpen((value) => !value)}>
        <span className="ai-tool-flag">{toolFlag(item.toolStatus)}</span>
        <code className="ai-tool-cmd">{item.command || '命令'}</code>
        <span className="ai-tool-exit">
          {running ? '…' : item.exitCode === null || item.exitCode === undefined ? '' : `exit ${item.exitCode}`}
        </span>
      </button>
      {open ? <pre className="ai-tool-out">{running ? '正在跑…' : item.content || '没有输出'}</pre> : null}
    </article>
  )
}

function AiBody({
  text,
  markdown = false,
  runnable = false,
  onInsert,
  onRun
}: {
  text: string
  markdown?: boolean
  runnable?: boolean
  onInsert: (command: string) => void
  onRun: (command: string) => void
}) {
  if (!text) return null
  const chunks = splitBlocks(text)
  const commands = chunks.filter((chunk) => chunk.type === 'code').map((chunk) => chunk.text)
  return (
    <div className={markdown ? 'ai-body is-md' : 'ai-body'}>
      {chunks.map((chunk, index) =>
        chunk.type === 'code' ? (
          <div key={index} className="ai-code">
            <pre>{chunk.text}</pre>
            {runnable ? (
              <div className="ai-code-actions">
                <button type="button" className="ghost" onClick={() => onInsert(chunk.text)}>
                  插入
                </button>
                <button type="button" className="happy-btn" onClick={() => onRun(chunk.text)}>
                  执行
                </button>
              </div>
            ) : null}
          </div>
        ) : markdown ? (
          <div key={index} className="ai-md">
            <Markdown remarkPlugins={mdPlugins} components={mdComponents}>
              {chunk.text}
            </Markdown>
          </div>
        ) : (
          <p key={index}>{chunk.text}</p>
        )
      )}
      {runnable && commands.length > 1 ? (
        <div className="ai-runbar">
          <button type="button" className="ghost" onClick={() => onInsert(commands.join('\n'))}>
            全部插入
          </button>
          <button type="button" className="happy-btn" onClick={() => onRun(commands.join('\n'))}>
            全部执行
          </button>
        </div>
      ) : null}
    </div>
  )
}

function patchAssistantTools(messages: AiChatMessage[], toolCalls: AiToolCall[]): AiChatMessage[] {
  const copy = [...messages]
  const last = copy.at(-1)
  if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, toolCalls }
  else copy.push({ role: 'assistant', content: '', toolCalls })
  return copy
}

function parseRunCommand(call: AiToolCall): { command: string; reason?: string } {
  if (call.name !== 'run_command') return { command: '', reason: `不支持的工具：${call.name}` }
  try {
    const json = JSON.parse(call.arguments) as { command?: unknown; reason?: unknown }
    const command = typeof json.command === 'string' ? json.command.trim() : ''
    const reason = typeof json.reason === 'string' ? json.reason.trim() : undefined
    return { command, reason }
  } catch {
    return { command: call.arguments.trim() }
  }
}

function formatExecOutput(data: { stdout: string; stderr: string; code: number | null; timedOut: boolean }): string {
  const lines: string[] = []
  if (data.timedOut) lines.push('命令超时，已经强停。')
  lines.push(`exit ${data.code === null ? '?' : data.code}`)
  if (data.stdout.trim()) {
    lines.push('--- stdout ---')
    lines.push(data.stdout.trim())
  }
  if (data.stderr.trim()) {
    lines.push('--- stderr ---')
    lines.push(data.stderr.trim())
  }
  if (!data.stdout.trim() && !data.stderr.trim()) lines.push('(没有输出)')
  return lines.join('\n')
}

function toolFlag(status: AiChatMessage['toolStatus']): string {
  if (status === 'running') return '跑'
  if (status === 'denied') return '拒'
  if (status === 'timeout') return '超时'
  if (status === 'err') return '败'
  return '好'
}

function agentBusyText(step: number): string {
  if (step <= 1) return '正在看…'
  return `正在看第 ${step} / ${MAX_AGENT_STEPS} 步…`
}

function choiceFollowUp(item: AiChoiceItem): string {
  const line = item.detail ? `${item.title} — ${item.detail}` : item.title
  return `选这个：${line}`
}

function extractChoices(text: string, streaming = false): { text: string; choices?: AiChoices } {
  const patterns = [
    /(?:^|\n):::choices[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*(?:\r?\n|$)/,
    /```choices[ \t]*\r?\n([\s\S]*?)\r?\n```/
  ]
  let best: { index: number; length: number; inner: string } | undefined
  for (const re of patterns) {
    const match = text.match(re)
    if (!match || match.index === undefined) continue
    if (!best || match.index < best.index) {
      best = { index: match.index, length: match[0].length, inner: match[1] }
    }
  }
  if (best) {
    const parsed = parseChoicesJson(best.inner)
    if (parsed) {
      const before = text.slice(0, best.index).trimEnd()
      const after = text.slice(best.index + best.length).trimStart()
      return { text: [before, after].filter(Boolean).join('\n\n'), choices: parsed }
    }
  }
  if (streaming) {
    const start = text.search(/(?:^|\n):::choices\b|```choices\b/)
    if (start >= 0) return { text: text.slice(0, start).trimEnd() }
  }
  return { text }
}

function parseChoicesJson(raw: string): AiChoices | undefined {
  try {
    const json = JSON.parse(raw.trim()) as Partial<AiChoices> & { items?: unknown }
    if (!Array.isArray(json.items)) return undefined
    const items = json.items
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null
        const row = item as Partial<AiChoiceItem>
        const title = typeof row.title === 'string' ? row.title.trim() : ''
        if (!title) return null
        const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : String.fromCharCode(97 + index)
        const next: AiChoiceItem = { id, title }
        if (typeof row.detail === 'string' && row.detail.trim()) next.detail = row.detail.trim()
        if (typeof row.command === 'string' && row.command.trim()) next.command = row.command.trim()
        return next
      })
      .filter((item): item is AiChoiceItem => Boolean(item))
    if (items.length < 2 || items.length > 4) return undefined
    const recommend = typeof json.recommend === 'string' ? json.recommend.trim() : undefined
    const reason = typeof json.reason === 'string' ? json.reason.trim() : undefined
    return { items, recommend, reason }
  } catch {
    return undefined
  }
}

function splitBlocks(text: string): { type: 'text' | 'code'; text: string }[] {
  const chunks: { type: 'text' | 'code'; text: string }[] = []
  const parts = text.split(/```/)
  for (let i = 0; i < parts.length; i++) {
    const piece = parts[i]
    if (!piece) continue
    if (i % 2 === 1) {
      const code = piece.replace(/^[a-zA-Z0-9_-]+\s*\n/, '').trim()
      if (code) chunks.push({ type: 'code', text: code })
    } else {
      chunks.push(...splitPlain(piece))
    }
  }
  return chunks
}

function splitPlain(text: string): { type: 'text' | 'code'; text: string }[] {
  const chunks: { type: 'text' | 'code'; text: string }[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let buffer: string[] = []
  let mode: 'text' | 'code' | null = null

  function flush() {
    const joined = buffer.join('\n').trim()
    buffer = []
    if (joined && mode) chunks.push({ type: mode, text: joined })
  }

  for (const line of lines) {
    const next: 'text' | 'code' = isCommandLine(line) ? 'code' : 'text'
    if (mode && next !== mode) flush()
    mode = next
    buffer.push(line)
  }
  flush()
  return chunks
}

function isCommandLine(line: string): boolean {
  const text = line.trim().replace(/^`+|`+$/g, '')
  if (text.length < 2 || text.length > 400) return false
  if (/[\u4e00-\u9fff]/.test(text)) return false
  if (/^(https?:|www\.)/i.test(text)) return false
  if (
    /\b(uptime|free|df|top|ps|ss|netstat|journalctl|systemctl|dmesg|uname|hostname|whoami|lsblk|lsof|iostat|vmstat|curl|wget|chmod|chown|mkdir|rmdir|\brm\b|\bmv\b|\bcp\b|kill|pkill|crontab|docker|kubectl|nginx|git|tar|gzip|tee|xargs|watch|tcpdump|sysctl|cat|tail|head|grep|awk|sed|find|du|ping|ip|echo|pwd|id|date|which|stat|mount)\b/i.test(
      text
    )
  ) {
    return true
  }
  return /^(sudo\s+)?(\.\/|~\/|\/[a-zA-Z]|[a-z][\w.-]*\s+-[a-zA-Z]|[a-z][\w.-]*\s+.+\|)/.test(text)
}

function formatThreadTime(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

function isInteractive(command: string): boolean {
  return /^(sudo\s+)?(vi|vim|nano|emacs|less|more|top|htop|watch|man|tmux|screen)\b/i.test(command.trim())
}

function isDangerous(command: string): boolean {
  return /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b|\bmkfs\b|\bdd\s+if=|\breboot\b|\bshutdown\b|\bhalt\b|\bpoweroff\b|\bdrop\s+(table|database)\b|\bchmod\s+-R\s+777\s+\//i.test(
    command
  )
}

function agentCommandConfirm(
  command: string,
  dangerous: boolean,
  onSessionAll?: () => void
): ConfirmOptions {
  return {
    title: dangerous ? 'Agent 想跑危险命令' : 'Agent 要跑这条命令',
    message: dangerous ? '这条看起来不太善，确认让它执行？' : '',
    code: command,
    ok: dangerous ? '还是执行' : '同意执行',
    cancel: '取消',
    sessionAll: Boolean(onSessionAll),
    danger: dangerous,
    onSessionAll
  }
}

function readMode(): AiMode {
  try {
    const raw = localStorage.getItem('duty-ai-mode')
    if (raw === 'agent') return 'agent'
    if (raw === 'plan' && SHOW_PLAN_MODE) return 'plan'
    if (raw === 'plan') writeMode('ask')
    return 'ask'
  } catch {
    return 'ask'
  }
}

function writeMode(mode: AiMode): void {
  try {
    localStorage.setItem('duty-ai-mode', mode)
  } catch {
    /* ignore */
  }
}

function readThink(): boolean {
  try {
    return localStorage.getItem('duty-ai-think') !== '0'
  } catch {
    return true
  }
}

function writeThink(on: boolean): void {
  try {
    localStorage.setItem('duty-ai-think', on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function readAutopilot(): boolean {
  try {
    return localStorage.getItem('duty-ai-autopilot') !== '0'
  } catch {
    return true
  }
}

function writeAutopilot(on: boolean): void {
  try {
    localStorage.setItem('duty-ai-autopilot', on ? '1' : '0')
  } catch {
    /* ignore */
  }
}
