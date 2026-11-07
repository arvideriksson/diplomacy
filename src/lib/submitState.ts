// The Submit button's state, shared by the order panel's footer and the phone map strip.
//   not submitted        → green  "Submit" button
//   submitted, no edits  → green  "✓ Submitted" status
//   submitted, edited    → blue   "Resubmit" button
//   resubmitted, no edits → blue  "✓ Resubmitted" status
// No transient "Submitting…": while a save is in flight it shows the committed state it's
// heading for.

export interface SubmitInput {
  /** This nation is ready (optimistically, while a submit is in flight). */
  ready: boolean
  /** Edits made since submitting, not yet resubmitted. */
  dirty: boolean
  /** The user resubmitted in this view (Resubmitted rather than Submitted). */
  resubmitted: boolean
  /** A submit is in flight. */
  saving: boolean
  /** Nothing to order this phase (auto-readied server-side). */
  idle?: boolean
  /** Sandbox: a plain Resolve. */
  sandbox?: boolean
}

export interface SubmitState {
  label: string
  tone: 'submit' | 'resubmit' | 'resolve'
  /** A status rather than a button: nothing to press. */
  pressed: boolean
}

export function submitState({ ready, dirty, resubmitted, saving, idle = false, sandbox = false }: SubmitInput): SubmitState {
  if (sandbox) return { label: 'Resolve', tone: 'resolve', pressed: false }
  if (idle) return { label: 'Nothing to order', tone: 'submit', pressed: true }
  const label = saving
    ? ready
      ? 'Resubmitted'
      : 'Submitted'
    : !ready
      ? 'Submit'
      : dirty
        ? 'Resubmit'
        : resubmitted
          ? 'Resubmitted'
          : 'Submitted'
  return {
    label,
    tone: !ready || (!dirty && !resubmitted) ? 'submit' : 'resubmit',
    pressed: saving || (ready && !dirty),
  }
}
