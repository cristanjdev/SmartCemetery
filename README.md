# Smart Cemetery Navigation and Monitoring Platform

Digitalizing burial records with multi-platform access, interactive map navigation, smart monitoring, and secure record management for **Bolonsori Public Cemetery**.

The platform replaces manual, paper-based cemetery record-keeping with a centralized, searchable system. Visitors can locate graves through an interactive map guide without staff assistance, while staff and administrators manage burial records, monitor plot availability, process requests, and generate reports through role-based dashboards secured with authentication, encryption, and audit logging.

> Aligned with **SDG 9 — Industry, Innovation, and Infrastructure** through the digital transformation of civic cemetery infrastructure.

## Overview

Cemetery record-keeping is commonly handled through physical logbooks, aging maps, and memory-based tracking, which leads to misplaced documents, inaccurate data, and difficulty locating graves — especially during peak periods such as All Saints' and All Souls' Days. This platform addresses those problems by providing:

- A centralized, searchable database of burial records (deceased name, burial date, plot number).
- An interactive visual map guide with highlighted grave markers, section/plot identifiers, and route cues.
- Smart monitoring of plot status and operational activity.
- Multi-platform access across web, mobile, and on-site kiosks.
- Secure, role-based data management with a defined records lifecycle.

## Roles and Capabilities

| Role | Capabilities |
| --- | --- |
| **Admin** | Manage cemetery layout, update grave records, approve or reject requests, send notifications, generate and export reports, manage users, oversee data security and verification. |
| **Staff** | Update and verify burial records, monitor plots, respond to record and verification needs. |
| **Client / Visitor** | Search graves, view the interactive map guide with directions, submit requests, track request status, and provide feedback. |

## Key Features

- **Searchable directory** with exact and phonetic ("fuzzy") matching by name, grave ID, or year of burial.
- **Interactive map** built on the Google Maps API with plot markers, section/plot identifiers, and pedestrian route overlays.
- **Kiosk mode** for on-site self-service navigation.
- **Role-based dashboards** for records, plots, locations, requests, verification, broadcasts, notifications, reports, and a **User Log** (who signed in and what each user changed, with IP and time; admin only). The Analytics page is hidden from the menus but its code is kept.
- **Reports and exports** in CSV, PDF, and XLSX formats.
- **Notifications and broadcasts** with optional email delivery.
- **Records lifecycle policy**: records remain active for a defined retention period, then transition to a protected archive (never deleted) while staying searchable for authorized users.
- **Security controls**: authentication, role-based access control, field-level encryption for sensitive details, rate limiting, and audit logging.
- **Light and dark themes** across public and authenticated interfaces.

## Technology Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js (App Router) with React |
| Language | JavaScript |
| Styling | CSS design system (dark/light theming via CSS variables) |
| Authentication | NextAuth |
| Database | MySQL |
| ORM | Prisma |
| Mapping | Google Maps API (`@react-google-maps/api`) |
| Charts | Recharts |
| Notifications | Sonner (toasts), Nodemailer (email) |
| Testing | Vitest (unit/integration), Playwright (end-to-end) |

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A running MySQL instance (e.g., XAMPP or Laragon for local development)
- A Google Maps API key

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the template and fill in your values:

```bash
cp .env.example .env.local
```

Environment variables are documented in `.env.example` (database connection, authentication secret, Google Maps API key, map center, mail settings, and seed accounts). Never commit real secrets — `.env` and `.env.local` are ignored by Git.

### 3. Set up the database

One command finds your local MySQL/MariaDB (XAMPP, MySQL Server, Docker, ports 3306-3310), creates the database, saves the connection and development secrets to `.env.local`, applies migrations, seeds the user accounts and builds the search index. You do not need to create `.env.local` or the database first; just start MySQL. On a **local** database it also loads sample data and the layout preset; against any other database those are opt-in (`SEED_DEMO_DATA=yes`, `SEED_LAYOUT_PRESET=yes`):

```bash
npm run db:setup
```

It only asks questions when it has to (for example, when the server rejects the default `root` login with no password). It is safe to run again. Options:

```bash
npm run db:setup -- --port=3307 --user=root --password=secret --db=cemetery_map
npm run db:setup -- --url="mysql://user:pass@127.0.0.1:3306/cemetery_map"
npm run db:setup -- --no-demo   # users only, no sample burial records
npm run db:setup -- --yes       # never prompt; print a hint instead
```

Requires MySQL 8.0.16+ or MariaDB 10.2+ (older MySQL works but does not enforce CHECK constraints).

Individual steps are also available:

```bash
npm run db:migrate      # apply migrations
npm run db:generate     # generate Prisma client
npm run db:seed         # seed user accounts (+ demo data / layout preset when enabled)
npm run db:backfill-phonetic  # (re)build the phonetic search index for existing records
npm run db:inspect      # read-only summary of locations, rows, plots and tiers
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm run start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit and integration tests (Vitest) |
| `npm run test:e2e` | Run end-to-end tests (Playwright) |
| `npm run db:setup` | Detect the local DB, create it, save `.env.local`, migrate, seed, build the search index |
| `npm run db:backfill-phonetic` | Rebuild the phonetic search index (`-- --all` recomputes every row) |
| `npm run db:inspect` | Read-only summary of the layout in the database |
| `npm run db:backfill-tiers` | Move legacy tier/photo data into real columns (dry run; add `-- --apply` to write) |
| `npm run db:cleanup-demo` | Remove duplicate demo sections left by older seed runs (dry run; add `-- --apply` to delete) |
| `npm run db:rotate-encryption` | Rotate the encryption key for sensitive fields |

## Project Structure

```text
src/
  app/                 # App Router routes (public, dashboard, API handlers)
    api/               # Route handlers (graves, plots, reports, auth, etc.)
    dashboard/         # Authenticated role-based dashboards
    login/  search/    # Public authentication and directory search
  components/          # Shared UI, dashboard shell, map, and primitives
  lib/                 # Business logic (auth, search, encryption, analytics)
prisma/                # Prisma schema, migrations, and seed script
scripts/               # Operational scripts (db setup, encryption rotation)
e2e/                   # Playwright end-to-end tests
infrastructure/        # Routing/walkway schema and infrastructure notes
```

## Architecture

The system follows a three-tier structure within the Next.js framework:

- **Presentation tier** — role-aware React interfaces for Admin, Staff, and Client across web, mobile, and kiosk, including the interactive map.
- **Application tier** — Next.js route handlers and server logic for authentication, validation, business rules, and geospatial processing, backed by Prisma.
- **Data tier** — MySQL relational database storing graves, plots, locations, users, requests, and audit logs, with integrity enforced through indexes and relationship constraints.

### Data model conventions

- **One source of truth per fact.** A plot's tiers are its `Grave` rows (unique on `plotId, tier`); the tier count is `Plot.totalTiers`; life dates are `Grave.birthDate/deathDate`; photos are `PlotPhoto` rows (`tier` 0 = plot-wide, 1..N = a tier). `GraveDetail.notes` is encrypted **free text only** — never store JSON or structured data in it.
- **Presentation logic lives in `src/lib/plot-format.js`** (pure, unit-tested). Components receive plain plot/grave data from the API and do not parse or reconcile it.
- **Photos** are validated once in `src/lib/photo-upload.js` (magic-byte sniffing, URL allow-list) and stored via `src/lib/plot-photos.js`.
- **The layout preset never creates burial records.** It only lays out plots (position, tier count); occupants come from real data entry.

### Site configuration (nothing cemetery-specific lives in components)

| What | Where |
| --- | --- |
| Display name, short name | `NEXT_PUBLIC_SITE_NAME`, `NEXT_PUBLIC_SITE_SHORT_NAME` |
| Map centre, tiles, routing | `NEXT_PUBLIC_MAP_CENTER_*`, `MAP_TILE_URL`, `ROUTING_BASE_URL` |
| Grid rotation, default tiers per building | `NEXT_PUBLIC_GRID_ANGLE`, `NEXT_PUBLIC_DEFAULT_BUILDING_TIERS` |
| Which location the layout attaches to | `LAYOUT_LOCATION_NAME` (default: the preset's `location.name`) |
| Plot layout, rows, retired rows, building geometry | `src/lib/layout-preset.json` (export the live layout with `node scripts/export-current-preset.js "<location>"`) |
| Boundary polygon | Saved by an Admin on the map; until then derived from the building plots |

A **building** is any plot with `totalTiers > 1`; its row is its section (`locationDetail.subsection`) and column order is the plot number's trailing number (`src/lib/cemetery-layout.js`). Plot-number prefixes such as `ROW-` carry no meaning to the code.

### Frontend structure

- Route pages own data fetching and mode state; reusable logic is extracted into hooks (`use-history-stack`, `use-boundary-settings`) and pure modules (`history-stack`, `map-geometry`).
- Pure map helpers live in `src/lib/map-geometry.js`; Google Maps marker factories in `src/components/map/map-icons.js`. Import constants from the lib module, not from `CemeteryMap`, so the map stays code-split.
- Drawer modals live in `src/components/plot-drawer/` and own their own form state.

## Security and Privacy

- Authentication and role-based access control (Admin, Staff, Client).
- Field-level encryption for sensitive burial details, with a key-rotation utility.
- Database-backed rate limiting on public endpoints.
- Audit logging of record changes and key interactions, including sign-ins, failed sign-ins and sign-outs, viewable by admins in the User Log.
- Privacy-safe analytics that avoid exposing personal identifiers.

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the full production runbook: environment configuration, database setup and migrations, scheduled archival secrets, encryption key rotation, pre-release verification gates, and a post-deploy smoke checklist.

## License

This project is developed as an academic capstone for Bolonsori Public Cemetery. Usage and distribution are subject to the project owners' terms.
