import { randomBytes } from 'node:crypto';
export const maxBackupPlaintextBytes = 256 * 1024 * 1024;
export const backupLimit = (value) =>
  Math.min(value ?? maxBackupPlaintextBytes, maxBackupPlaintextBytes);
function tooLarge() {
  throw Object.assign(
    Error(
      'Backup exceeds the bounded 256 MB recovery limit; use an operator archive before continuing',
    ),
    { status: 413 },
  );
}
export function encodeBackupPayload(payload, { maxBytes } = {}) {
  const text = JSON.stringify(payload),
    size = Buffer.byteLength(text);
  if (size > backupLimit(maxBytes)) tooLarge();
  // Historical snapshots repeat immutable data-URI branding. Store each large image once.
  // Substitution operates on JSON text so original database strings restore byte-for-byte.
  let prefix;
  do {
    prefix = '__ESS_ASSET_' + randomBytes(16).toString('hex') + '_';
  } while (text.includes(prefix));
  const ids = new Map(),
    assets = [];
  let matches = 0;
  const compact = text.replace(
    /data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]{4096,}/g,
    (value) => {
      matches++;
      if (!ids.has(value)) {
        ids.set(value, assets.length);
        assets.push(value);
      }
      return prefix + ids.get(value) + '__';
    },
  );
  if (matches > assets.length) {
    const packed = Buffer.from(
      JSON.stringify({
        format: 'elite-scholars-packed-backup',
        version: 2,
        prefix,
        assets,
        payload: compact,
      }),
    );
    if (packed.length < size) return { magic: 'ESSB2', plaintext: packed };
  }
  return { magic: 'ESSB1', plaintext: Buffer.from(text) };
}
export function decodeBackupPayload(bytes, magic, { maxBytes } = {}) {
  if (bytes.length > backupLimit(maxBytes)) tooLarge();
  if (magic === 'ESSB1') return JSON.parse(bytes);
  if (magic !== 'ESSB2') throw Error('Unknown backup format');
  const packed = JSON.parse(bytes);
  if (
    packed.format !== 'elite-scholars-packed-backup' ||
    packed.version !== 2 ||
    typeof packed.payload !== 'string' ||
    !/^__ESS_ASSET_[a-f0-9]{32}_$/.test(packed.prefix) ||
    !Array.isArray(packed.assets) ||
    packed.assets.length > 10000 ||
    !packed.assets.every(
      (asset) =>
        typeof asset === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(asset),
    )
  )
    throw Error('Invalid packed backup');
  let size = Buffer.byteLength(packed.payload);
  const text = packed.payload.replace(
    new RegExp(packed.prefix + '(\\d+)__', 'g'),
    (marker, index) => {
      const asset = packed.assets[Number(index)];
      if (asset === undefined) throw Error('Invalid backup image reference');
      size += Buffer.byteLength(asset) - Buffer.byteLength(marker);
      if (size > backupLimit(maxBytes)) tooLarge();
      return asset;
    },
  );
  if (Buffer.byteLength(text) > backupLimit(maxBytes)) tooLarge();
  return JSON.parse(text);
}
