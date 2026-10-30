/** Canonical object ordering for comparisons without changing array order. */
export class CanonicalValue {
  static equal(left: unknown, right: unknown): boolean {
    const first = JSON.stringify(this.normalize(left))
    const second = JSON.stringify(this.normalize(right))
    return first === second
  }

  static normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.normalize(item))
    if (!value || typeof value !== 'object') return value
    return this.normalizeRecord(value as Record<string, unknown>)
  }

  private static normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
    const entries: Array<[string, unknown]> = []
    const keys = Object.keys(record).sort()
    for (const key of keys) {
      if (record[key] === undefined) continue
      entries.push([key, this.normalize(record[key])])
    }
    return Object.fromEntries(entries)
  }
}
