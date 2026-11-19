// Central transport errors keep failed writes visible; writes are never retried automatically.
export function createApiClient({
  fetchImpl = (...args) => fetch(...args),
  csrf = () => '',
  onUnauthorized = () => {},
  timeoutMs = 45000,
} = {}) {
  return async function api(path, options = {}) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), timeoutMs);
    const cancel = () => controller.abort(options.signal.reason);
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      let response;
      try {
        response = await fetchImpl(path, {
          credentials: 'same-origin',
          ...options,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf(),
            ...options.headers,
          },
          ...(options.body && typeof options.body !== 'string'
            ? { body: JSON.stringify(options.body) }
            : {}),
        });
      } catch (error) {
        if (options.signal?.aborted)
          throw Object.assign(Error('Request cancelled.'), { name: 'AbortError' });
        if (controller.signal.aborted)
          throw Error(
            'The request timed out. Check your connection and reload the record before trying to save again.',
          );
        if (error.name === 'AbortError') throw error;
        throw Error(
          'Unable to reach the school server. Check your connection. Your changes have not been confirmed as saved.',
        );
      }
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) onUnauthorized();
        const fallback =
          response.status === 429
            ? 'Too many requests. Wait a moment before trying again.'
            : response.status >= 500
              ? 'The school server is temporarily unavailable. Please try again shortly.'
              : 'The request could not be completed.';
        throw Object.assign(Error(typeof data?.error === 'string' ? data.error : fallback), {
          status: response.status,
        });
      }
      if (data === null)
        throw Error('The server returned an unexpected response. Reload before saving again.');
      return data;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  };
}
