// Serves static files from memory: read once, compressed once (Brotli/gzip), revalidated with an ETag.
// Files are re-read automatically when they change on disk.
import { readFileSync, statSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';

const COMPRESSIBLE = /\.(js|css|html|webmanifest|svg|txt)$/;
const MIN_COMPRESS_BYTES = 1024;

export function createStaticCache(dir) {
  const files = new Map();
  return function load(file, acceptEncoding = '') {
    const url = new URL(file, dir),
      modified = statSync(url).mtimeMs;
    let entry = files.get(file);
    if (!entry || entry.modified !== modified) {
      const raw = readFileSync(url);
      entry = {
        modified,
        raw,
        hash: createHash('sha1').update(raw).digest('base64url').slice(0, 22),
        encoded: {},
      };
      files.set(file, entry);
    }
    const encoding =
      COMPRESSIBLE.test(file) && entry.raw.length >= MIN_COMPRESS_BYTES
        ? /\bbr\b/.test(acceptEncoding)
          ? 'br'
          : /\bgzip\b/.test(acceptEncoding)
            ? 'gzip'
            : ''
        : '';
    if (encoding)
      entry.encoded[encoding] ||=
        encoding === 'br'
          ? brotliCompressSync(entry.raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
          : gzipSync(entry.raw);
    return {
      body: encoding ? entry.encoded[encoding] : entry.raw,
      encoding,
      etag: `"${entry.hash}${encoding ? '-' + encoding : ''}"`,
    };
  };
}
