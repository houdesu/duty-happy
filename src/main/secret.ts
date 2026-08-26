export function builtinApiKey(): string {
  return process.env.MINIMAX_API_KEY?.trim() || ''
}
