-- 0002_account_oauth_columns.sql
-- Better Auth writes id_token, scope and both token expiry columns when it links
-- a social account. They were missing from 0000, so every Google sign-in failed
-- with "unable to link account".
ALTER TABLE `accounts` ADD COLUMN `id_token` text;
ALTER TABLE `accounts` ADD COLUMN `access_token_expires_at` integer;
ALTER TABLE `accounts` ADD COLUMN `refresh_token_expires_at` integer;
ALTER TABLE `accounts` ADD COLUMN `scope` text;
