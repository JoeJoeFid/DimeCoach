// Notifications on this device: asking the browser for them, and telling the server where to
// send them. The showing is done by the helper in public/sw.js, which runs even when no page is open.
import { useEffect } from 'react';
import { api } from './api';
import { isInstalled } from './components/InstallApp';

/**
 * The number on the app's own icon, where the app has been put on a home screen, a taskbar or a
 * dock: how much is waiting unread. None at 0. A browser that has no such number does nothing.
 * While no page is open it is kept up by public/sw.js, each time a notification arrives.
 */
export function setAppBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) nav.setAppBadge?.(count).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  } catch {
    // Not allowed here: there is simply no number.
  }
}
/** Keeps the number on the app's icon at `count` for as long as the page is open. */
export function useAppBadge(count: number) {
  useEffect(() => setAppBadge(count), [count]);
}

/** Where this device stands. */
export type PushState =
  | 'unsupported' // this browser cannot do it at all
  | 'needs-install' // an iPhone or iPad, which only allows it for an app on the home screen
  | 'blocked' // the person said no to the browser, and only they can undo that in its settings
  | 'off'
  | 'on';

const isApple = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const capable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
/** The key the server gives, in the form the browser wants it. */
function bytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
/** The helper, once it is running. Null when it is not there (as while developing). */
async function helper(): Promise<ServiceWorkerRegistration | null> {
  if (!capable()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!capable()) return isApple() && !isInstalled() ? 'needs-install' : 'unsupported';
  if (isApple() && !isInstalled()) return 'needs-install';
  if (Notification.permission === 'denied') return 'blocked';
  const sub = await (await helper())?.pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') return 'off';
  try {
    return (await api.pushKey(sub.endpoint)).on ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** Turns notifications on for this device. It has to come from a press, or the browser will not ask. */
export async function enablePush(): Promise<PushState> {
  const reg = await helper();
  if (!reg) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'blocked' : 'off';
  const { key } = await api.pushKey();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) }));
  await api.pushSubscribe(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const sub = await (await helper())?.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}

/**
 * Called when someone is signed in. A device that already has notifications allowed is put back
 * on the server's list for whoever is using it now, since signing out takes it off.
 */
export async function syncPush() {
  try {
    if (!capable() || Notification.permission !== 'granted') return;
    const sub = await (await helper())?.pushManager.getSubscription();
    if (sub) await api.pushSubscribe(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
  } catch {
    /* it can be turned on again by hand */
  }
}

/** Before signing out: this device stops getting the notifications of the person leaving it. */
export async function forgetPush() {
  try {
    const sub = await (await helper())?.pushManager.getSubscription();
    if (sub) await api.pushUnsubscribe(sub.endpoint);
  } catch {
    /* signing out goes ahead regardless */
  }
}
