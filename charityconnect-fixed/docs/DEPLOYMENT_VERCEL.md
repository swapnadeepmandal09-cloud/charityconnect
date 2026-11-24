# Deploying on Vercel

Import the repository into Vercel and set **Root Directory** to the repository root, the folder containing `package.json`, `vercel.json`, `api/`, `server/`, and `public/`.

Add these environment variables in **Project Settings → Environment Variables**:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `PAYMENT_MODE=demo`

Vercel runs in production mode. The seed requires the admin credentials. On Vercel the API also loads the demo charities and campaigns by default (`DEMO_SEED=true`); set `DEMO_SEED=false` in Vercel to create only the admin account. Keep `public/config.js` empty so the frontend calls the API on the same origin.

The API uses a SQLite file under `/tmp` on Vercel. Serverless function storage is temporary, so registrations, campaigns, and donations can be lost when instances are replaced. Use a persistent database for real deployments. Demo payments are simulated; no money moves.

After setting the project root and environment variables, redeploy. Verify that `/api/public/stats` returns JSON rather than a Vercel 404.
