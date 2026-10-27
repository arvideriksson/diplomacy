import { writable } from 'svelte/store'
import { rpc } from './rpc'

// Web Push for this device: new press, new rounds and the one-hour deadline reminder
// (decided server-side, see 20250101000147_push_notifications.sql). Needs the PWA
// service worker, so it's unavailable on the dev server and in iOS Safari tabs
// (iOS only allows push once the app is added to the home screen).

const VAPID_PUBLIC_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY

// On by default: a device subscribes unless its user switched notifications off here.
const OPT_OUT_KEY = 'push-opted-out'

function optedOut(): boolean {
  try { return localStorage.getItem(OPT_OUT_KEY) === '1' } catch { return false }
}

function setOptedOut(on: boolean) {
  try { on ? localStorage.setItem(OPT_OUT_KEY, '1') : localStorage.removeItem(OPT_OUT_KEY) } catch {}
}

// The permission prompt needs a user gesture (strictly so on iOS), so the default-on
// subscribe waits for the first tap anywhere.
let promptArmed = false

function armPromptOnFirstTap() {
  if (promptArmed) return
  promptArmed = true
  window.addEventListener('click', () => {
    promptArmed = false
    if (Notification.permission === 'default' && !optedOut()) enablePush().catch(() => {})
  }, { once: true, capture: true })
}

/** null until checked; false where this device can't do push. */
export const pushSupported = writable<boolean | null>(null)
export const pushEnabled = writable(false)

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return undefined
  }
  return navigator.serviceWorker.getRegistration()
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function save(sub: PushSubscription) {
  const json = sub.toJSON()
  await rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  })
}

/**
 * Check support, re-claim an existing subscription for the signed-in user, or (unless
 * this device opted out) subscribe: silently if permission is already granted, else on
 * the first tap.
 */
export async function initPush() {
  const reg = await registration()
  pushSupported.set(!!reg)
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (sub && Notification.permission === 'granted') {
    pushEnabled.set(true)
    await save(sub).catch(() => {})
    return
  }
  pushEnabled.set(false)
  if (optedOut()) return
  if (Notification.permission === 'granted') await enablePush().catch(() => {})
  else if (Notification.permission === 'default') armPromptOnFirstTap()
}

export async function enablePush(): Promise<boolean> {
  // Ask first, while the tap that triggered this still counts as a user gesture.
  const permission = await Notification.requestPermission()
  const reg = await registration()
  if (!reg || permission !== 'granted') return false
  setOptedOut(false)
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY!) }))
  await save(sub)
  pushEnabled.set(true)
  return true
}

/** Unsubscribe this device; `optOut` (the menu switch) keeps it off until switched back on. */
export async function disablePush(optOut = false) {
  if (optOut) setOptedOut(true)
  const sub = await (await registration())?.pushManager.getSubscription()
  pushEnabled.set(false)
  if (!sub) return
  await rpc('delete_push_subscription', { p_endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe()
}
