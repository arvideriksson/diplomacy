// Short URL form of a UUID: the same 128 bits in base62, padded to 22 characters.
// Used for invite links (/join/<short>); the UUID stays the game's real id.

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const LENGTH = 22 // 62^22 > 2^128
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHORT_RE = new RegExp(`^[${ALPHABET}]{${LENGTH}}$`)

export function shortenUuid(uuid: string): string {
  let n = BigInt(`0x${uuid.replace(/-/g, '')}`)
  let out = ''
  while (n > 0n) {
    out = ALPHABET[Number(n % 62n)] + out
    n /= 62n
  }
  return out.padStart(LENGTH, ALPHABET[0])
}

/** The UUID behind a short id; a full UUID (old links) or anything unrecognised passes through. */
export function expandUuid(id: string): string {
  if (UUID_RE.test(id) || !SHORT_RE.test(id)) return id
  let n = 0n
  for (const c of id) n = n * 62n + BigInt(ALPHABET.indexOf(c))
  if (n >> 128n) return id
  const hex = n.toString(16).padStart(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
