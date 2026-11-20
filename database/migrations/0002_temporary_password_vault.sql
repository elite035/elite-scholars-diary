-- Encrypted copy of an administrator-issued temporary password; cleared when the user changes it.
ALTER TABLE elite_diary.account_security ADD COLUMN IF NOT EXISTS password_enc TEXT;
