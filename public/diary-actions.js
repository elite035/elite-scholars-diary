const installed = new WeakMap();
export function documentActionUrl(path, origin) {
  const url = new URL(path, origin);
  if (url.origin !== origin) return null;
  const supported =
    /^\/api\/(?:school\/(?:class-diaries\/(?:preview|export)|diaries\/(?:export|[\w-]+\/preview)|family\/preview|reports\/export)|templates\/homework-preview|class-diary\/preview|diaries\/[\w-]+\/(?:export|print)|export|reports)$/.test(
      url.pathname,
    );
  const format = url.pathname.endsWith('/print') ? 'print' : url.searchParams.get('format');
  if (!supported || !['pdf', 'png', 'jpg', 'print'].includes(format)) return null;
  url.searchParams.set('format', format);
  return url;
}
export function saveDocumentBlob(blob, filename, { doc = document, win = window } = {}) {
  if (!blob?.size) throw Error('The generated diary is empty. Please try again.');
  // Android receives the actual Blob, without fetching a blob: URL through WebView/CSP.
  if (
    win.location?.origin === 'https://diary.elitescholars.edu.pk' &&
    typeof win.EliteNative?.saveFile === 'function'
  ) {
    if (blob.size > 20 * 1024 * 1024)
      throw Error('This export exceeds the Android app’s 20 MB limit. Try a shorter date range.');
    if (!['application/pdf', 'image/png', 'image/jpeg', 'application/zip'].includes(blob.type))
      throw Error('Unsupported diary export type.');
    if (blob.type === 'application/zip' && win.EliteNative.supportsArchiveDownloads?.() !== true)
      throw Error(
        'Update the Android app to download ZIP archives, or open the school diary in Chrome.',
      );
    return new Promise((resolve, reject) => {
      const reader = new win.FileReader();
      reader.onload = () => {
        try {
          const encoded = String(reader.result).split(',')[1];
          if (!encoded) throw Error('The diary file could not be read.');
          if (typeof win.EliteNative.saveFileWithResult !== 'function') {
            win.EliteNative.saveFile(filename, blob.type, encoded);
            resolve();
            return;
          }
          const receiver = win.top?.location?.origin === win.location.origin ? win.top : win,
            id = win.crypto.randomUUID();
          let timer;
          const cleanup = () => {
            win.clearTimeout(timer);
            receiver.removeEventListener('elite-native-save', completed);
          };
          const completed = (event) => {
            if (event.detail?.id !== id) return;
            cleanup();
            event.detail.ok
              ? resolve()
              : reject(Error(event.detail.error || 'The diary could not be saved.'));
          };
          receiver.addEventListener('elite-native-save', completed);
          timer = win.setTimeout(() => {
            cleanup();
            reject(Error('Saving timed out. Check the Android file picker before trying again.'));
          }, 180000);
          try {
            win.EliteNative.saveFileWithResult(filename, blob.type, encoded, id);
          } catch (error) {
            cleanup();
            reject(error);
          }
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(Error('The diary file could not be read. Please try again.'));
      reader.onabort = () => reject(Error('Diary download was cancelled.'));
      reader.readAsDataURL(blob);
    });
  }

  const href = win.URL.createObjectURL(blob),
    link = doc.createElement('a');
  link.href = href;
  link.download = filename;
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  // Keep the URL alive long enough for Android's download manager to consume it.
  win.setTimeout(() => win.URL.revokeObjectURL(href), 60000);
}
export function createDocumentActions({
  win = window,
  doc = win.document,
  notify = () => {},
  timeoutMs = 120000,
  bulkTimeoutMs = 600000,
  save = saveDocumentBlob,
} = {}) {
  let active;
  function run(path, trigger) {
    if (active) return active;
    const url = documentActionUrl(path, win.location.origin);
    if (!url) return Promise.reject(Error('This document action is not supported.'));
    const kind = url.searchParams.get('format'),
      id = win.crypto.randomUUID();
    url.searchParams.set('__diary_action', id);
    const frame = doc.createElement('iframe');
    frame.title = 'Preparing diary ' + kind;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // A real layout viewport is necessary for pagination and image rendering. It stays off screen.
    Object.assign(frame.style, {
      position: 'fixed',
      left: '-20000px',
      top: '0',
      width: '1280px',
      height: '1000px',
      border: '0',
      pointerEvents: 'none',
    });
    const label = trigger?.innerHTML,
      wasDisabled = trigger?.disabled,
      wasAria = trigger?.getAttribute('aria-disabled');
    if (trigger) {
      trigger.setAttribute('aria-disabled', 'true');
      if ('disabled' in trigger) trigger.disabled = true;
    }
    notify(
      kind === 'print' ? 'Preparing diary for printing…' : 'Preparing ' + kind.toUpperCase() + '…',
    );
    let timer,
      printTimer,
      printing = false,
      saving = false,
      settled = false,
      resolve,
      reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    active = promise;
    const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      },
      fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : Error(String(error)));
      };
    async function onMessage(event) {
      if (settled) return;
      const message = event.data;
      if (
        event.origin !== win.location.origin ||
        event.source !== frame.contentWindow ||
        message?.channel !== 'elite-diary-export' ||
        message.id !== id
      )
        return;
      if (message.type === 'error') return fail(message.error || 'Diary export failed.');
      if (message.type === 'progress') return notify(message.text);
      if (message.type === 'ready' && kind === 'print' && !printing) {
        printing = true;
        win.clearTimeout(timer);
        try {
          if (typeof frame.contentWindow.print !== 'function')
            throw Error('Printing is unavailable in this browser. Download the PDF to print it.');
          frame.contentWindow.addEventListener('afterprint', () => finish({ format: 'print' }), {
            once: true,
          });
          printTimer = win.setTimeout(() => finish({ format: 'print' }), 60000);
          notify('Print dialog opened.');
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (error) {
          fail(error);
        }
      }
      if (message.type === 'result' && kind !== 'print' && !saving) {
        saving = true;
        try {
          await save(message.blob, message.filename, { doc, win });
          notify((message.archive ? 'ZIP' : kind.toUpperCase()) + ' download started.');
          finish({ format: kind, filename: message.filename, pages: message.pages });
        } catch (error) {
          fail(error);
        }
      }
    }
    frame.onload = () => {
      try {
        const content = frame.contentDocument;
        if (content?.contentType?.includes('json')) {
          let error;
          try {
            error = JSON.parse(content.body.textContent).error;
          } catch {}
          fail(error || 'Diary could not be loaded. Sign in and try again.');
        } else if (content && !content.querySelector('#pages'))
          fail('Diary could not be loaded. Sign in and try again.');
      } catch {
        fail('The diary could not be accessed. Please sign in and try again.');
      }
    };
    frame.onerror = () =>
      fail('The diary could not be loaded. Check your connection and try again.');
    win.addEventListener('message', onMessage);
    timer = win.setTimeout(
      () => fail('Diary rendering timed out. Please try again, or use a shorter date range.'),
      /\/(?:class-diaries|diaries)\/export$/.test(url.pathname) ? bulkTimeoutMs : timeoutMs,
    );
    frame.src = url.href;
    doc.body.append(frame);
    const cleanup = () => {
      win.clearTimeout(timer);
      win.clearTimeout(printTimer);
      win.removeEventListener('message', onMessage);
      frame.remove();
      active = null;
      if (trigger) {
        trigger.innerHTML = label;
        if ('disabled' in trigger) trigger.disabled = wasDisabled;
        if (wasAria === null) trigger.removeAttribute('aria-disabled');
        else trigger.setAttribute('aria-disabled', wasAria);
      }
    };
    promise.then(cleanup, cleanup);
    return promise;
  }
  return {
    run,
    get busy() {
      return !!active;
    },
  };
}
export function installDocumentActions({ doc = document, win = window, notify = () => {} } = {}) {
  if (installed.has(doc)) return installed.get(doc);
  const actions = createDocumentActions({ doc, win, notify });
  doc.addEventListener(
    'click',
    (event) => {
      const link = event.target.closest?.('a[href]');
      if (
        !link ||
        event.defaultPrevented ||
        event.button > 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !documentActionUrl(link.href, win.location.origin)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      actions
        .run(link.href, link)
        .catch((error) => notify('Could not export diary: ' + error.message));
    },
    true,
  );
  installed.set(doc, actions);
  return actions;
}
