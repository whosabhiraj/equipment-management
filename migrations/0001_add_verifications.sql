-- 0001_add_verifications.sql
-- Better Auth stores the OAuth state and PKCE code verifier here between the
-- redirect to Google and the callback. Missing in 0000, so sign-in 500s.
CREATE TABLE `verifications` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE INDEX `idx_verifications_identifier` ON `verifications` (`identifier`);
