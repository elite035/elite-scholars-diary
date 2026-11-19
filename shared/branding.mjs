import { createHash } from 'node:crypto';
import { clientSettings } from './client-settings.mjs';
export async function captureSchool(db) {
  const school = clientSettings(db.settings(), { administrator: true });
  if (typeof school.logo === 'string' && school.logo.startsWith('data:image/')) {
    const id = createHash('sha256').update(school.logo).digest('hex');
    await db.run('INSERT OR IGNORE INTO branding_assets VALUES(?,?,?)', id, school.logo, db.now());
    school.logo_asset_id = id;
    school.logo = '';
  }
  if (!school.logo && !school.logo_asset_id) school.logo = '/assets/official-school-logo.jpeg';
  return school;
}
export async function hydrateSchool(db, snapshot) {
  if (!snapshot.logo_asset_id) return snapshot; // Original immutable snapshots stay readable.
  const asset = await db.one('SELECT data FROM branding_assets WHERE id=?', snapshot.logo_asset_id);
  if (!asset)
    throw Object.assign(
      Error(
        'The saved diary branding is unavailable. Restore its immutable asset before exporting.',
      ),
      { status: 503 },
    );
  return { ...snapshot, logo: asset.data };
}
