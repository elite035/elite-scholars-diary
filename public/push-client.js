// Device notifications: subscribes this device automatically after sign-in.
// Browsers only show the permission prompt after a user gesture, so when permission is still
// undecided the prompt is raised by the first tap or key press after sign-in (or the banner button).
const OPT_OUT = 'elite-push-optout';
export function pushSupport() {
  const ios =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return {
    supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    ios,
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  };
}
const keyBytes = (key) => {
  const padded = key + '='.repeat((4 - (key.length % 4)) % 4),
    raw = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export async function subscribeDevice(api, publicKey) {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const wanted = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub?.options?.applicationServerKey && !same(new Uint8Array(sub.options.applicationServerKey), wanted)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
  await api('/api/school/push', { method: 'POST', body: { subscription: sub.toJSON() } });
  localStorage.removeItem(OPT_OUT);
  return sub;
}
// Returns: on | prompt | denied | off | ios_install | unsupported | not_configured | error
export async function pushStatus(info) {
  const s = pushSupport();
  if (!info.configured) return 'not_configured';
  if (!s.supported) return s.ios && !s.standalone ? 'ios_install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'prompt';
  if (localStorage.getItem(OPT_OUT) === '1') return 'off';
  return 'on';
}
export async function autoEnablePush({ api, onPrompt }) {
  const info = await api('/api/school/push'),
    status = await pushStatus(info);
  if (status === 'on') {
    try {
      await subscribeDevice(api, info.publicKey);
      return 'on';
    } catch {
      return 'error';
    }
  }
  if (status === 'prompt' && localStorage.getItem(OPT_OUT) !== '1') {
    const go = () => {
      removeEventListener('click', go, true);
      removeEventListener('keydown', go, true);
      onPrompt?.();
    };
    addEventListener('click', go, true);
    addEventListener('keydown', go, true);
  }
  return status;
}
// Must run inside a click/keydown handler so the browser allows the permission prompt.
export async function requestAndSubscribe(api) {
  const info = await api('/api/school/push');
  if (!info.configured) throw Error('Push delivery is not configured.');
  if (!pushSupport().supported) throw Error('This browser does not support phone notifications.');
  const result = await Notification.requestPermission();
  if (result !== 'granted')
    throw Error('Notification permission was not granted. Allow notifications for this site in your browser settings.');
  await subscribeDevice(api, info.publicKey);
  return 'on';
}
export async function turnOffThisDevice(api, { everywhere = false } = {}) {
  const reg = await navigator.serviceWorker?.getRegistration('/sw.js'),
    sub = await reg?.pushManager.getSubscription();
  await api('/api/school/push', {
    method: 'DELETE',
    body: everywhere || !sub ? {} : { endpoint: sub.endpoint },
  });
  if (sub) await sub.unsubscribe().catch(() => {});
  localStorage.setItem(OPT_OUT, '1');
}
// Sign-out: free this device so the next account can link it. Alerts resume on next sign-in.
export async function releaseDevice(api) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/sw.js'),
      sub = await reg?.pushManager.getSubscription();
    if (sub) await api('/api/school/push', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  } catch {}
}
