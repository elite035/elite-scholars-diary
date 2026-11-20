// Columns of `users` that may be loaded into request handlers. The password hash is deliberately
// absent: it is read only by the two places that verify a password (sign-in and password change).
export const USER_COLUMNS = 'id,name,email,role,permissions,active,created_at,updated_at';
export const USER_COLUMNS_WITH_HASH = USER_COLUMNS + ',password';
