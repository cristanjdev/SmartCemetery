-- Level 1 database tightening: real ENUM columns, DATE-only birth/death/burial
-- dates, CHECK constraints, a phonetic FULLTEXT index and a requests index.
-- Data-preserving. Values are trimmed/lower-cased first so legacy rows convert
-- cleanly; any genuinely unknown value still fails loudly rather than being
-- silently rewritten.

-- ─── Normalise legacy values before the ENUM conversion ──────
UPDATE `users`               SET `status` = LOWER(TRIM(`status`));
UPDATE `plots`               SET `status` = LOWER(TRIM(`status`));
UPDATE `graves`              SET `status` = LOWER(TRIM(`status`)),
                                 `verification_status` = LOWER(TRIM(`verification_status`));
UPDATE `requests`            SET `type` = LOWER(TRIM(`type`)),
                                 `status` = LOWER(TRIM(`status`));
UPDATE `notifications`       SET `outcome` = LOWER(TRIM(`outcome`)),
                                 `category` = LOWER(TRIM(`category`)),
                                 `email_status` = LOWER(TRIM(`email_status`));
UPDATE `broadcast_deliveries` SET `email_status` = LOWER(TRIM(`email_status`));
UPDATE `broadcasts`          SET `status` = LOWER(TRIM(`status`));
UPDATE `navigations`         SET `channel` = LOWER(TRIM(`channel`)),
                                 `outcome` = LOWER(TRIM(`outcome`));
UPDATE `archival_runs`       SET `source` = LOWER(TRIM(`source`)),
                                 `status` = LOWER(TRIM(`status`));

-- ─── Columns: ENUM, DATE, phonetic key ───────────────────────
-- AlterTable
ALTER TABLE `archival_runs` MODIFY `source` ENUM('admin', 'cron') NOT NULL,
    MODIFY `status` ENUM('running', 'success', 'failed') NOT NULL DEFAULT 'running';

-- AlterTable
ALTER TABLE `broadcast_deliveries` MODIFY `email_status` ENUM('none', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE `broadcasts` MODIFY `audience` ENUM('All', 'Admin', 'Staff', 'Client') NOT NULL,
    MODIFY `status` ENUM('processing', 'sent', 'failed', 'partial') NOT NULL DEFAULT 'processing';

-- AlterTable (DATETIME -> DATE keeps the stored UTC calendar day)
ALTER TABLE `graves` ADD COLUMN `name_phonetic` VARCHAR(500) NOT NULL DEFAULT '',
    MODIFY `burial_date` DATE NULL,
    MODIFY `status` ENUM('active', 'archived') NOT NULL DEFAULT 'active',
    MODIFY `verification_status` ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
    MODIFY `birth_date` DATE NULL,
    MODIFY `death_date` DATE NULL;

-- AlterTable
ALTER TABLE `navigations` MODIFY `channel` ENUM('dashboard', 'kiosk', 'public') NOT NULL DEFAULT 'dashboard',
    MODIFY `outcome` ENUM('success', 'failed') NOT NULL DEFAULT 'success';

-- AlterTable
ALTER TABLE `notifications` MODIFY `outcome` ENUM('approved', 'rejected') NULL,
    MODIFY `email_status` ENUM('none', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'none',
    MODIFY `category` ENUM('request_outcome', 'broadcast') NOT NULL DEFAULT 'request_outcome';

-- AlterTable
ALTER TABLE `plots` MODIFY `status` ENUM('available', 'occupied', 'reserved', 'maintenance') NOT NULL DEFAULT 'available';

-- AlterTable
ALTER TABLE `requests` MODIFY `type` ENUM('reservation', 'record_update', 'inquiry') NOT NULL,
    MODIFY `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE `users` MODIFY `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active';

-- ─── Indexes ─────────────────────────────────────────────────
-- Phonetic "did you mean" search runs inside the database. Rows are populated
-- by `npm run db:backfill-phonetic` (run automatically by db:migrate/db:setup)
-- and kept current by the grave create/update routes.
CREATE FULLTEXT INDEX `graves_name_phonetic_idx` ON `graves`(`name_phonetic`);

CREATE INDEX `requests_status_created_at_idx` ON `requests`(`status`, `created_at`);

-- ─── CHECK constraints (not expressible in the Prisma schema) ─
ALTER TABLE `graves`
    ADD CONSTRAINT `chk_graves_tier` CHECK (`tier` >= 1);

ALTER TABLE `plots`
    ADD CONSTRAINT `chk_plots_total_tiers` CHECK (`total_tiers` >= 1),
    ADD CONSTRAINT `chk_plots_gps` CHECK (
        (`gps_lat` IS NULL OR `gps_lat` BETWEEN -90 AND 90)
        AND (`gps_lng` IS NULL OR `gps_lng` BETWEEN -180 AND 180)
    );

ALTER TABLE `locations`
    ADD CONSTRAINT `chk_locations_gps` CHECK (
        (`gps_lat` IS NULL OR `gps_lat` BETWEEN -90 AND 90)
        AND (`gps_lng` IS NULL OR `gps_lng` BETWEEN -180 AND 180)
    );

ALTER TABLE `location_details`
    ADD CONSTRAINT `chk_location_details_capacity` CHECK (`capacity` >= 0);

ALTER TABLE `plot_photos`
    ADD CONSTRAINT `chk_plot_photos_tier` CHECK (`tier` >= 0);

ALTER TABLE `feedback`
    ADD CONSTRAINT `chk_feedback_rating` CHECK (`rating` BETWEEN 1 AND 5);

ALTER TABLE `navigations`
    ADD CONSTRAINT `chk_navigations_distance` CHECK (`distance_meters` IS NULL OR `distance_meters` >= 0),
    ADD CONSTRAINT `chk_navigations_duration` CHECK (`duration_seconds` IS NULL OR `duration_seconds` >= 0);
