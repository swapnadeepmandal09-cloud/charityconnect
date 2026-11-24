# CharityConnect

Role-based charity crowdfunding platform (Donor / Charity / Admin) inspired by Ketto and Milaap, built as an academic project. Original branding and copy; all data is fictional.

## Stack, and a deliberate deviation
The brief preferred React + TypeScript + Vite + Tailwind + Prisma + Express. This build was created in a sandbox **without network access**, so no npm package could be installed or tested. To deliver something that actually runs and was actually tested, it uses **zero dependencies**:

| Layer | Used here | Brief's preference |
|---|---|---|
| Backend | Node 22 `node:http`, hand-written router + validators | Express + Zod |
| DB | `node:sqlite` (SQLite), SQL schema in `server/db.js` | Prisma + migrations |
| Frontend | Vanilla-JS SPA (`public/`), hash router, no build | React + TS + Vite + Tailwind |
| Tests | `node:test` | Vitest + Supertest + Playwright |

SQL is portable, money is integer paise, and the API is a plain JSON REST API, so porting the UI to React or the DB layer to Prisma/PostgreSQL is mechanical. It was not done here.

## Run
Prerequisite: **Node.js >= 22.13.0** (`node -v`). Install dependencies once with `npm install`.
```
npm install
node server/seed.js        # creates data/charityconnect.sqlite + demo data (safe to repeat)
node server/index.js       # http://localhost:3000     (npm start / npm run dev also work)
npm test                   # API/business-rule tests
node server/seed.js --reset   # wipe and re-seed dev data (refuses in production)
```
Config: copy `.env.example` to `.env` (placeholders only; `.env` is git-ignored).

## Run in GitHub Codespaces
1. On GitHub, open the repository and select **Code → Codespaces → Create codespace on main**.
2. Codespaces installs the project, seeds the demo database, and starts the app on port 3000.
3. If the browser does not open automatically, open the **Ports** tab and select **Open in Browser** for port 3000.

Use the development demo accounts below to sign in. The SQLite database is local to the Codespace; run `npm run reset` in its terminal to re-seed it when needed.

## Deploy to GitHub Pages
GitHub Pages can host the frontend; the Node.js API and persistent SQLite database must be deployed separately. Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to configure the backend origin and enable the Pages workflow.

## Deploy to Vercel
Vercel can host the frontend and API together. Set the project root to the repository root (the folder containing `vercel.json`, `api/` and `package.json` must be the top level of the GitHub repo) and follow [docs/DEPLOYMENT_VERCEL.md](docs/DEPLOYMENT_VERCEL.md) for environment variables and limitations.

### Demo accounts (development seed only)
| Role | Email | Password |
|---|---|---|
| Admin | admin@charityconnect.test | Admin@12345 |
| Donor | donor@charityconnect.test | Donor@12345 |
| Approved charity | charity@charityconnect.test | Charity@12345 |
| Pending charity | pending@charityconnect.test | Charity@12345 |

With `NODE_ENV=production` the seed creates only an admin and **requires** `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Screens (17) -> routes
Home `#/` · Register `#/register` · Login `#/login` · Donor dashboard `#/donor` · Find charities `#/charities` · Charity details `#/charities/:id` · Campaign details `#/campaigns/:slug` · Payment `#/pay/:id` · My donations `#/donor/donations` · Charity dashboard `#/charity` · Create campaign `#/charity/campaigns/new` · My campaigns `#/charity/campaigns` · Share/QR `#/charity/share` · Admin dashboard `#/admin` · Charities `#/admin/charities` · Campaigns `#/admin/campaigns` · Users `#/admin/users`. Extras: campaigns list, about, notifications, profile, admin donations/reports, post update.

The home page includes Success Stories: public campaigns whose funding period has ended after raising 90–100% of their goal. These stories remain viewable but do not accept new donations (`GET /api/campaigns/success-stories`).

## Rules worth knowing
* **Raised amount** = sum of donations with status `SUCCESS`. Pending/failed/cancelled/expired/refunded never count. Demo successes are included but flagged **SIMULATED** everywhere; `/api/admin/reports` splits real vs simulated.
* **Campaign states:** DRAFT -> PENDING -> ACTIVE (admin approves) or REJECTED (reason required, charity can edit and resubmit); only admins can pause an active campaign; a charity can resume a non-moderated pause; auto COMPLETED when goal is reached; future-start campaigns are marked SCHEDULED and cannot accept donations; ACTIVE past its end date is displayed and treated as EXPIRED (no donations). Dates use India Standard Time. Admin archive hides the campaign from public/donation flows and preserves donation history.
* **Charity moderation:** Admin archive hides the charity and its campaigns from public access and disables its charity workspace. Permanent deletion removes the charity and campaigns only when there is no donation history; charities with donations must be archived to preserve records.
* **Donation limits:** ₹10 to ₹1,00,000, max 2 decimals. Payment sessions expire after 15 min. An identical pending attempt within 2 min is reused (no duplicate orders).
* **Auth:** scrypt password hashes; random session token stored hashed; `HttpOnly; SameSite=Lax` cookie (`Secure` in production); 7-day expiry; login/register rate-limited; Origin check on mutating requests; `ADMIN` cannot be self-registered; disabling a user revokes their sessions.
* **Donor profiles:** `/api/profile` stores an address, profile photo, and ID-proof file. The profile page shows completion based on name, email, address, photo, and proof. Uploads are limited to image/PDF formats and are not identity-verified; this demo is not designed for real identity documents.

## Payments
* **Demo mode (default, `PAYMENT_MODE=demo`)**: the payment page is labelled SIMULATED; the donor presses "Simulate success/failure". No money moves; records are flagged and receipts read `SIMULATED-…`.
* **`PAYMENT_MODE=youpi`**: webhook `POST /api/payments/webhooks/youpi` is live and verified (see tests), but session creation is **not wired** (see `docs/PAYMENT_ASSESSMENT.md`). Donations fail safely until it is implemented.

## API (all under `/api`, JSON; errors `{error:{code,message,details}}`; lists `{items,total,page,pageSize}`)
Auth: `POST auth/register|login|logout`, `GET auth/me`, `GET meta`
Public: `GET campaigns` (q, category, status, sort, live, page), `GET campaigns/success-stories`, `GET campaigns/:slug`, `GET charities` (q, category, location), `GET charities/:id`
Donor: `GET donor/dashboard`, `GET donor/donations?status=`, `POST donations`, `GET donations/:id`, `GET|PATCH profile`, `GET notifications`, `POST notifications/read`
Payments: `GET payments/:id/status`, `POST payments/:id/cancel`, `POST payments/:id/demo-resolve`, `POST payments/webhooks/youpi`
Charity: `GET charity/dashboard`, `GET|PATCH charity/profile`, `GET|POST charity/campaigns`, `GET|PATCH charity/campaigns/:id` (edit, or `{action:"resume"}`), `POST charity/campaigns/:id/updates`
Admin: `GET admin/dashboard|users|charities|campaigns|donations|reports|audit`, `PATCH admin/users/:id/status`, `POST admin/charities/:id/approve|reject|archive|permanent-delete`, `POST admin/campaigns/:id/approve|reject|pause|archive` (only admins can pause; archive preserves history; filter `GET admin/campaigns?status=ARCHIVED` and `GET admin/charities?status=ARCHIVED` to view archived records)

## Testing report (what was actually run)
* `npm test`: **22/22 pass** (includes scheduled campaign start eligibility and success-story thresholds for ended campaigns).
* Live smoke test: server starts, static files and API return expected codes, security headers and cookie flags present.
* Browser smoke check: the affected campaign shows its donation form, and the home page renders the ended-campaign Success Stories section with live API data.
* Headless render check: all 17 screens (+extras) rendered for the right role against the live API with a **stubbed DOM**: 37 routes, 0 errors, guards redirect correctly.

## Known limitations (honest list)
* **No comprehensive browser test suite.** The campaign donation and Success Stories views were smoke-tested in a browser; broader click-through flows, mobile responsiveness and accessibility still need review.
* No React/TS/Prisma/Zod (see above). No ESLint/type-check step.
* No real QR codes (needs a QR library); Share page offers a copyable link + WhatsApp link instead.
* Campaign images and private supporting documents are uploaded to the local SQLite database. Donor profile photos and ID-proof files can also be uploaded, but uploads and identity checks are not production-ready; do not use real government IDs in this demo.
* YouPI-PG session creation not implemented; only the webhook receiver is. Real payments must not be enabled.
* Email verification and password-reset flows are not implemented. Notifications are in-app only.
* Admin cannot edit campaign text (can pause, approve, reject, or archive campaigns); no refund workflow (REFUNDED status exists and is excluded from totals).
* Rate limiting is in-memory (resets on restart); single-process only.
* Not security-audited or production-ready.
