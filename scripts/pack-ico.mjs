import { inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'

function decodePng(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('not a PNG')
  }
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  const chunks = []
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      chunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (depth !== 8) throw new Error(`need 8-bit PNG, got ${depth}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`)

  const inflated = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const rgba = Buffer.alloc(width * height * 4)
  let src = 0
  let prev = Buffer.alloc(stride)

  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }

  for (let y = 0; y < height; y++) {
    const filter = inflated[src++]
    const row = inflated.subarray(src, src + stride)
    src += stride
    const recon = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const x = row[i]
      const a = i >= channels ? recon[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      recon[i] =
        (filter === 0
          ? x
          : filter === 1
            ? x + a
            : filter === 2
              ? x + b
              : filter === 3
                ? x + ((a + b) >> 1)
                : x + paeth(a, b, c)) & 255
    }
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4
      if (channels === 4) {
        recon.copy(rgba, di, x * 4, x * 4 + 4)
      } else if (channels === 3) {
        rgba[di] = recon[x * 3]
        rgba[di + 1] = recon[x * 3 + 1]
        rgba[di + 2] = recon[x * 3 + 2]
        rgba[di + 3] = 255
      } else {
        rgba[di] = rgba[di + 1] = rgba[di + 2] = recon[x]
        rgba[di + 3] = 255
      }
    }
    prev = recon
  }
  return { width, height, rgba }
}

function toBmpDib(width, height, rgba) {
  const xorRow = width * 4
  const andRow = ((width + 31) >> 5) * 4
  const xorSize = xorRow * height
  const andSize = andRow * height
  const dib = Buffer.alloc(40 + xorSize + andSize)
  dib.writeUInt32LE(40, 0)
  dib.writeInt32LE(width, 4)
  dib.writeInt32LE(height * 2, 8)
  dib.writeUInt16LE(1, 12)
  dib.writeUInt16LE(32, 14)
  dib.writeUInt32LE(xorSize, 20)

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y
    for (let x = 0; x < width; x++) {
      const si = (srcY * width + x) * 4
      const di = 40 + y * xorRow + x * 4
      dib[di] = rgba[si + 2]
      dib[di + 1] = rgba[si + 1]
      dib[di + 2] = rgba[si]
      dib[di + 3] = rgba[si + 3]
    }
  }

  const andOff = 40 + xorSize
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y
    for (let x = 0; x < width; x++) {
      if (rgba[(srcY * width + x) * 4 + 3] < 128) {
        dib[andOff + y * andRow + (x >> 3)] |= 1 << (7 - (x & 7))
      }
    }
  }
  return dib
}

export function packIco(pngPaths, outPath) {
  const images = pngPaths.map((file) => {
    const { width, height, rgba } = decodePng(readFileSync(file))
    const buf = toBmpDib(width, height, rgba)
    return { buf, width, height }
  })
  const header = 6 + 16 * images.length
  let offset = header
  const out = Buffer.alloc(header + images.reduce((sum, item) => sum + item.buf.length, 0))
  out.writeUInt16LE(1, 2)
  out.writeUInt16LE(images.length, 4)
  let cursor = 6
  for (const item of images) {
    out.writeUInt8(item.width >= 256 ? 0 : item.width, cursor)
    out.writeUInt8(item.height >= 256 ? 0 : item.height, cursor + 1)
    out.writeUInt16LE(1, cursor + 4)
    out.writeUInt16LE(32, cursor + 6)
    out.writeUInt32LE(item.buf.length, cursor + 8)
    out.writeUInt32LE(offset, cursor + 12)
    item.buf.copy(out, offset)
    offset += item.buf.length
    cursor += 16
  }
  writeFileSync(outPath, out)
}

const [outPath, ...pngPaths] = process.argv.slice(2)
if (outPath && pngPaths.length) packIco(pngPaths, outPath)
