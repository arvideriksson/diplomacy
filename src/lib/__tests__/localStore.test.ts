import { afterEach, describe, expect, it } from 'vitest'
import { local, session } from '../localStore'

const data = new Map<string, string>()
const working = {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, v),
  removeItem: (k: string) => void data.delete(k),
  clear: () => data.clear(),
  key: () => null,
  length: 0,
} as Storage
const boom = () => {
  throw new DOMException('QuotaExceededError')
}
const broken = { ...working, getItem: boom, setItem: boom, removeItem: boom } as Storage

afterEach(() => {
  data.clear()
  delete (globalThis as { localStorage?: Storage }).localStorage
  delete (globalThis as { sessionStorage?: Storage }).sessionStorage
})

describe('guarded storage', () => {
  it('round-trips JSON, strings and flags', () => {
    globalThis.localStorage = working
    expect(local.writeJSON('k', { a: [1] })).toBe(true)
    expect(data.get('k')).toBe('{"a":[1]}')
    expect(local.readJSON('k', null)).toEqual({ a: [1] })
    local.writeFlag('f', true)
    expect(data.get('f')).toBe('1')
    expect(local.readFlag('f')).toBe(true)
    local.writeFlag('f', false)
    expect(data.has('f')).toBe(false)
    local.remove('k')
    expect(local.readJSON('k', 'fallback')).toBe('fallback')
  })

  it('falls back on missing, empty and corrupt values', () => {
    globalThis.localStorage = working
    expect(local.readJSON('missing', 7)).toBe(7)
    data.set('empty', '')
    expect(local.readJSON('empty', 7)).toBe(7)
    data.set('bad', '{nope')
    expect(local.readJSON('bad', 7)).toBe(7)
  })

  it('never throws when storage is unavailable or full', () => {
    globalThis.localStorage = broken
    expect(local.read('k')).toBeNull()
    expect(local.readJSON('k', [])).toEqual([])
    expect(local.write('k', 'v')).toBe(false)
    expect(local.writeJSON('k', { a: 1 })).toBe(false)
    expect(() => local.remove('k')).not.toThrow()
    expect(local.readFlag('k')).toBe(false)
    expect(() => local.writeFlag('k', true)).not.toThrow()
  })

  it('never throws when storage is missing entirely', () => {
    expect(local.read('k')).toBeNull()
    expect(local.write('k', 'v')).toBe(false)
    expect(session.take('k')).toBeNull()
  })

  it('reports an unserializable value as not written', () => {
    globalThis.localStorage = working
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(local.writeJSON('k', cyclic)).toBe(false)
    expect(data.has('k')).toBe(false)
  })

  it('takes a session value once', () => {
    globalThis.sessionStorage = working
    session.write('path', '/join/1')
    expect(session.take('path')).toBe('/join/1')
    expect(session.take('path')).toBeNull()
  })
})
