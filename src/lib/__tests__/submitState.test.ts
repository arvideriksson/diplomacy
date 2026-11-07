import { describe, expect, it } from 'vitest'
import { submitState } from '../submitState'

const base = { ready: false, dirty: false, resubmitted: false, saving: false }

describe('submitState', () => {
  it('walks Submit → Submitted → Resubmit → Resubmitted', () => {
    expect(submitState(base)).toEqual({ label: 'Submit', tone: 'submit', pressed: false })
    expect(submitState({ ...base, ready: true })).toEqual({ label: 'Submitted', tone: 'submit', pressed: true })
    expect(submitState({ ...base, ready: true, dirty: true })).toEqual({ label: 'Resubmit', tone: 'resubmit', pressed: false })
    expect(submitState({ ...base, ready: true, resubmitted: true })).toEqual({ label: 'Resubmitted', tone: 'resubmit', pressed: true })
  })
  it('shows the target state while saving', () => {
    expect(submitState({ ...base, saving: true })).toMatchObject({ label: 'Submitted', pressed: true })
    expect(submitState({ ...base, saving: true, ready: true, dirty: true })).toMatchObject({ label: 'Resubmitted', tone: 'resubmit', pressed: true })
  })
  it('has fixed states for idle and sandbox', () => {
    expect(submitState({ ...base, idle: true })).toEqual({ label: 'Nothing to order', tone: 'submit', pressed: true })
    expect(submitState({ ...base, sandbox: true, ready: true })).toEqual({ label: 'Resolve', tone: 'resolve', pressed: false })
  })
})
