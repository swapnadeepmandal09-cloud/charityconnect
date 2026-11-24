# GitHub Pages deployment

GitHub Pages hosts the static frontend only. CharityConnect's Node.js API and SQLite database must run on a separate backend host; Pages cannot run `server/index.js` or persist the database.

## Configure the backend

Deploy this repository's Node.js server on a host that supports Node.js 22 and persistent storage. Configure:

- `NODE_ENV=production`
- `FRONTEND_ORIGIN=https://OWNER.github.io` (or the exact custom frontend origin, without a path)
- `DB_PATH` to a database file on persistent storage
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the production administrator
- `PAYMENT_MODE=demo` unless a real provider has been properly configured

The backend uses credentialed CORS for only the exact `FRONTEND_ORIGIN`. Production session cookies are `HttpOnly`, `Secure`, and `SameSite=None` when that setting is present. Use HTTPS for both frontend and backend. For dependable browser sessions, a custom frontend domain and API subdomain under the same registrable domain are preferable; some browsers block cross-site cookies even with these settings.

## Configure GitHub Pages

1. In the repository, open **Settings → Secrets and variables → Actions → Variables** and create `API_BASE_URL` with the backend's HTTPS origin (for example, `https://api.example.com`). Do not append `/api`.
2. Open **Settings → Pages** and set the build/deployment source to **GitHub Actions**.
3. Push to `main`, or run **Deploy CharityConnect to GitHub Pages** from the Actions tab.

The workflow publishes the frontend's `public/` folder and injects `API_BASE_URL` into the generated `config.js`; no backend credentials are published. It supports the app at the repository root or under the existing `charityconnect/` folder. The deploy job is skipped until `API_BASE_URL` is set. The frontend resolves its asset paths relative to its deployed location, including the `/REPOSITORY/` prefix used by project Pages sites.

## Local development and the console 401

Leave `public/config.js` empty for local development; the frontend then calls the API on the same origin. `GET /api/auth/me` returns an anonymous session (`user: null`) when no one is signed in, so it no longer produces the misleading 401 console error. Protected API routes still return 401 when authentication is required.

GitHub Pages is not a substitute for the API host. The Pages deployment will not be functional until `API_BASE_URL` points to a running backend configured with the matching `FRONTEND_ORIGIN`.
