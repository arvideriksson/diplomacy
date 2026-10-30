import { decodeSandbox as decode, encodeSandbox as encode, equal } from './codec'
import type { SandboxContent } from './timeline'
import { toTimeline } from './timeline'
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

/** Convert between the local sandbox model and a portable, checksummed payload. */
class SandboxTransport {
  static async encode(sandbox: SandboxContent): Promise<string> {
    const timeline = toTimeline(sandbox)
    const envelope = encode(sandbox, timeline)
    this.checkRoundTrip(sandbox, envelope)
    const compressed = await this.compress(envelope)
    return Base64Url.encode(compressed)
  }

  private static checkRoundTrip(sandbox: SandboxContent, payload: Uint8Array): void {
    const result = decode(payload)
    const { name, mapId, frames, cursor } = sandbox
    if (!equal(result, { name, mapId, frames, cursor })) {
      throw new Error('This sandbox contains data that cannot be shared yet.')
    }
  }

  private static async compress(envelope: Uint8Array): Promise<Uint8Array> {
    try {
      const body = envelope.subarray(WireSize.Header, -WireSize.Trailer)
      const compressed = await StreamTransform.convert(body, CompressionMode.Compress)
      if (compressed.length >= body.length) return envelope
      const packed = this.makeEnvelope(envelope, compressed, WireHeader.Deflate)
      return packed
    } catch {
      return envelope
    }
  }

  static async decode(payload: string): Promise<SandboxContent> {
    this.checkPayload(payload)
    const envelope = Base64Url.decode(payload)
    this.checkEnvelope(envelope)
    const raw = await this.uncompress(envelope)
    const sandbox = decode(raw)
    toTimeline(sandbox)
    return sandbox
  }

  private static checkPayload(payload: string): void {
    if (!payload || payload.length > WireLimit.PayloadChars || !PAYLOAD_PATTERN.test(payload)) {
      throw new Error(WireError.Invalid)
    }
  }

  private static checkEnvelope(envelope: Uint8Array): void {
    const minimum = ENVELOPE_BYTES + WireBit.One
    const maximum = WireLimit.PayloadBytes + ENVELOPE_BYTES
    if (envelope.length < minimum || envelope.length > maximum) throw new Error(WireError.Invalid)
  }

  private static async uncompress(envelope: Uint8Array): Promise<Uint8Array> {
    if (envelope[WireBit.Zero] !== WireHeader.Deflate) return envelope
    const body = envelope.subarray(WireSize.Header, -WireSize.Trailer)
    const raw = await StreamTransform.convert(body, CompressionMode.Decompress)
    const unpacked = this.makeEnvelope(envelope, raw, WireHeader.Raw)
    return unpacked
  }

  private static makeEnvelope(source: Uint8Array, body: Uint8Array, kind: WireHeader): Uint8Array {
    const result = new Uint8Array(body.length + ENVELOPE_BYTES)
    result[WireBit.Zero] = kind
    result.set(body, WireSize.Header)
    result.set(source.subarray(-WireSize.Trailer), result.length - WireSize.Trailer)
    return result
  }
}

export async function encodeSandbox(sandbox: SandboxContent): Promise<string> {
  return SandboxTransport.encode(sandbox)
}

export async function decodeSandbox(payload: string): Promise<SandboxContent> {
  return SandboxTransport.decode(payload)
}
