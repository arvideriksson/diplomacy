import type { SandboxContent } from './timeline'
import { toTimeline } from './timeline'
import { encodeSandbox as encode, decodeSandbox as decode, equal } from './codec.js'

const MAX_BYTES = 32768
const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromBase64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

async function transform(bytes: Uint8Array, mode: 'compress' | 'decompress'): Promise<Uint8Array> {
  const stream = mode === 'compress' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  const writing = writer.write(Uint8Array.from(bytes)).then(() => writer.close())
  const reader = stream.readable.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) throw new Error('Sandbox payload is too large')
      chunks.push(value)
    }
    await writing
  } catch (error) {
    await reader.cancel().catch(() => {})
    await writing.catch(() => {})
    throw error
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

/** Convert only if the codec can reproduce all current sandbox data. */
export async function encodeSandbox(sandbox: SandboxContent): Promise<string> {
  toTimeline(sandbox)
  const payload = encode(sandbox)
  const result = decode(payload) as SandboxContent
  if (!equal(result, {
    name: sandbox.name, mapId: sandbox.mapId, frames: sandbox.frames, cursor: sandbox.cursor,
  })) throw new Error('This sandbox contains data that cannot be shared yet.')
  const envelope = fromBase64(payload)
  try {
    const compressed = await transform(envelope.subarray(1, -4), 'compress')
    if (compressed.length < envelope.length - 5) {
      const packed = new Uint8Array(compressed.length + 5)
      packed[0] = 0x11
      packed.set(compressed, 1)
      packed.set(envelope.subarray(-4), packed.length - 4)
      return toBase64(packed)
    }
  } catch { /* Raw payloads work even without browser compression support. */ }
  return payload
}

export async function decodeSandbox(payload: string): Promise<SandboxContent> {
  if (!payload || payload.length > 44000 || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error('Invalid sandbox payload')
  const envelope = fromBase64(payload)
  if (envelope.length < 6 || envelope.length > MAX_BYTES + 5) throw new Error('Invalid sandbox payload')
  let raw = payload
  if (envelope[0] === 0x11) {
    const body = await transform(envelope.subarray(1, -4), 'decompress')
    const unpacked = new Uint8Array(body.length + 5)
    unpacked[0] = 0x10
    unpacked.set(body, 1)
    unpacked.set(envelope.subarray(-4), unpacked.length - 4)
    raw = toBase64(unpacked)
  }
  const sandbox = decode(raw) as SandboxContent
  toTimeline(sandbox)
  return sandbox
}
