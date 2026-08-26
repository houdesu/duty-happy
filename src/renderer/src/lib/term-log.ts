const MAX = 16000
const logs = new Map<string, string>()

export function appendTerm(tabId: string, chunk: string): void {
  if (!chunk) return
  const next = (logs.get(tabId) || '') + stripAnsi(chunk)
  logs.set(tabId, next.length > MAX ? next.slice(next.length - MAX) : next)
}

export function snapshotTerm(tabId: string): string {
  return logs.get(tabId) || ''
}

export function dropTerm(tabId: string): void {
  logs.delete(tabId)
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '')
    .replace(/\u001b[PX^_].*?\u001b\\/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}
