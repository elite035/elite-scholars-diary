import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export async function passwordHashAsync(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64)).toString('hex');
}
export async function passwordValidAsync(password, stored) {
  try {
    const [salt, key] = stored.split(':');
    if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(key)) return false;
    const actual = await derive(password, salt, 64);
    return timingSafeEqual(actual, Buffer.from(key, 'hex'));
  } catch {
    return false;
  }
}

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;
export const PASSWORD_MESSAGE = `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters (letters, digits or symbols).`;
export const passwordAcceptable = (value) =>
  typeof value === 'string' && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
