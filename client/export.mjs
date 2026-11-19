import { renderDiaryArchive } from './archive.mjs';
import { toPng, toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { saveDocumentBlob } from '../public/diary-actions.js';
import { documentFilename } from '../public/document-filename.js';

export function waitForDocument(win, timeoutMs = 45000) {
  if (win.documentError) return Promise.reject(Error(win.documentError));
  if (win.documentReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ready = () => {
      win.clearTimeout(timer);
      win.removeEventListener('documentready', ready);
      win.documentError ? reject(Error(win.documentError)) : resolve();
    };
    const timer = win.setTimeout(() => {
      win.removeEventListener('documentready', ready);
      reject(Error(win.documentError || 'Diary layout timed out.'));
    }, timeoutMs);
    win.addEventListener('documentready', ready, { once: true });
  });
}
export async function renderDocumentBlob(
  doc,
  kind,
  {
    rasterPng = toPng,
    rasterJpeg = toJpeg,
    PDF = jsPDF,
    onProgress = () => {},
    loadImage,
    canvasFactory,
  } = {},
) {
  if (!['pdf', 'png', 'jpg'].includes(kind)) throw Error('Choose PDF, PNG or JPG.');
  const pages = [...doc.querySelectorAll('#pages > .page')];
  if (!pages.length) throw Error('The diary has no printable pages.');
  for (const page of pages)
    if (page.dataset?.consolidated === 'true' && page.dataset.fitStatus !== 'complete')
      throw Error('The consolidated diary has not passed the one-page layout check.');
  let pdf,
    canvas,
    context,
    offset = 0;
  const width = Math.max(...pages.map((p) => p.offsetWidth)),
    height = pages.reduce((sum, p) => sum + p.offsetHeight, 0);
  if (!width || !height) throw Error('The diary layout is not ready. Please try again.');
  // A single PNG/JPG contains every page. Bound canvas dimensions for mobile browsers.
  const ratio =
    kind === 'pdf'
      ? Math.min(
          2,
          4096 / Math.max(...pages.map((p) => Math.max(p.offsetWidth, p.offsetHeight))),
          Math.sqrt(8000000 / Math.max(...pages.map((p) => p.offsetWidth * p.offsetHeight))),
        )
      : Math.min(2, 16384 / Math.max(width, height), Math.sqrt(24000000 / (width * height)));
  if (kind !== 'pdf') {
    canvas = canvasFactory ? canvasFactory() : doc.createElement('canvas');
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    context = canvas.getContext('2d');
    if (!context) throw Error('Image export is unavailable in this browser. Try PDF instead.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const decode =
    loadImage ||
    ((url) =>
      new Promise((resolve, reject) => {
        const image = new doc.defaultView.Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(Error('A diary image could not be rendered.'));
        image.src = url;
      }));
  for (let i = 0; i < pages.length; i++) {
    onProgress(`Rendering page ${i + 1} of ${pages.length}…`);
    const page = pages[i];
    const image = await (kind === 'jpg' ? rasterJpeg : rasterPng)(page, {
      pixelRatio: ratio,
      backgroundColor: doc.defaultView.getComputedStyle(page).backgroundColor || '#ffffff',
      quality: 0.96,
      cacheBust: false,
      skipFonts: false,
      style: { margin: '0', boxShadow: 'none', zoom: '1' },
    });
    if (kind === 'pdf') {
      const landscape = page.offsetWidth > page.offsetHeight,
        orientation = landscape ? 'landscape' : 'portrait';
      if (!pdf) pdf = new PDF({ unit: 'mm', format: 'a4', orientation, compress: true });
      else pdf.addPage('a4', orientation);
      pdf.addImage(
        image,
        'PNG',
        0,
        0,
        landscape ? 297 : 210,
        landscape ? 210 : 297,
        undefined,
        'FAST',
      );
    } else {
      const decoded = await decode(image);
      const y = Math.round(offset * ratio),
        next = Math.round((offset + page.offsetHeight) * ratio);
      context.drawImage(decoded, 0, y, Math.round(page.offsetWidth * ratio), next - y);
      offset += page.offsetHeight;
    }
  }
  const blob =
    kind === 'pdf'
      ? pdf.output('blob')
      : await new Promise((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value?.size
                ? resolve(value)
                : reject(Error('The image could not be saved. Try PDF for a long diary.')),
            kind === 'jpg' ? 'image/jpeg' : 'image/png',
            0.96,
          ),
        );
  if (!blob?.size) throw Error('The generated diary is empty.');
  return { blob, filename: documentFilename(doc) + '.' + kind, pages: pages.length };
}
export function renderExportBlob(doc, kind, options = {}) {
  if (doc.body.dataset.exportArchive !== 'zip') return renderDocumentBlob(doc, kind, options);
  const native = doc.defaultView?.EliteNative;
  if (native?.saveFile && native.supportsArchiveDownloads?.() !== true)
    throw Error(
      'Update the Android app to download ZIP archives, or open the school diary in Chrome.',
    );
  return renderDiaryArchive(doc, kind, {
    renderPage: renderDocumentBlob,
    ...options,
    ...(native ? { maxBytes: 19 * 1024 * 1024 } : {}),
  });
}
// A document preview already contains the exact rendered version to export.
// Render it in place: another frame would reload data and is blocked by document CSP.
export function createPreviewActions({
  win,
  doc = win.document,
  notify = () => {},
  render = renderExportBlob,
  save = saveDocumentBlob,
} = {}) {
  let active;
  const controls = () => [
    ...doc.querySelectorAll('[data-document-format],#download-document,#print-document'),
  ];
  function run(kind) {
    if (active) return active;
    if (!['pdf', 'png', 'jpg', 'print'].includes(kind))
      return Promise.reject(Error('Choose PDF, PNG, JPG or Print.'));
    const buttons = controls().map((button) => ({ button, disabled: button.disabled }));
    buttons.forEach(({ button }) => {
      button.disabled = true;
    });
    active = (async () => {
      if (doc.body.dataset.exportAllowed !== 'true') throw Error('Export permission required.');
      await waitForDocument(win);
      if (kind === 'print') {
        if (typeof win.print !== 'function')
          throw Error('Printing is unavailable in this browser. Download the PDF to print it.');
        await new Promise((resolve, reject) => {
          let timer;
          const done = () => {
            win.clearTimeout(timer);
            win.removeEventListener('afterprint', done);
            resolve();
          };
          win.addEventListener('afterprint', done, { once: true });
          timer = win.setTimeout(done, 60000);
          try {
            win.focus();
            win.print();
          } catch (error) {
            win.clearTimeout(timer);
            win.removeEventListener('afterprint', done);
            reject(error);
          }
        });
        return { format: kind };
      }
      notify('Preparing ' + kind.toUpperCase() + '…');
      const result = await render(doc, kind, { onProgress: notify });
      await save(result.blob, result.filename, { doc, win });
      notify((result.archive ? 'ZIP' : kind.toUpperCase()) + ' download started.');
      return { format: kind, ...result };
    })();
    const cleanup = () => {
      buttons.forEach(({ button, disabled }) => {
        button.disabled = disabled;
      });
      active = null;
    };
    active.then(cleanup, cleanup);
    return active;
  }
  return {
    run,
    get busy() {
      return !!active;
    },
  };
}
const initialized = new WeakMap();
export function initExportDocument(win = window, doc = win.document) {
  if (initialized.has(doc)) return initialized.get(doc);
  const status = doc.getElementById('export-status'),
    notify = (text) => {
      if (status) status.textContent = text;
    },
    showError = (error) => {
      doc.body.dataset.exportResult = 'error';
      notify('Could not export: ' + error.message);
    };
  const actions = createPreviewActions({ win, doc, notify });
  initialized.set(doc, actions);
  for (const button of doc.querySelectorAll(
    '[data-document-format],#download-document,#print-document',
  )) {
    const kind =
      button.dataset.documentFormat ||
      (button.id === 'print-document' ? 'print' : doc.body.dataset.exportFormat);
    button.addEventListener('click', () => actions.run(kind).catch(showError));
  }
  const query = new URL(win.location.href).searchParams,
    id = query.get('__diary_action');
  if (id && win.parent !== win) {
    doc.querySelector('.toolbar')?.setAttribute('hidden', '');
    const post = (payload) =>
      win.parent.postMessage(
        { channel: 'elite-diary-export', id, ...payload },
        win.location.origin,
      );
    waitForDocument(win)
      .then(async () => {
        if (doc.body.dataset.exportAllowed !== 'true') throw Error('Export permission required.');
        const kind = query.get('format');
        if (kind === 'print') {
          post({ type: 'ready' });
          return;
        }
        if (kind !== doc.body.dataset.exportFormat)
          throw Error('The diary export format does not match the request.');
        const result = await renderExportBlob(doc, kind, {
          onProgress: (text) => post({ type: 'progress', text }),
        });
        doc.body.dataset.exportResult = 'complete';
        doc.body.dataset.exportBytes = String(result.blob.size);
        doc.body.dataset.exportPages = String(result.pages);
        post({ type: 'result', ...result });
      })
      .catch((error) => {
        showError(error);
        post({ type: 'error', error: error.message });
      });
  }
  return actions;
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') initExportDocument();
