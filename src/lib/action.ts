// Run a user-triggered async action and surface its failure as a message instead of an
// unhandled rejection. Pairs with an `error` string a component renders inline.
import { errorMessage } from './errors'

/**
 * A runner bound to one error sink. Each call clears the sink, runs `fn`, and on a throw
 * reports the readable message and resolves to `undefined` (so callers can skip
 * follow-up work); on success it resolves to `fn`'s result.
 *
 *   let error = ''
 *   const run = actionRunner((m) => (error = m))
 *   const game = await run(() => joinGame(id))
 */
export function actionRunner(setError: (message: string) => void) {
  return async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setError('')
    try {
      return await fn()
    } catch (e) {
      setError(errorMessage(e))
      return undefined
    }
  }
}
