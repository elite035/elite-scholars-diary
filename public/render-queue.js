// Serialize DOM writes and coalesce requests for the same pending navigation.
export function serializeRender(draw) {
  let running = false,
    pending;
  async function render() {
    if (running) {
      if (!pending) {
        let resolve, reject;
        const promise = new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        });
        pending = { promise, resolve, reject };
      }
      return pending.promise;
    }
    running = true;
    try {
      return await draw();
    } finally {
      running = false;
      if (pending) {
        const next = pending;
        pending = null;
        render().then(next.resolve, next.reject);
      }
    }
  }
  return render;
}
