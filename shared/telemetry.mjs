// Slow request and slow query logging. One JSON line per event so Vercel/Replit logs can be searched
// (for example: event="slow_query"). Thresholds are environment variables; set either to 0 to disable.
const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const slowRequestMs = () => number(process.env.SLOW_REQUEST_MS, 1500);
const slowQueryMs = () => number(process.env.SLOW_QUERY_MS, 500);
const log = (event) => console.warn(JSON.stringify({ level: 'warn', ...event }));

export function watchRequest(req, res) {
  const started = performance.now();
  res.once('close', () => {
    const ms = Math.round(performance.now() - started),
      limit = slowRequestMs();
    if (!limit || ms < limit) return;
    const url = new URL(req.url, 'http://local'),
      route = url.searchParams.get('__route');
    log({
      event: 'slow_request',
      method: req.method,
      path: route ? '/api/' + route : url.pathname,
      status: res.statusCode,
      ms,
    });
  });
}

// Times one database call. Only the start of the statement is logged, never its parameters.
export async function timedQuery(sql, run) {
  const started = performance.now(),
    limit = slowQueryMs();
  try {
    return await run();
  } finally {
    const ms = Math.round(performance.now() - started);
    if (limit && ms >= limit)
      log({ event: 'slow_query', ms, sql: String(sql).replace(/\s+/g, ' ').trim().slice(0, 100) });
  }
}
