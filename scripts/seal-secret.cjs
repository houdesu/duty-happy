const { createCipheriv, randomBytes } = require('crypto')
const { writeFileSync } = require('fs')
const { join } = require('path')

const plaintext = process.argv[2]
if (!plaintext) {
  console.error('Usage: node scripts/seal-secret.cjs <api-key>')
  process.exit(1)
}

const aesKey = randomBytes(32)
const mask = randomBytes(32)
const seed = Buffer.from(aesKey.map((byte, i) => byte ^ mask[i]))
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
const tag = cipher.getAuthTag()

function nums(buf) {
  const values = [...buf]
  const lines = []
  for (let i = 0; i < values.length; i += 16) {
    lines.push('  ' + values.slice(i, i + 16).join(', '))
  }
  return lines.join(',\n')
}

const file = `import { createDecipheriv } from 'crypto'

const MASK = new Uint8Array([
${nums(mask)}
])
const SEED = new Uint8Array([
${nums(seed)}
])
const IV = new Uint8Array([
${nums(iv)}
])
const TAG = new Uint8Array([
${nums(tag)}
])
const DATA = new Uint8Array([
${nums(data)}
])

function xor(a: Uint8Array, b: Uint8Array): Buffer {
  return Buffer.from(a.map((value, index) => value ^ b[index]))
}

export function builtinApiKey(): string {
  const fromEnv = process.env.MINIMAX_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const decipher = createDecipheriv('aes-256-gcm', xor(MASK, SEED), Buffer.from(IV))
  decipher.setAuthTag(Buffer.from(TAG))
  return Buffer.concat([decipher.update(Buffer.from(DATA)), decipher.final()]).toString('utf8')
}
`

const out = join(__dirname, '../src/main/secret.ts')
writeFileSync(out, file, 'utf8')
console.log(`sealed -> ${out}`)
