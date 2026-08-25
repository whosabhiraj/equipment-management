-- 0000_init_schema.sql
-- Create users table
CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `name` text NOT NULL,
  `image` text,
  `email_verified` integer DEFAULT 0 NOT NULL,
  `role` text DEFAULT 'resident' NOT NULL,
  `room_no` text,
  `disabled` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);

-- Create sessions table
CREATE TABLE `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `token` text NOT NULL,
  `expires_at` integer NOT NULL,
  `ip_address` text,
  `user_agent` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);

-- Create accounts table
CREATE TABLE `accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `account_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `access_token` text,
  `refresh_token` text,
  `expires_at` integer,
  `password` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);

-- Create categories table
CREATE TABLE `categories` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL
);

-- Create items table
CREATE TABLE `items` (
  `id` text PRIMARY KEY NOT NULL,
  `category_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `image_url` text,
  `quantity` integer DEFAULT 1 NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `requires_approval` integer DEFAULT 1 NOT NULL,
  `max_slots_per_booking` integer DEFAULT 2 NOT NULL,
  `earliest_slot` integer DEFAULT 0 NOT NULL,
  `latest_slot` integer DEFAULT 17 NOT NULL,
  `advance_days` integer DEFAULT 7 NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`)
);

-- Create bookings table
CREATE TABLE `bookings` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL,
  `slot_date` text NOT NULL,
  `slot_index` integer NOT NULL,
  `user_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `note` text,
  `decided_by` text,
  `decided_at` integer,
  `decline_reason` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`)
);
CREATE UNIQUE INDEX `idx_bookings_item_slot_user` ON `bookings` (`item_id`, `slot_date`, `slot_index`, `user_id`) WHERE `status` IN ('pending', 'approved');
CREATE INDEX `idx_bookings_lookup` ON `bookings` (`item_id`, `slot_date`, `slot_index`, `status`);

-- Create blackouts table
CREATE TABLE `blackouts` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text,
  `slot_date` text NOT NULL,
  `slot_index` integer,
  `reason` text NOT NULL,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);

-- Create audit_log table
CREATE TABLE `audit_log` (
  `id` text PRIMARY KEY NOT NULL,
  `actor_id` text NOT NULL,
  `action` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `meta_json` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`)
);
