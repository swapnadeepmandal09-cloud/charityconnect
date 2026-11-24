import { createApp } from './app.js';
import { existsSync, readFileSync } from 'node:fs';
// Minimal .env loader (no dependency); real environment variables win.
if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const dbPath = process.env.DB_PATH || 'data/charityconnect.sqlite';
const { server } = createApp({ dbPath });
const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`CharityConnect on http://localhost:${port}  (payments: ${process.env.PAYMENT_MODE || 'demo'})`));
