import { passwordAcceptable } from '../shared/passwords.mjs';
import { createUser, one, db } from '../server/db.mjs';
const email = process.env.ADMIN_EMAIL,
  name = process.env.ADMIN_NAME,
  password = process.env.ADMIN_PASSWORD;
if (!email || !name || !password || !passwordAcceptable(password)) {
  console.error(
    'Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD (6 or more characters) in the environment. Never place credentials in source control.',
  );
  process.exit(1);
}
if (one("SELECT 1 FROM users WHERE role='super_admin'")) {
  console.error('A Super Admin already exists. Use account management.');
  process.exit(1);
}
createUser({ email, name, password, role: 'super_admin' });
db.close();
console.log('Super Admin created. Sign in at the app URL.');
