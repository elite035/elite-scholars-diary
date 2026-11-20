import { passwordAcceptable } from '../shared/passwords.mjs';
import { createUser, one, db, transaction } from '../cloud/db.mjs';
const { ADMIN_EMAIL: email, ADMIN_NAME: name, ADMIN_PASSWORD: password } = process.env;
if (!email || !name || !password || !passwordAcceptable(password)) {
  console.error(
    'Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD (6 or more characters) in a private environment file.',
  );
  process.exitCode = 1;
} else
  try {
    await transaction(async () => {
      if (await one("SELECT 1 FROM users WHERE role='super_admin'"))
        throw Error('A Super Admin already exists. Use account management.');
      await createUser({ email, name, password, role: 'super_admin' });
    });
    console.log('Cloud Super Admin created. Sign in at the deployed app URL.');
  } catch {
    console.error(
      'Cloud bootstrap failed. Check the database connection, migration and whether a Super Admin already exists.',
    );
    process.exitCode = 1;
  } finally {
    await db.close();
  }
