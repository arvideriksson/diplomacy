import { writable } from 'svelte/store'
import { rpc } from './rpc'

// Web Push for this device: new press, new rounds and the one-hour deadline reminder
// (decided server-side, see 20250101000147_push_notifications.sql). Needs the PWA
// service worker, so it's unavailable on the dev server and in iOS Safari tabs
// (iOS only allows push once the app is added to the home screen).

const VAPID_PUBLIC_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY

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

/** Check support and, if this device is already subscribed, re-claim it for the signed-in user. */
export async function initPush() {
  const reg = await registration()
  pushSupported.set(!!reg)
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  const on = !!sub && Notification.permission === 'granted'
  pushEnabled.set(on)
  if (on) await save(sub!).catch(() => {})
}

export async function enablePush(): Promise<boolean> {
  const reg = await registration()
  if (!reg || (await Notification.requestPermission()) !== 'granted') return false
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY!) }))
  await save(sub)
  pushEnabled.set(true)
  return true
}

export async function disablePush() {
  const sub = await (await registration())?.pushManager.getSubscription()
  pushEnabled.set(false)
  if (!sub) return
  await rpc('delete_push_subscription', { p_endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe()
}
