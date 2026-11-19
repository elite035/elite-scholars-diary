import webpush from 'web-push';
export function validSubscription(value) {
  try {
    const url = new URL(value.endpoint),
      host = url.hostname;
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      value.endpoint.length <= 2048 &&
      (host === 'fcm.googleapis.com' ||
        host === 'updates.push.services.mozilla.com' ||
        host === 'web.push.apple.com' ||
        host.endsWith('.notify.windows.com')) &&
      /^[\w-]{80,100}$/.test(value.keys?.p256dh || '') &&
      /^[\w-]{20,30}$/.test(value.keys?.auth || '')
    );
  } catch {
    return false;
  }
}
export function pushService(db, send = webpush.sendNotification.bind(webpush)) {
  const { all, one, run, id, now, transaction, audit } = db;
  function configured() {
    return !!(
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
    );
  }
  async function dispatch() {
    if (!configured()) return { configured: false, sent: 0 };
    const since = new Date(Date.now() - 86400000).toISOString(),
      lease = new Date(Date.now() - 300000).toISOString(),
      rows = await all(
        "SELECT n.id notification_id,n.dedupe_key,s.* FROM notifications n JOIN push_subscriptions s ON s.user_id=n.user_id JOIN push_preferences p ON p.user_id=s.user_id JOIN users u ON u.id=n.user_id WHERE u.active=1 AND p.enabled=1 AND n.created_at>? AND NOT EXISTS(SELECT 1 FROM push_deliveries d WHERE d.notification_id=n.id AND d.subscription_id=s.id AND (d.status='sent' OR d.attempts>=3 OR d.status='sending' AND d.updated_at>=?)) ORDER BY n.created_at LIMIT 10",
        since,
        lease,
      );
    let sent = 0;
    const removed = new Set();
    for (const row of rows) {
      if (removed.has(row.id)) continue;
      await run(
        "INSERT OR IGNORE INTO push_deliveries VALUES(?,?,'pending',0,?,NULL)",
        row.notification_id,
        row.id,
        now(),
      );
      const claim = await run(
        "UPDATE push_deliveries SET status='sending',attempts=attempts+1,updated_at=? WHERE notification_id=? AND subscription_id=? AND attempts<3 AND (status IN('pending','failed') OR (status='sending' AND updated_at<?))",
        now(),
        row.notification_id,
        row.id,
        lease,
      );
      if (!claim.changes) continue;
      const school = /^school:([\w-]+):/.exec(row.dedupe_key),
        parent = /^parent:([\w-]+):(\d{4}-\d{2}-\d{2})/.exec(row.dedupe_key);
      const path = school
        ? '/#/schooldiaries?id=' + school[1]
        : parent
          ? '/#/family?section=' + parent[1] + '&date=' + parent[2]
          : '/#/notifications';
      try {
        await send(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify({
            title: 'Elite Scholars',
            body: 'A school diary update is ready. Sign in to view it.',
            url: path,
            tag: row.notification_id,
          }),
          {
            vapidDetails: {
              subject: process.env.VAPID_SUBJECT,
              publicKey: process.env.VAPID_PUBLIC_KEY,
              privateKey: process.env.VAPID_PRIVATE_KEY,
            },
            TTL: 86400,
            urgency: 'high',
            timeout: 5000,
          },
        );
        await run(
          "UPDATE push_deliveries SET status='sent',updated_at=?,error_code=NULL WHERE notification_id=? AND subscription_id=?",
          now(),
          row.notification_id,
          row.id,
        );
        sent++;
      } catch (e) {
        if ([404, 410].includes(e.statusCode)) {
          removed.add(row.id);
          await transaction(async () => {
            await run('DELETE FROM push_deliveries WHERE subscription_id=?', row.id);
            await run('DELETE FROM push_subscriptions WHERE id=?', row.id);
            await audit(null, 'expired_push_subscription_removed', null);
          });
        } else
          await run(
            "UPDATE push_deliveries SET status='failed',updated_at=?,error_code=? WHERE notification_id=? AND subscription_id=?",
            now(),
            String(e.statusCode || 'network').slice(0, 30),
            row.notification_id,
            row.id,
          );
      }
    }
    return { configured: true, sent };
  }
  return {
    configured,
    dispatch,
    async route({ path, method, b, u, res, reply, check }) {
      if (path === '/api/school/push' && method === 'GET') {
        const pref = await one('SELECT enabled FROM push_preferences WHERE user_id=?', u.id);
        return (
          reply(res, 200, {
            configured: configured(),
            publicKey: process.env.VAPID_PUBLIC_KEY || '',
            enabled: !!pref?.enabled,
            devices: Number(
              (await one('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=?', u.id)).n,
            ),
          }),
          true
        );
      }
      if (path === '/api/school/push' && method === 'POST') {
        check(configured(), 'Phone notifications are not configured', 503);
        check(validSubscription(b.subscription), 'Invalid or unsupported push subscription', 400);
        const s = b.subscription;
        await transaction(async () => {
          const old = await one('SELECT * FROM push_subscriptions WHERE endpoint=?', s.endpoint);
          check(
            (old && old.user_id === u.id) ||
              Number(
                (await one('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=?', u.id)).n,
              ) < 10,
            'Maximum 10 notification devices',
            400,
          );
          if (old && old.user_id !== u.id) {
            // The signed-in person on this device receives its alerts; the previous account is unlinked.
            const previous = old.user_id;
            await run('DELETE FROM push_deliveries WHERE subscription_id=?', old.id);
            await run('UPDATE push_subscriptions SET user_id=?,p256dh=?,auth=? WHERE id=?', u.id, s.keys.p256dh, s.keys.auth, old.id);
            const left = await one('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=?', previous);
            if (!Number(left.n)) await run('UPDATE push_preferences SET enabled=0 WHERE user_id=?', previous);
            await audit(u, 'push_device_relinked', u.id);
          } else if (old)
            await run(
              'UPDATE push_subscriptions SET p256dh=?,auth=? WHERE id=?',
              s.keys.p256dh,
              s.keys.auth,
              old.id,
            );
          else
            await run(
              'INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?)',
              id(),
              u.id,
              s.endpoint,
              s.keys.p256dh,
              s.keys.auth,
              now(),
            );
          await run('INSERT OR IGNORE INTO push_preferences VALUES(?,1)', u.id);
          await run('UPDATE push_preferences SET enabled=1 WHERE user_id=?', u.id);
          await audit(u, 'push_notifications_enabled', u.id);
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/school/push' && method === 'DELETE') {
        await transaction(async () => {
          const endpoint = typeof b?.endpoint === 'string' ? b.endpoint : '',
            rows = endpoint
              ? await all('SELECT id FROM push_subscriptions WHERE user_id=? AND endpoint=?', u.id, endpoint)
              : await all('SELECT id FROM push_subscriptions WHERE user_id=?', u.id);
          for (const row of rows) {
            await run('DELETE FROM push_deliveries WHERE subscription_id=?', row.id);
            await run('DELETE FROM push_subscriptions WHERE id=?', row.id);
          }
          const left = await one('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=?', u.id);
          if (!Number(left.n)) await run('UPDATE push_preferences SET enabled=0 WHERE user_id=?', u.id);
          await audit(u, 'push_notifications_disabled', u.id);
        });
        return (reply(res, 200, { ok: true }), true);
      }
      return false;
    },
  };
}
