import { decodeSandbox as decode, encodeSandbox as encode, equal } from './codec'
import type { SandboxContent } from './timeline'
import { fromTimeline, toTimeline } from './timeline'
import {
  Base64Char,
  CompressionMode,
  DEFLATE_FORMAT,
  PAYLOAD_PATTERN,
  WireBit,
  WireHeader,
  WireError,
  WireLimit,
  WireSize,
} from './wire'

const ENVELOPE_BYTES = WireSize.Header + WireSize.Trailer

/** URL-safe, unpadded Base64 used by share links. */
class Base64Url {
  static encode(bytes: Uint8Array): string {
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(Base64Char.Empty)
    return btoa(binary)
      .replace(/\+/g, Base64Char.Minus)
      .replace(/\//g, Base64Char.Underline)
      .replace(/=+$/, Base64Char.Empty)
  }

  static decode(text: string): Uint8Array {
    const base64 = text.replace(/-/g, Base64Char.Plus).replace(/_/g, Base64Char.Slash)
    const binary = atob(base64)
    return Uint8Array.from(binary, (char) => char.charCodeAt(WireBit.Zero))
  }
}

/** Compression is optional when writing and bounded while reading. */
class StreamTransform {
  static async convert(bytes: Uint8Array, mode: CompressionMode): Promise<Uint8Array> {
    const stream = this.createStream(mode)
    const writer = stream.writable.getWriter()
    const writing = writer.write(Uint8Array.from(bytes)).then(() => writer.close())
    const reader = stream.readable.getReader()
    try {
      return await this.collect(reader, writing)
    } catch (error) {
      await this.cancel(reader, writing)
      throw error
    }
  }

  private static createStream(mode: CompressionMode): CompressionStream | DecompressionStream {
    if (mode === CompressionMode.Compress) return new CompressionStream(DEFLATE_FORMAT)
    return new DecompressionStream(DEFLATE_FORMAT)
  }

  private static async collect(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    writing: Promise<void>,
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = []
    let size = WireBit.Zero
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.length
      if (size > WireLimit.PayloadBytes) throw new Error(WireError.TooLarge)
      chunks.push(result.value)
    }
    await writing
    return this.join(chunks, size)
  }

  private static async cancel(reader: ReadableStreamDefaultReader<Uint8Array>, writing: Promise<void>): Promise<void> {
    await reader.cancel().catch(() => {
      /* Preserve the original error. */
    })
    await writing.catch(() => {
      /* Preserve the original error. */
    })
  }

  private static join(chunks: Uint8Array[], size: number): Uint8Array {
    const result = new Uint8Array(size)
    let offset = WireBit.Zero
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }
}

/** Prepare a portable timeline, encode it, and make a URL-safe payload. */
export async function encodeSandbox(sandbox: SandboxContent): Promise<string> {
  const timeline = toTimeline(sandbox)
  const envelope = encode(timeline)
  checkRoundTrip(sandbox, envelope)
  const packed = await packEnvelope(envelope)
  return Base64Url.encode(packed)
}

/** Validate and unpack a URL-safe payload before restoring its sandbox. */
export async function decodeSandbox(payload: string): Promise<SandboxContent> {
  checkPayload(payload)
  const envelope = Base64Url.decode(payload)
  checkEnvelope(envelope)
  const raw = await unpackEnvelope(envelope)
  const timeline = decode(raw)
  return fromTimeline(timeline)
}

function checkRoundTrip(sandbox: SandboxContent, envelope: Uint8Array): void {
  const restored = fromTimeline(decode(envelope))
  const { name, mapId, frames, cursor } = sandbox
  if (!equal(restored, { name, mapId, frames, cursor })) {
    throw new Error('This sandbox contains data that cannot be shared yet.')
  }
}

async function packEnvelope(envelope: Uint8Array): Promise<Uint8Array> {
  try {
    const body = envelope.subarray(WireSize.Header, -WireSize.Trailer)
    const compressed = await StreamTransform.convert(body, CompressionMode.Compress)
    if (compressed.length >= body.length) return envelope
    return makeEnvelope(envelope, compressed, WireHeader.Deflate)
  } catch {
    return envelope
  }
}

async function unpackEnvelope(envelope: Uint8Array): Promise<Uint8Array> {
  if (envelope[WireBit.Zero] !== WireHeader.Deflate) return envelope
  const body = envelope.subarray(WireSize.Header, -WireSize.Trailer)
  const raw = await StreamTransform.convert(body, CompressionMode.Decompress)
  return makeEnvelope(envelope, raw, WireHeader.Raw)
}

function checkPayload(payload: string): void {
  if (!payload || payload.length > WireLimit.PayloadChars || !PAYLOAD_PATTERN.test(payload)) {
    throw new Error(WireError.Invalid)
  }
}

function checkEnvelope(envelope: Uint8Array): void {
  const minimum = ENVELOPE_BYTES + WireBit.One
  const maximum = WireLimit.PayloadBytes + ENVELOPE_BYTES
  if (envelope.length < minimum || envelope.length > maximum) throw new Error(WireError.Invalid)
}

function makeEnvelope(source: Uint8Array, body: Uint8Array, kind: WireHeader): Uint8Array {
  const result = new Uint8Array(body.length + ENVELOPE_BYTES)
  result[WireBit.Zero] = kind
  result.set(body, WireSize.Header)
  result.set(source.subarray(-WireSize.Trailer), result.length - WireSize.Trailer)
  return result
}
