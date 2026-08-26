export function explainFsError(
  action: 'upload' | 'list' | 'mkdir' | 'download' | 'delete' | 'copy' | 'move',
  path: string,
  error?: string
): string {
  const raw = (error || '').toLowerCase()
  const where = path || '当前目录'
  const denied =
    raw.includes('permission denied') ||
    raw.includes('eacces') ||
    raw.includes('eperm') ||
    raw.includes('access denied') ||
    raw.includes('ssh_fx_permission') ||
    (raw.includes('status') && /\b3\b/.test(raw))

  if (denied) {
    if (action === 'upload' || action === 'copy') return `没权限写到 ${where}，换个家目录或有写权限的账号`
    if (action === 'move') return `没权限移动到 ${where}`
    if (action === 'mkdir') return `没权限在 ${where} 里建文件夹`
    if (action === 'delete') return `没权限删除 ${where}`
    if (action === 'download') return `没权限读取 ${where}`
    return `没权限打开 ${where}`
  }
  if (raw.includes('no such file') || raw.includes('enoent')) return `找不到 ${where}`
  if (raw.includes('not a directory')) return `${where} 不是目录`
  if (raw.includes('is a directory')) return `${where} 是文件夹，不能当文件传`
  if (raw.includes('no space') || raw.includes('enospc')) return '磁盘满了，传不上去'
  if (raw.includes('file exists') || raw.includes('eexist')) return `${where} 已经有同名文件了`
  if (raw.includes('failure') || raw === 'fail') {
    if (action === 'upload' || action === 'copy') return `服务器拒绝写入 ${where}，多半是没权限或磁盘满了`
    if (action === 'move') return `服务器拒绝移动到 ${where}`
    return `服务器拒绝操作 ${where}`
  }

  if (error?.trim() && !looksEnglish(error)) return error
  if (action === 'upload') return error?.trim() ? `上传失败：${zhFallback(error)}` : '上传失败'
  if (action === 'download') return '下载失败'
  if (action === 'copy') return '复制失败'
  if (action === 'move') return '移动失败'
  return '操作失败'
}

function looksEnglish(text: string): boolean {
  return /^[\x00-\x7F]+$/.test(text.trim())
}

function zhFallback(error: string): string {
  const raw = error.toLowerCase()
  if (raw.includes('timeout')) return '超时了'
  if (raw.includes('disconnect') || raw.includes('not connected')) return '连接断了'
  return '看终端或换个目录再试'
}
