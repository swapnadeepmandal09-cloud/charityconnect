import http from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, tx } from './db.js';
import { seed } from './seed.js';
import { getProvider, verifySignature, TRANSITIONS } from './payments.js';

export const CATEGORIES = ['Education', 'Health', 'Child Welfare', 'Environment', 'Food & Community', 'Animal Welfare', 'Water & Sanitation'];
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIN_PAISE = 1000, MAX_PAISE = 10_000_000; // Rs 10 .. Rs 1,00,000 per donation
const SESSION_MS = 7 * 24 * 3600 * 1000;
const PAYMENT_TTL_MS = 15 * 60 * 1000;

export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', details) { super(message); this.status = status; this.code = code; this.details = details; }
}
const bad = (m, details) => new HttpError(400, m, 'VALIDATION', details);

/* ---------- small helpers ---------- */
const sha = (s) => createHash('sha256').update(s).digest('hex');
const today = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts().map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const hashPw = (pw) => { const salt = randomBytes(16); return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 64).toString('hex')}`; };
const DUMMY = hashPw('dummy-password-for-timing');
const checkPw = (pw, stored) => {
  const [, s, h] = stored.split('$');
  const got = scryptSync(pw, Buffer.from(s, 'hex'), 64), want = Buffer.from(h, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
};
const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
export { hashPw };

const str = (v, name, min, max) => {
  if (typeof v !== 'string') throw bad(`${name} is required`, { field: name });
  const t = v.trim();
  if (t.length < min || t.length > max) throw bad(`${name} must be ${min}-${max} characters`, { field: name });
  return t;
};
const oneOf = (v, list, name) => { if (!list.includes(v)) throw bad(`${name} is invalid`, { field: name }); return v; };
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const rupeesToPaise = (v, name, minP, maxP) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(`${name} must be a number`, { field: name });
  const p = Math.round(n * 100);
  if (Math.abs(p - n * 100) > 1e-6) throw bad(`${name} can have at most 2 decimals`, { field: name });
  if (p < minP || p > maxP) throw bad(`${name} must be between ₹${minP / 100} and ₹${maxP / 100}`, { field: name });
  return p;
};
const imageUrl = (v) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > 500 || !/^https:\/\/[^\s]+$/.test(v)) throw bad('Image must be an https URL', { field: 'image' });
  return v;
};
const profileUpload = (upload, field, types, maxBytes) => {
  if (upload == null) return null;
  if (!upload || typeof upload !== 'object' || typeof upload.data !== 'string' || typeof upload.type !== 'string') {
    throw bad(`${field} upload is invalid`, { field });
  }
  const match = upload.data.match(/^data:([-\w.+/]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[1] !== upload.type || !types.includes(upload.type)) throw bad(`${field} file type is not supported`, { field });
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > maxBytes || data.toString('base64') !== match[2]) throw bad(`${field} file must be no larger than ${Math.floor(maxBytes / 1024)} KB`, { field });
  const validSignature = upload.type === 'image/jpeg' ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    : upload.type === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : upload.type === 'image/webp' ? data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
        : upload.type === 'application/pdf' ? data.toString('ascii', 0, 5) === '%PDF-' : false;
  if (!validSignature) throw bad(`${field} file content does not match its type`, { field });
  const name = typeof upload.name === 'string' ? upload.name.trim().replace(/[^\w .()-]/g, '_').slice(0, 100) : '';
  return { data, type: upload.type, name };
};
const page = (q) => {
  const p = Math.max(1, parseInt(q.page) || 1), size = Math.min(50, Math.max(1, parseInt(q.pageSize) || 12));
  return { p, size, off: (p - 1) * size };
};
const like = (s) => `%${String(s).replace(/[%_\\]/g, (m) => '\\' + m)}%`;

const RAISED = `(SELECT COALESCE(SUM(amount_paise),0) FROM donations d WHERE d.campaign_id=c.id AND d.status='SUCCESS')`;
const DONORS = `(SELECT COUNT(DISTINCT donor_id) FROM donations d WHERE d.campaign_id=c.id AND d.status='SUCCESS')`;
const CAMPAIGN_SELECT = `SELECT c.*, ${RAISED} AS raised, ${DONORS} AS donors, ch.name AS charity_name, ch.location AS charity_location,
  ch.status AS charity_status, ch.archived_at AS charity_archived_at, ch.id AS charity_id_ FROM campaigns c JOIN charities ch ON ch.id=c.charity_id`;

const effStatus = (c) => {
  if (c.status === 'ACTIVE' && c.end_date < today()) return 'EXPIRED';
  if (c.status === 'ACTIVE' && c.start_date > today()) return 'SCHEDULED';
  return c.status;
};
const isSuccessStory = (c) => c.end_date < today()
  && c.raised * 100 >= c.goal_paise * 90 && c.raised <= c.goal_paise;
function campaignOut(c, { private: priv = false } = {}) {
  const daysLeft = Math.ceil((Date.parse(c.end_date) - Date.parse(today())) / 86400000);
  return {
    id: c.id, slug: c.slug, title: c.title, description: c.description, category: c.category,
    image: c.image_data ? `/api/campaigns/${encodeURIComponent(c.slug)}/image` : c.image,
    goalPaise: c.goal_paise, raisedPaise: c.raised, percent: Math.min(100, Math.floor((c.raised * 100) / c.goal_paise)),
    donors: c.donors, status: c.status, effectiveStatus: effStatus(c), isSuccessStory: isSuccessStory(c),
    startDate: c.start_date, endDate: c.end_date,
    daysLeft: Math.max(0, daysLeft), createdAt: c.created_at,
    charity: { id: c.charity_id, name: c.charity_name, location: c.charity_location, verified: c.charity_status === 'APPROVED' },
    ...(priv ? { reviewNote: c.review_note, archivedAt: c.archived_at, resumedAt: c.resumed_at,
      hasImage: !!(c.image_data || c.image), hasDocument: !!c.document_data, documentName: c.document_name } : {}),
  };
}

/* ---------- app factory ---------- */
export function createApp({ dbPath = ':memory:', env = process.env } = {}) {
  const db = openDb(dbPath);
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) seed(db, env);
  const prod = env.NODE_ENV === 'production';
  const frontendOrigin = env.FRONTEND_ORIGIN ? new URL(env.FRONTEND_ORIGIN).origin : '';
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const provider = getProvider(env.PAYMENT_MODE);
  const hits = new Map();
  const rateLimit = (key, max = 10, windowMs = 15 * 60 * 1000) => {
    const now = Date.now(), arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now); hits.set(key, arr);
    if (arr.length > max) throw new HttpError(429, 'Too many attempts. Please try again later.', 'RATE_LIMITED');
  };
  const notify = (userId, type, message) => run('INSERT INTO notifications(user_id,type,message) VALUES(?,?,?)', userId, type, message);
  const audit = (actor, action, type, id, detail) => run('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,detail) VALUES(?,?,?,?,?)', actor, action, type, id, detail ? String(detail).slice(0, 300) : null);
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status });
  const profileOut = (u) => {
    const complete = [u.name, u.email, u.profile_address, u.profile_photo_data, u.id_proof_data].filter(Boolean).length;
    return {
      name: u.name, email: u.email, address: u.profile_address || '',
      photo: u.profile_photo_data ? `data:${u.profile_photo_type};base64,${Buffer.from(u.profile_photo_data).toString('base64')}` : '',
      idProofName: u.id_proof_name || '', hasIdProof: !!u.id_proof_data,
      completionPercent: Math.round(complete * 100 / 5),
    };
  };
  const myCharity = (u) => { const c = one('SELECT * FROM charities WHERE user_id=?', u.id); if (!c) throw new HttpError(404, 'Charity profile not found'); if (c.archived_at) throw new HttpError(403, 'This charity has been archived', 'CHARITY_ARCHIVED'); return c; };

  /* ----- payment settlement (single place that changes money state) ----- */
  function settleInner(paymentId, next, { utr } = {}) {
    const p = one('SELECT * FROM payments WHERE id=?', paymentId);
    if (!p) throw new HttpError(404, 'Payment not found');
    if (p.status === next) return { changed: false, payment: p };
    if (!TRANSITIONS[p.status].includes(next)) throw new HttpError(409, `Cannot move payment from ${p.status} to ${next}`, 'INVALID_TRANSITION');
    run("UPDATE payments SET status=?, utr=COALESCE(?,utr), updated_at=datetime('now') WHERE id=?", next, utr || null, p.id);
    const dStatus = next === 'UNDER_REVIEW' ? 'PENDING' : next;
    run("UPDATE donations SET status=?, simulated=?, updated_at=datetime('now') WHERE id=?", dStatus, p.provider === 'demo' ? 1 : 0, p.donation_id);
    const d = one('SELECT d.*, c.title, c.id AS cid, c.goal_paise, c.status AS cstatus, ch.user_id AS owner FROM donations d JOIN campaigns c ON c.id=d.campaign_id JOIN charities ch ON ch.id=c.charity_id WHERE d.id=?', p.donation_id);
    notify(d.donor_id, 'DONATION', `Your ${p.provider === 'demo' ? 'simulated ' : ''}donation to "${d.title}" is now ${next.replace('_', ' ').toLowerCase()}.`);
    if (next === 'SUCCESS') {
      notify(d.owner, 'DONATION', `A donation of ₹${d.amount_paise / 100} was received for "${d.title}".`);
      const raised = one('SELECT COALESCE(SUM(amount_paise),0) s FROM donations WHERE campaign_id=? AND status=\'SUCCESS\'', d.cid).s;
      if (raised >= d.goal_paise && d.cstatus === 'ACTIVE') run("UPDATE campaigns SET status='COMPLETED', updated_at=datetime('now') WHERE id=?", d.cid);
    }
    return { changed: true, payment: one('SELECT * FROM payments WHERE id=?', p.id) };
  }
  const settle = (id, next, extra) => tx(db, () => settleInner(id, next, extra));
  const expireIfDue = (p) => (p.status === 'PENDING' && p.expires_at < new Date().toISOString() ? settle(p.id, 'EXPIRED').payment : p);
  const paymentOut = (p, donation) => ({
    id: p.id, donationId: p.donation_id, provider: p.provider, simulated: p.provider === 'demo', orderId: p.order_id,
    status: p.status, amountPaise: p.amount_paise, currency: p.currency, utr: p.utr, expiresAt: p.expires_at,
    instructions: p.instructions ? JSON.parse(p.instructions) : null, campaign: donation ? { title: donation.title, slug: donation.slug } : undefined,
  });

  /* ----- routes ----- */
  const routes = [];
  const R = (method, path, auth, handler) => {
    const keys = []; const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, auth, handler });
  };

  // --- auth
  R('POST', '/api/auth/register', null, ({ body, req }) => {
    rateLimit('reg:' + req.socket.remoteAddress, 20);
    const name = str(body.name, 'name', 2, 80);
    const email = str(body.email, 'email', 5, 120).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email', { field: 'email' });
    const pw = str(body.password, 'password', 8, 100);
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password needs letters and numbers', { field: 'password' });
    const role = oneOf(body.accountType, ['DONOR', 'CHARITY'], 'accountType'); // ADMIN can never be self-registered
    let ch;
    if (role === 'CHARITY') {
      const c = body.charity || {};
      ch = { name: str(c.name, 'organisation name', 3, 120), category: oneOf(c.category, CATEGORIES, 'category'),
        location: str(c.location, 'location', 2, 100), description: str(c.description, 'description', 20, 2000) };
    }
    if (one('SELECT 1 FROM users WHERE email=?', email)) throw new HttpError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
    const uid = tx(db, () => {
      const id = Number(run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)', name, email, hashPw(pw), role).lastInsertRowid);
      if (ch) {
        run('INSERT INTO charities(user_id,name,description,category,location,contact_email) VALUES(?,?,?,?,?,?)', id, ch.name, ch.description, ch.category, ch.location, email);
        for (const a of q("SELECT id FROM users WHERE role='ADMIN'")) notify(a.id, 'APPROVAL', `New charity registration awaiting review: ${ch.name}`);
        notify(id, 'ACCOUNT', 'Your charity registration is pending admin approval.');
      } else notify(id, 'ACCOUNT', 'Welcome to CharityConnect!');
      return id;
    });
    return { status: 201, body: { user: publicUser(one('SELECT * FROM users WHERE id=?', uid)) } };
  });

  R('POST', '/api/auth/login', null, ({ body, req, res }) => {
    const email = String(body.email || '').trim().toLowerCase();
    rateLimit(`login:${req.socket.remoteAddress}:${email}`, 8);
    const u = one('SELECT * FROM users WHERE email=?', email);
    const ok = checkPw(String(body.password || ''), u ? u.password_hash : DUMMY);
    if (!u || !ok) throw new HttpError(401, 'Invalid email or password', 'BAD_CREDENTIALS');
    if (u.status !== 'ACTIVE') throw new HttpError(403, 'This account has been disabled', 'DISABLED');
    run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    const token = randomBytes(32).toString('hex');
    run('INSERT INTO sessions VALUES(?,?,?)', sha(token), u.id, Date.now() + SESSION_MS);
    res.setHeader('Set-Cookie', `cc_sid=${token}; HttpOnly; SameSite=${prod && frontendOrigin ? 'None' : 'Lax'}; Path=/; Max-Age=${SESSION_MS / 1000}${prod ? '; Secure' : ''}`);
    return { body: { user: publicUser(u) } };
  });
  R('POST', '/api/auth/logout', null, ({ req, res }) => {
    const t = cookie(req, 'cc_sid'); if (t) run('DELETE FROM sessions WHERE token_hash=?', sha(t));
    res.setHeader('Set-Cookie', `cc_sid=; HttpOnly; SameSite=${prod && frontendOrigin ? 'None' : 'Lax'}; Path=/; Max-Age=0${prod ? '; Secure' : ''}`);
    return { body: { ok: true } };
  });
  R('GET', '/api/auth/me', null, ({ user }) => {
    if (!user) return { body: { user: null, unread: 0 } };
    const out = { user: publicUser(user), unread: one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0', user.id).n };
    if (user.role === 'CHARITY') { const c = one('SELECT id,name,status,review_note FROM charities WHERE user_id=?', user.id); out.charity = c; }
    return { body: out };
  });
  R('GET', '/api/profile', ['DONOR'], ({ user }) => ({ body: { profile: profileOut(user) } }));
  R('PATCH', '/api/profile', ['DONOR'], ({ user, body }) => {
    const address = body.address === undefined ? user.profile_address || '' : str(body.address, 'address', 0, 300);
    const photo = profileUpload(body.photo, 'photo', ['image/jpeg', 'image/png', 'image/webp'], 1_000_000);
    const idProof = profileUpload(body.idProof, 'idProof', ['image/jpeg', 'image/png', 'application/pdf'], 1_500_000);
    run(`UPDATE users SET profile_address=?, profile_photo_data=COALESCE(?,profile_photo_data),
      profile_photo_type=COALESCE(?,profile_photo_type), id_proof_data=COALESCE(?,id_proof_data),
      id_proof_type=COALESCE(?,id_proof_type), id_proof_name=COALESCE(?,id_proof_name) WHERE id=?`,
      address, photo?.data || null, photo?.type || null, idProof?.data || null, idProof?.type || null, idProof?.name || null, user.id);
    return { body: { profile: profileOut(one('SELECT * FROM users WHERE id=?', user.id)) } };
  });
  R('GET', '/api/meta', null, () => ({ body: { categories: CATEGORIES, paymentMode: provider.name, minDonationPaise: MIN_PAISE, maxDonationPaise: MAX_PAISE } }));
  R('GET', '/api/public/stats', null, () => ({
    body: one(`SELECT
      COALESCE(SUM(amount_paise), 0) AS amountPaise,
      COUNT(DISTINCT donor_id) AS contributors,
      COUNT(*) AS donations
      FROM donations
      WHERE status='SUCCESS' AND date(created_at) >= date('now', 'start of month')`),
  }));

  // --- public discovery
  R('GET', '/api/campaigns', null, ({ query }) => {
    const { p, size, off } = page(query); const w = ["c.status IN ('ACTIVE','COMPLETED')", 'c.end_date>=?', `${RAISED}<c.goal_paise`, 'c.archived_at IS NULL', 'ch.archived_at IS NULL', "ch.status='APPROVED'"]; const a = [today()];
    if (query.q) { w.push("(c.title LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' OR ch.name LIKE ? ESCAPE '\\')"); a.push(like(query.q), like(query.q), like(query.q)); }
    if (query.category) { w.push('c.category=?'); a.push(oneOf(query.category, CATEGORIES, 'category')); }
    if (query.location) { w.push("ch.location LIKE ? ESCAPE '\\'"); a.push(like(query.location)); }
    if (query.charityId) { w.push('c.charity_id=?'); a.push(parseInt(query.charityId) || 0); }
    if (query.live === '1') { w.push("c.status='ACTIVE' AND c.start_date<=? AND c.end_date>=?"); a.push(today(), today()); }
    if (query.status) { w.push('c.status=?'); a.push(oneOf(String(query.status).toUpperCase(), ['ACTIVE', 'COMPLETED'], 'status')); }
    const order = { ending: 'c.end_date ASC', progress: `${RAISED}*1.0/c.goal_paise DESC`, newest: 'c.created_at DESC, c.id DESC' }[query.sort || 'newest'];
    if (!order) throw bad('sort is invalid');
    const balancedCategoryOrder = !query.category && (query.sort || 'newest') === 'newest'
      ? 'ROW_NUMBER() OVER (PARTITION BY c.category ORDER BY c.created_at DESC, c.id DESC), '
      : '';
    const featuredHealthOrder = query.category === 'Health'
      ? "CASE WHEN c.slug='emergency-recovery-after-road-accident' THEN 0 ELSE 1 END, "
      : '';
    const where = ' WHERE ' + w.join(' AND ');
    const total = one(`SELECT COUNT(*) n FROM campaigns c JOIN charities ch ON ch.id=c.charity_id${where}`, ...a).n;
    const items = q(`${CAMPAIGN_SELECT}${where} ORDER BY ${balancedCategoryOrder}${featuredHealthOrder}${order} LIMIT ? OFFSET ?`, ...a, size, off).map((c) => campaignOut(c));
    const locations = q(`SELECT DISTINCT ch.location FROM campaigns c JOIN charities ch ON ch.id=c.charity_id
      WHERE c.status IN ('ACTIVE','COMPLETED') AND c.end_date>=? AND ${RAISED}<c.goal_paise
      AND c.archived_at IS NULL AND ch.archived_at IS NULL AND ch.status='APPROVED'
      ORDER BY ch.location`, today()).map((row) => row.location);
    return { body: { items, total, page: p, pageSize: size, locations } };
  });
  R('GET', '/api/campaigns/success-stories', null, ({ query }) => {
    const { p, size, off } = page(query);
    const where = ` WHERE c.status IN ('ACTIVE','COMPLETED') AND c.end_date<?
      AND ${RAISED}*100>=c.goal_paise*90 AND ${RAISED}<=c.goal_paise
      AND c.archived_at IS NULL AND ch.archived_at IS NULL AND ch.status='APPROVED'`;
    const total = one(`SELECT COUNT(*) n FROM campaigns c JOIN charities ch ON ch.id=c.charity_id${where}`, today()).n;
    const items = q(`${CAMPAIGN_SELECT}${where} ORDER BY c.end_date DESC,c.id DESC LIMIT ? OFFSET ?`, today(), size, off)
      .map((c) => campaignOut(c));
    return { body: { items, total, page: p, pageSize: size } };
  });
  R('GET', '/api/campaigns/:slug/image', null, ({ params, user }) => {
    const campaign = one(`SELECT c.image_data,c.image_type,c.status,c.end_date,c.goal_paise,c.charity_id,c.archived_at,
      ${RAISED} AS raised,
      ch.user_id AS owner_id,ch.status AS charity_status,ch.archived_at AS charity_archived_at
      FROM campaigns c JOIN charities ch ON ch.id=c.charity_id WHERE c.slug=?`, params.slug);
    const publiclyVisible = campaign?.charity_status === 'APPROVED'
      && ((['ACTIVE', 'COMPLETED', 'PAUSED'].includes(campaign.status) && campaign.end_date >= today())
        || isSuccessStory(campaign));
    if (!campaign?.image_data || campaign.archived_at || campaign.charity_archived_at
      || (campaign.owner_id !== user?.id && !publiclyVisible)) {
      throw new HttpError(404, 'Campaign image not found');
    }
    return { binary: campaign.image_data, contentType: campaign.image_type,
      cacheControl: publiclyVisible ? 'public, max-age=3600' : 'private, no-store' };
  });
  R('GET', '/api/campaigns/:slug', null, ({ params }) => {
    const c = one(`${CAMPAIGN_SELECT} WHERE c.slug=? AND c.archived_at IS NULL AND ch.archived_at IS NULL
      AND ch.status='APPROVED' AND (
        (c.status IN ('ACTIVE','COMPLETED','PAUSED') AND c.end_date>=? AND ${RAISED}<c.goal_paise)
        OR (c.status IN ('ACTIVE','COMPLETED') AND c.end_date<? AND ${RAISED}*100>=c.goal_paise*90 AND ${RAISED}<=c.goal_paise)
      )`, params.slug, today(), today());
    if (!c) throw new HttpError(404, 'Campaign not found');
    const updates = q('SELECT id,title,body,created_at FROM campaign_updates WHERE campaign_id=? ORDER BY id DESC LIMIT 20', c.id);
    const recentDonations = q(`SELECT u.name, SUM(d.amount_paise) amount_paise, COUNT(*) donations,
      MAX(d.created_at) created_at, MIN(d.simulated) simulated
      FROM donations d JOIN users u ON u.id=d.donor_id
      WHERE d.campaign_id=? AND d.status='SUCCESS'
      GROUP BY d.donor_id ORDER BY MAX(d.created_at) DESC, u.name LIMIT 5`, c.id)
      .map((r) => ({ name: r.name, amountPaise: r.amount_paise, donations: r.donations, createdAt: r.created_at, simulated: !!r.simulated }));
    return { body: { campaign: campaignOut(c), updates, recentDonations, donatable: donatable(c) } };
  });
  R('GET', '/api/charities', null, ({ query }) => {
    const { p, size, off } = page(query); const w = ["ch.status='APPROVED'", 'ch.archived_at IS NULL']; const a = [];
    if (query.q) { w.push("(ch.name LIKE ? ESCAPE '\\' OR ch.description LIKE ? ESCAPE '\\' OR ch.category LIKE ? ESCAPE '\\')"); a.push(like(query.q), like(query.q), like(query.q)); }
    if (query.category) { w.push('ch.category=?'); a.push(oneOf(query.category, CATEGORIES, 'category')); }
    if (query.location) { w.push("ch.location LIKE ? ESCAPE '\\'"); a.push(like(query.location)); }
    const where = ' WHERE ' + w.join(' AND ');
    const total = one(`SELECT COUNT(*) n FROM charities ch${where}`, ...a).n;
    const items = q(`SELECT ch.id,ch.name,ch.description,ch.category,ch.location,ch.image,
      (SELECT COUNT(*) FROM campaigns c WHERE c.charity_id=ch.id AND c.archived_at IS NULL AND c.status='ACTIVE' AND c.end_date>=?) AS active_campaigns
      FROM charities ch${where} ORDER BY ch.name LIMIT ? OFFSET ?`, today(), ...a, size, off).map((r) => ({ ...r, activeCampaigns: r.active_campaigns, verified: true }));
    return { body: { items, total, page: p, pageSize: size, locations: q("SELECT DISTINCT location FROM charities WHERE status='APPROVED' AND archived_at IS NULL ORDER BY location").map((r) => r.location) } };
  });
  R('GET', '/api/charities/:id', null, ({ params }) => {
    const ch = one("SELECT id,name,description,category,location,image FROM charities WHERE id=? AND status='APPROVED' AND archived_at IS NULL", parseInt(params.id) || 0);
    if (!ch) throw new HttpError(404, 'Charity not found');
    const campaigns = q(`${CAMPAIGN_SELECT} WHERE c.charity_id=? AND c.end_date>=? AND ${RAISED}<c.goal_paise AND c.archived_at IS NULL AND c.status IN ('ACTIVE','COMPLETED') ORDER BY c.id DESC`, ch.id, today()).map((c) => campaignOut(c));
    return { body: { charity: { ...ch, verified: true }, campaigns } };
  });

  // --- donations & payments
  const donatable = (c) => c.status === 'ACTIVE' && c.raised < c.goal_paise && c.charity_status === 'APPROVED' && !c.charity_archived_at && c.start_date <= today() && c.end_date >= today();
  R('POST', '/api/donations', ['DONOR'], async ({ body, user }) => {
    const amount = rupeesToPaise(body.amount, 'amount', MIN_PAISE, MAX_PAISE);
    const c = one(`${CAMPAIGN_SELECT} WHERE c.id=? AND c.archived_at IS NULL AND ch.archived_at IS NULL`, parseInt(body.campaignId) || 0);
    if (!c || !['ACTIVE', 'COMPLETED', 'PAUSED'].includes(c.status)) throw new HttpError(404, 'Campaign not found');
    if (!donatable(c)) throw new HttpError(409, 'This campaign is not accepting donations right now', 'CAMPAIGN_CLOSED');
    // duplicate-submit protection: reuse a very recent identical pending attempt
    const dup = one(`SELECT d.id, p.id AS pid FROM donations d JOIN payments p ON p.donation_id=d.id WHERE d.donor_id=? AND d.campaign_id=? AND d.amount_paise=?
      AND d.status='PENDING' AND p.status='PENDING' AND p.expires_at > ? AND d.created_at > datetime('now','-2 minutes')`, user.id, c.id, amount, new Date().toISOString());
    if (dup) return { status: 200, body: { donationId: dup.id, paymentId: dup.pid, reused: true } };
    const orderId = 'CC-' + randomBytes(8).toString('hex').toUpperCase();
    const ids = tx(db, () => {
      const d = Number(run('INSERT INTO donations(donor_id,campaign_id,amount_paise,simulated) VALUES(?,?,?,?)', user.id, c.id, amount, provider.simulated ? 1 : 0).lastInsertRowid);
      const p = Number(run('INSERT INTO payments(donation_id,provider,order_id,amount_paise,expires_at) VALUES(?,?,?,?,?)', d, provider.name, orderId, amount, new Date(Date.now() + PAYMENT_TTL_MS).toISOString()).lastInsertRowid);
      return { d, p };
    });
    try {
      const s = await provider.createSession({ orderId, amountPaise: amount, currency: 'INR', campaignId: String(c.id), donationId: String(ids.d) });
      run('UPDATE payments SET provider_ref=?, instructions=? WHERE id=?', s.providerReference, JSON.stringify(s.paymentInstructions ?? null), ids.p);
    } catch (e) {
      settle(ids.p, 'FAILED');
      throw new HttpError(503, e.code === 'PROVIDER_NOT_READY' ? 'The payment provider is not configured. Set PAYMENT_MODE=demo or finish the provider setup.' : 'The payment provider is unavailable. No money was charged; please try again.', 'PROVIDER_UNAVAILABLE');
    }
    return { status: 201, body: { donationId: ids.d, paymentId: ids.p } };
  });
  const loadPayment = (id, user) => {
    const p = one('SELECT * FROM payments WHERE id=?', parseInt(id) || 0);
    const d = p && one('SELECT d.*, c.title, c.slug FROM donations d JOIN campaigns c ON c.id=d.campaign_id WHERE d.id=?', p.donation_id);
    if (!p || (d.donor_id !== user.id && user.role !== 'ADMIN')) throw new HttpError(404, 'Payment not found'); // 404, not 403: don't reveal existence
    return { p: expireIfDue(p), d };
  };
  R('GET', '/api/payments/:id/status', 'any', ({ params, user }) => { const { p, d } = loadPayment(params.id, user); return { body: { payment: paymentOut(p, d) } }; });
  R('POST', '/api/payments/:id/cancel', ['DONOR'], ({ params, user }) => {
    const { p, d } = loadPayment(params.id, user); const r = settle(p.id, 'CANCELLED'); return { body: { payment: paymentOut(r.payment, d) } };
  });
  R('POST', '/api/payments/:id/demo-resolve', ['DONOR'], ({ params, body, user }) => {
    const { p, d } = loadPayment(params.id, user);
    if (p.provider !== 'demo') throw new HttpError(403, 'Only simulated payments can be resolved manually', 'NOT_DEMO');
    const next = { success: 'SUCCESS', fail: 'FAILED' }[body.outcome]; if (!next) throw bad('outcome must be success or fail');
    const r = settle(p.id, next, next === 'SUCCESS' ? { utr: 'SIMULATED-' + p.order_id } : {});
    return { body: { payment: paymentOut(r.payment, d) } };
  });
  R('POST', '/api/payments/webhooks/youpi', null, ({ raw, req }) => {
    const secret = env.YOUPI_WEBHOOK_SECRET;
    if (!secret || env.PAYMENT_MODE !== 'youpi') throw new HttpError(503, 'Webhook not enabled', 'WEBHOOK_DISABLED');
    if (!verifySignature(raw, req.headers['x-gateway-signature'], secret)) throw new HttpError(401, 'Invalid signature', 'BAD_SIGNATURE');
    let e; try { e = JSON.parse(raw.toString('utf8')); } catch { throw bad('Malformed JSON'); }
    const deliveryId = String(req.headers['x-gateway-delivery-id'] || e.deliveryId || '');
    const ts = Number(req.headers['x-gateway-timestamp'] || e.timestamp);
    if (!deliveryId || !Number.isFinite(ts)) throw bad('Missing delivery id or timestamp');
    if (Math.abs(Date.now() - ts) > 2 * 3600 * 1000) throw bad('Delivery outside the freshness window', {});
    const p = one('SELECT * FROM payments WHERE order_id=? AND provider=?', String(e.orderId || ''), 'youpi');
    if (!p) throw new HttpError(404, 'Unknown order', 'UNKNOWN_ORDER');
    if (!Number.isInteger(e.amountPaise) || e.amountPaise !== p.amount_paise) throw new HttpError(409, 'Amount mismatch', 'AMOUNT_MISMATCH');
    if (e.event !== 'SUCCESS') return { status: 202, body: { received: true, ignored: true } };
    return tx(db, () => {
      if (one('SELECT 1 FROM payment_events WHERE delivery_id=?', deliveryId)) return { body: { received: true, duplicate: true } };
      run('INSERT INTO payment_events(delivery_id,order_id) VALUES(?,?)', deliveryId, p.order_id);
      const cur = one('SELECT status FROM payments WHERE id=?', p.id).status;
      if (cur !== 'PENDING' && cur !== 'UNDER_REVIEW') return { body: { received: true, ignored: true, state: cur } }; // e.g. expired before the event arrived -> needs manual review
      settleInner(p.id, 'SUCCESS', { utr: typeof e.utr === 'string' ? e.utr.slice(0, 32) : null });
      return { body: { received: true } };
    });
  });

  // --- donor
  const donationOut = (r) => ({ id: r.id, amountPaise: r.amount_paise, currency: r.currency, status: r.status, simulated: !!r.simulated,
    createdAt: r.created_at, campaign: { title: r.title, slug: r.slug }, payment: r.pid ? { id: r.pid, orderId: r.order_id, utr: r.utr, provider: r.provider } : null });
  const DON_SELECT = `SELECT d.*, c.title, c.slug, p.id AS pid, p.order_id, p.utr, p.provider FROM donations d JOIN campaigns c ON c.id=d.campaign_id LEFT JOIN payments p ON p.donation_id=d.id`;
  R('GET', '/api/donor/dashboard', ['DONOR'], ({ user }) => {
    const s = one(`SELECT COALESCE(SUM(CASE WHEN status='SUCCESS' THEN amount_paise END),0) total, COUNT(CASE WHEN status='SUCCESS' THEN 1 END) n,
      COUNT(DISTINCT CASE WHEN status='SUCCESS' THEN campaign_id END) campaigns FROM donations WHERE donor_id=?`, user.id);
    return { body: { totalPaise: s.total, donations: s.n, campaignsSupported: s.campaigns,
      recent: q(`${DON_SELECT} WHERE d.donor_id=? ORDER BY d.id DESC LIMIT 5`, user.id).map(donationOut) } };
  });
  R('GET', '/api/donor/donations', ['DONOR'], ({ user, query }) => {
    const { p, size, off } = page(query); const w = ['d.donor_id=?']; const a = [user.id];
    if (query.status) { w.push('d.status=?'); a.push(oneOf(String(query.status).toUpperCase(), ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'], 'status')); }
    const where = ' WHERE ' + w.join(' AND ');
    return { body: { items: q(`${DON_SELECT}${where} ORDER BY d.id DESC LIMIT ? OFFSET ?`, ...a, size, off).map(donationOut),
      total: one(`SELECT COUNT(*) n FROM donations d${where}`, ...a).n, page: p, pageSize: size } };
  });
  R('GET', '/api/donations/:id', ['DONOR'], ({ params, user }) => {
    const r = one(`${DON_SELECT} WHERE d.id=? AND d.donor_id=?`, parseInt(params.id) || 0, user.id);
    if (!r) throw new HttpError(404, 'Donation not found'); return { body: { donation: donationOut(r) } };
  });
  R('GET', '/api/notifications', 'any', ({ user }) => ({ body: { items: q('SELECT id,type,message,is_read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', user.id).map((n) => ({ ...n, isRead: !!n.is_read })),
    unread: one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0', user.id).n } }));
  R('POST', '/api/notifications/read', 'any', ({ user }) => { run('UPDATE notifications SET is_read=1 WHERE user_id=?', user.id); return { body: { ok: true } }; });

  // --- charity
  R('GET', '/api/charity/dashboard', ['CHARITY'], ({ user }) => {
    const ch = myCharity(user);
    const s = one(`SELECT COUNT(*) total, COUNT(CASE WHEN c.status='ACTIVE' AND c.end_date>=? THEN 1 END) active FROM campaigns c WHERE c.charity_id=? AND c.archived_at IS NULL`, today(), ch.id);
    const d = one(`SELECT COALESCE(SUM(CASE WHEN d.status='SUCCESS' THEN amount_paise END),0) raised, COUNT(DISTINCT CASE WHEN d.status='SUCCESS' THEN donor_id END) donors
      FROM donations d JOIN campaigns c ON c.id=d.campaign_id WHERE c.charity_id=?`, ch.id);
    return { body: { charity: { id: ch.id, name: ch.name, status: ch.status, reviewNote: ch.review_note }, campaigns: s.total, activeCampaigns: s.active, raisedPaise: d.raised, donors: d.donors,
      recentCampaigns: q(`${CAMPAIGN_SELECT} WHERE c.charity_id=? AND c.archived_at IS NULL ORDER BY c.id DESC LIMIT 5`, ch.id).map((c) => campaignOut(c, { private: true })),
      recentDonations: q(`SELECT SUM(d.amount_paise) amount_paise, COUNT(*) donations, MAX(d.simulated) simulated, MAX(d.created_at) created_at, u.name
        FROM donations d JOIN campaigns c ON c.id=d.campaign_id JOIN users u ON u.id=d.donor_id
        WHERE c.charity_id=? AND d.status='SUCCESS'
        GROUP BY d.donor_id ORDER BY MAX(d.created_at) DESC, u.name LIMIT 8`, ch.id)
        .map((r) => ({ amountPaise: r.amount_paise, donations: r.donations, simulated: !!r.simulated, createdAt: r.created_at, donor: r.name.split(' ')[0] })) } };
  });
  R('GET', '/api/charity/profile', ['CHARITY'], ({ user }) => { const c = myCharity(user); return { body: { charity: { id: c.id, name: c.name, description: c.description, category: c.category, location: c.location, image: c.image, status: c.status, reviewNote: c.review_note } } }; });
  R('PATCH', '/api/charity/profile', ['CHARITY'], ({ user, body }) => {
    const c = myCharity(user);
    const n = { name: body.name !== undefined ? str(body.name, 'name', 3, 120) : c.name, description: body.description !== undefined ? str(body.description, 'description', 20, 2000) : c.description,
      category: body.category !== undefined ? oneOf(body.category, CATEGORIES, 'category') : c.category, location: body.location !== undefined ? str(body.location, 'location', 2, 100) : c.location,
      image: body.image !== undefined ? imageUrl(body.image) : c.image };
    const resubmit = c.status === 'REJECTED';
    run("UPDATE charities SET name=?,description=?,category=?,location=?,image=?,status=?,updated_at=datetime('now') WHERE id=?", n.name, n.description, n.category, n.location, n.image, resubmit ? 'PENDING' : c.status, c.id);
    if (resubmit) for (const a of q("SELECT id FROM users WHERE role='ADMIN'")) notify(a.id, 'APPROVAL', `Charity resubmitted for review: ${n.name}`);
    return { body: { ok: true, status: resubmit ? 'PENDING' : c.status } };
  });
  const parseCampaign = (b, base = {}) => {
    const m = { ...base };
    if (b.title !== undefined || !base.title) m.title = str(b.title, 'title', 5, 120);
    if (b.description !== undefined || !base.description) m.description = str(b.description, 'description', 20, 5000);
    if (b.category !== undefined || !base.category) m.category = oneOf(b.category, CATEGORIES, 'category');
    if (b.goal !== undefined || !base.goal_paise) m.goal_paise = rupeesToPaise(b.goal, 'goal', 100_000, 100_000_000_00);
    if (b.startDate !== undefined || !base.start_date) { if (!isDate(b.startDate)) throw bad('Start date is invalid', { field: 'startDate' }); m.start_date = b.startDate; }
    if (b.endDate !== undefined || !base.end_date) { if (!isDate(b.endDate)) throw bad('End date is invalid', { field: 'endDate' }); m.end_date = b.endDate; }
    if (m.end_date <= m.start_date) throw bad('End date must be after the start date', { field: 'endDate' });
    if (m.end_date < today()) throw bad('End date cannot be in the past', { field: 'endDate' });
    if (b.image !== undefined) m.image = imageUrl(b.image);
    return m;
  };
  const campaignUploads = (body) => ({
    image: profileUpload(body.campaignImage, 'campaignImage', ['image/jpeg', 'image/png', 'image/webp'], 1_000_000),
    document: profileUpload(body.campaignDocument, 'campaignDocument', ['image/jpeg', 'image/png', 'application/pdf'], 1_500_000),
  });
  R('POST', '/api/charity/campaigns', ['CHARITY'], ({ user, body }) => {
    const ch = myCharity(user);
    if (ch.archived_at || ch.status !== 'APPROVED') throw new HttpError(403, 'Your charity must be approved and active before you can create campaigns', 'CHARITY_NOT_APPROVED');
    const m = parseCampaign(body);
    const uploads = campaignUploads(body);
    if (!uploads.image) throw bad('Campaign image is required', { field: 'campaignImage' });
    if (!uploads.document) throw bad('Supporting document is required', { field: 'campaignDocument' });
    const status = body.submit ? 'PENDING' : 'DRAFT';
    const slug = slugify(m.title) + '-' + randomBytes(2).toString('hex');
    const id = Number(run(`INSERT INTO campaigns(charity_id,title,slug,description,category,goal_paise,start_date,end_date,image,status,
      image_data,image_type,document_data,document_type,document_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ch.id, m.title, slug, m.description, m.category, m.goal_paise, m.start_date, m.end_date, m.image ?? null, status,
      uploads.image.data, uploads.image.type, uploads.document.data, uploads.document.type, uploads.document.name).lastInsertRowid);
    if (status === 'PENDING') for (const a of q("SELECT id FROM users WHERE role='ADMIN'")) notify(a.id, 'APPROVAL', `Campaign submitted for review: ${m.title}`);
    return { status: 201, body: { id, slug, status } };
  });
  const ownCampaign = (user, id) => { const ch = myCharity(user); const c = one('SELECT * FROM campaigns WHERE id=? AND charity_id=? AND archived_at IS NULL', parseInt(id) || 0, ch.id); if (!c) throw new HttpError(404, 'Campaign not found'); return { ch, c }; };
  R('GET', '/api/charity/campaigns', ['CHARITY'], ({ user, query }) => {
    const ch = myCharity(user); const w = ['c.charity_id=?']; const a = [ch.id];
    if (query.status) { w.push('c.status=?'); a.push(oneOf(String(query.status).toUpperCase(), ['DRAFT', 'PENDING', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED'], 'status')); }
    w.push('c.archived_at IS NULL', 'ch.archived_at IS NULL');
    return { body: { items: q(`${CAMPAIGN_SELECT} WHERE ${w.join(' AND ')} ORDER BY c.id DESC`, ...a).map((c) => campaignOut(c, { private: true })) } };
  });
  R('GET', '/api/charity/campaigns/:id', ['CHARITY'], ({ user, params }) => {
    const { c } = ownCampaign(user, params.id); return { body: { campaign: campaignOut(one(`${CAMPAIGN_SELECT} WHERE c.id=?`, c.id), { private: true }) } };
  });
  R('PATCH', '/api/charity/campaigns/:id', ['CHARITY'], ({ user, params, body }) => {
    const { c } = ownCampaign(user, params.id);
    if (body.action) {
      if (body.action === 'pause') throw new HttpError(403, 'Only administrators can pause campaigns', 'FORBIDDEN');
      const t = { resume: ['PAUSED', 'ACTIVE'] }[body.action]; if (!t) throw bad('Unknown action');
      if (c.status !== t[0]) throw new HttpError(409, `Cannot ${body.action} a ${c.status} campaign`, 'INVALID_TRANSITION');
      if (body.action === 'resume' && c.review_note) throw new HttpError(403, 'This campaign was paused by an administrator', 'MODERATED');
      run("UPDATE campaigns SET status=?, updated_at=datetime('now') WHERE id=?", t[1], c.id); return { body: { status: t[1] } };
    }
    if (!['DRAFT', 'REJECTED', 'PENDING'].includes(c.status)) throw new HttpError(409, 'Approved campaigns can no longer be edited; post an update instead', 'LOCKED');
    const m = parseCampaign(body, c);
    const uploads = campaignUploads(body);
    if (!uploads.image && !(c.image_data || c.image)) throw bad('Campaign image is required', { field: 'campaignImage' });
    if (!uploads.document && !c.document_data) throw bad('Supporting document is required', { field: 'campaignDocument' });
    const status = body.submit ? 'PENDING' : c.status === 'PENDING' ? 'PENDING' : c.status;
    run(`UPDATE campaigns SET title=?,description=?,category=?,goal_paise=?,start_date=?,end_date=?,image=COALESCE(?,image),
      image_data=COALESCE(?,image_data),image_type=COALESCE(?,image_type),document_data=COALESCE(?,document_data),
      document_type=COALESCE(?,document_type),document_name=COALESCE(?,document_name),status=?,review_note=NULL,updated_at=datetime('now') WHERE id=?`,
      m.title, m.description, m.category, m.goal_paise, m.start_date, m.end_date, m.image ?? null,
      uploads.image?.data || null, uploads.image?.type || null, uploads.document?.data || null,
      uploads.document?.type || null, uploads.document?.name || null, status, c.id);
    if (status === 'PENDING' && c.status !== 'PENDING') {
      audit(user.id, 'CAMPAIGN_SUBMITTED', 'campaign', c.id, 'Campaign details completed and submitted for review');
      for (const a of q("SELECT id FROM users WHERE role='ADMIN'")) notify(a.id, 'APPROVAL', `Campaign submitted for review: ${m.title}`);
    }
    return { body: { status } };
  });
  R('POST', '/api/charity/campaigns/:id/updates', ['CHARITY'], ({ user, params, body }) => {
    const { c } = ownCampaign(user, params.id);
    if (!['ACTIVE', 'PAUSED', 'COMPLETED'].includes(c.status)) throw new HttpError(409, 'Updates can be posted once a campaign is live', 'INVALID_STATE');
    const t = str(body.title, 'title', 3, 120), b = str(body.body, 'body', 5, 3000);
    run('INSERT INTO campaign_updates(campaign_id,author_id,title,body) VALUES(?,?,?,?)', c.id, user.id, t, b);
    for (const d of q("SELECT DISTINCT donor_id FROM donations WHERE campaign_id=? AND status='SUCCESS'", c.id)) notify(d.donor_id, 'UPDATE', `New update on "${c.title}": ${t}`);
    return { status: 201, body: { ok: true } };
  });

  // --- admin
  const A = ['ADMIN'];
  R('GET', '/api/admin/dashboard', A, () => {
    const u = one("SELECT COUNT(*) n, COUNT(CASE WHEN role='DONOR' THEN 1 END) donors FROM users");
    return { body: { users: u.n, donors: u.donors, charities: one('SELECT COUNT(*) n FROM charities').n,
      pendingCharities: one("SELECT COUNT(*) n FROM charities WHERE status='PENDING'").n, pendingCampaigns: one("SELECT COUNT(*) n FROM campaigns WHERE status='PENDING'").n,
      activeCampaigns: one("SELECT COUNT(*) n FROM campaigns WHERE status='ACTIVE' AND end_date>=? AND archived_at IS NULL", today()).n,
      raisedPaise: one("SELECT COALESCE(SUM(amount_paise),0) s FROM donations WHERE status='SUCCESS'").s,
      byCategory: q(`SELECT c.category, COALESCE(SUM(d.amount_paise),0) raised FROM campaigns c LEFT JOIN donations d ON d.campaign_id=c.id AND d.status='SUCCESS' GROUP BY c.category ORDER BY raised DESC`),
      recentAudit: q('SELECT a.action, a.entity_type, a.entity_id, a.detail, a.created_at, u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 8') } };
  });
  R('GET', '/api/admin/users', A, ({ query }) => {
    const { p, size, off } = page(query); const w = ['1=1']; const a = [];
    if (query.q) { w.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')"); a.push(like(query.q), like(query.q)); }
    if (query.role) { w.push('role=?'); a.push(oneOf(query.role, ['DONOR', 'CHARITY', 'ADMIN'], 'role')); }
    if (query.status) { w.push('status=?'); a.push(oneOf(query.status, ['ACTIVE', 'DISABLED'], 'status')); }
    const where = ' WHERE ' + w.join(' AND ');
    return { body: { items: q(`SELECT id,name,email,role,status,created_at FROM users${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...a, size, off), total: one(`SELECT COUNT(*) n FROM users${where}`, ...a).n, page: p, pageSize: size } };
  });
  R('PATCH', '/api/admin/users/:id/status', A, ({ params, body, user }) => {
    const id = parseInt(params.id) || 0, status = oneOf(body.status, ['ACTIVE', 'DISABLED'], 'status');
    const t = one('SELECT * FROM users WHERE id=?', id); if (!t) throw new HttpError(404, 'User not found');
    if (t.id === user.id) throw new HttpError(409, 'You cannot change your own status', 'SELF_ACTION');
    if (t.role === 'ADMIN') throw new HttpError(403, 'Administrator accounts cannot be changed here', 'FORBIDDEN');
    tx(db, () => { run('UPDATE users SET status=? WHERE id=?', status, id); if (status === 'DISABLED') run('DELETE FROM sessions WHERE user_id=?', id); audit(user.id, 'USER_' + status, 'user', id, body.reason); });
    return { body: { ok: true } };
  });
  R('GET', '/api/admin/charities', A, ({ query }) => {
    const { p, size, off } = page(query); const w = ['1=1']; const a = [];
    if (query.status === 'ARCHIVED') w.push('ch.archived_at IS NOT NULL');
    else {
      w.push('ch.archived_at IS NULL');
      if (query.status) { w.push('ch.status=?'); a.push(oneOf(query.status, ['PENDING', 'APPROVED', 'REJECTED'], 'status')); }
    }
    if (query.q) { w.push("(ch.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')"); a.push(like(query.q), like(query.q)); }
    const where = ' WHERE ' + w.join(' AND ');
    return { body: { items: q(`SELECT ch.id,ch.name,ch.description,ch.category,ch.location,ch.status,ch.archived_at,ch.review_note,ch.created_at,u.name creator_name,u.email FROM charities ch JOIN users u ON u.id=ch.user_id${where} ORDER BY (ch.status='PENDING') DESC, ch.id DESC LIMIT ? OFFSET ?`, ...a, size, off),
      total: one(`SELECT COUNT(*) n FROM charities ch JOIN users u ON u.id=ch.user_id${where}`, ...a).n, page: p, pageSize: size } };
  });
  R('POST', '/api/admin/charities/:id/archive', A, ({ params, user }) => {
    const charity = one('SELECT * FROM charities WHERE id=?', parseInt(params.id) || 0);
    if (!charity) throw new HttpError(404, 'Charity not found');
    if (charity.archived_at) throw new HttpError(409, 'Charity is already archived', 'ALREADY_ARCHIVED');
    tx(db, () => {
      run("UPDATE charities SET archived_at=datetime('now'), updated_at=datetime('now') WHERE id=?", charity.id);
      run("UPDATE campaigns SET archived_at=COALESCE(archived_at,datetime('now')), updated_at=datetime('now') WHERE charity_id=?", charity.id);
      audit(user.id, 'CHARITY_ARCHIVED', 'charity', charity.id, 'Archived by administrator');
      notify(charity.user_id, 'MODERATION', `Your charity "${charity.name}" was archived by an administrator. Its public profile and campaigns are no longer available.`);
    });
    return { body: { archived: true } };
  });
  R('POST', '/api/admin/charities/:id/unarchive', A, ({ params, user }) => {
    const charity = one('SELECT * FROM charities WHERE id=?', parseInt(params.id) || 0);
    if (!charity) throw new HttpError(404, 'Charity not found');
    if (!charity.archived_at) throw new HttpError(409, 'Charity is not archived', 'NOT_ARCHIVED');
    tx(db, () => {
      run("UPDATE charities SET archived_at=NULL, updated_at=datetime('now') WHERE id=?", charity.id);
      audit(user.id, 'CHARITY_UNARCHIVED', 'charity', charity.id, 'Restored by administrator');
      notify(charity.user_id, 'MODERATION', `Your charity "${charity.name}" was restored by an administrator. Archived campaigns need to be restored separately.`);
    });
    const archivedCampaigns = one('SELECT COUNT(*) n FROM campaigns WHERE charity_id=? AND archived_at IS NOT NULL', charity.id).n;
    return { body: { archived: false, archivedCampaigns } };
  });
  R('POST', '/api/admin/charities/:id/permanent-delete', A, ({ params, user }) => {
    const charity = one('SELECT * FROM charities WHERE id=?', parseInt(params.id) || 0);
    if (!charity) throw new HttpError(404, 'Charity not found');
    const donationCount = one('SELECT COUNT(*) n FROM donations d JOIN campaigns c ON c.id=d.campaign_id WHERE c.charity_id=?', charity.id).n;
    if (donationCount) throw new HttpError(409, 'This charity has donation history. Archive it instead to preserve its records.', 'DONATION_HISTORY');
    tx(db, () => {
      const campaignIds = q('SELECT id FROM campaigns WHERE charity_id=?', charity.id).map((campaign) => campaign.id);
      for (const campaign of campaignIds) run('DELETE FROM campaign_updates WHERE campaign_id=?', campaign.id);
      run('DELETE FROM campaigns WHERE charity_id=?', charity.id);
      run('DELETE FROM notifications WHERE user_id=?', charity.user_id);
      run('DELETE FROM sessions WHERE user_id=?', charity.user_id);
      run('DELETE FROM charities WHERE id=?', charity.id);
      run('DELETE FROM users WHERE id=?', charity.user_id);
      audit(user.id, 'CHARITY_PERMANENTLY_DELETED', 'charity', charity.id, charity.name);
    });
    return { body: { deleted: true } };
  });
  const decide = (kind) => ({ params, body, user }) => {
    const table = kind === 'charity' ? 'charities' : 'campaigns'; const approve = body.__approve;
    const row = one(`SELECT * FROM ${table} WHERE id=?`, parseInt(params.id) || 0); if (!row) throw new HttpError(404, 'Not found');
    if (row.archived_at) throw new HttpError(409, `Archived ${kind}s cannot be reviewed`, 'INVALID_TRANSITION');
    if (row.status !== 'PENDING') throw new HttpError(409, `Already ${row.status.toLowerCase()}; no further decision is possible`, 'ALREADY_DECIDED');
    const reason = body.reason ? str(body.reason, 'reason', 3, 500) : null;
    if (!approve && !reason) throw bad('A reason is required when rejecting', { field: 'reason' });
    const next = kind === 'charity' ? (approve ? 'APPROVED' : 'REJECTED') : (approve ? 'ACTIVE' : 'REJECTED');
    tx(db, () => {
      run(`UPDATE ${table} SET status=?, review_note=?, updated_at=datetime('now') WHERE id=?`, next, reason, row.id);
      audit(user.id, `${kind.toUpperCase()}_${approve ? 'APPROVED' : 'REJECTED'}`, kind, row.id, reason);
      const owner = kind === 'charity' ? row.user_id : one('SELECT user_id FROM charities WHERE id=?', row.charity_id).user_id;
      const label = kind === 'charity' ? row.name : row.title;
      notify(owner, 'APPROVAL', `Your ${kind} "${label}" was ${approve ? 'approved' : 'rejected'}${reason ? ': ' + reason : '.'}`);
    });
    return { body: { status: next } };
  };
  R('POST', '/api/admin/charities/:id/approve', A, (c) => decide('charity')({ ...c, body: { ...c.body, __approve: true } }));
  R('POST', '/api/admin/charities/:id/reject', A, (c) => decide('charity')({ ...c, body: { ...c.body, __approve: false } }));
  R('POST', '/api/admin/campaigns/:id/approve', A, (c) => decide('campaign')({ ...c, body: { ...c.body, __approve: true } }));
  R('POST', '/api/admin/campaigns/:id/reject', A, (c) => decide('campaign')({ ...c, body: { ...c.body, __approve: false } }));
  R('POST', '/api/admin/campaigns/:id/pause', A, ({ params, body, user }) => {
    const c = one('SELECT * FROM campaigns WHERE id=?', parseInt(params.id) || 0); if (!c) throw new HttpError(404, 'Not found');
    if (c.archived_at) throw new HttpError(409, 'Archived campaigns cannot be paused', 'INVALID_TRANSITION');
    if (c.status !== 'ACTIVE') throw new HttpError(409, 'Only active campaigns can be paused', 'INVALID_TRANSITION');
    const reason = str(body.reason, 'reason', 3, 500);
    tx(db, () => { run("UPDATE campaigns SET status='PAUSED', review_note=?, resumed_at=NULL, updated_at=datetime('now') WHERE id=?", reason, c.id); audit(user.id, 'CAMPAIGN_PAUSED', 'campaign', c.id, reason);
      notify(one('SELECT user_id FROM charities WHERE id=?', c.charity_id).user_id, 'MODERATION', `Your campaign "${c.title}" was paused by an administrator: ${reason}`); });
    return { body: { status: 'PAUSED' } };
  });
  const archiveCampaign = ({ params, user }) => {
    const c = one('SELECT * FROM campaigns WHERE id=?', parseInt(params.id) || 0);
    if (!c) throw new HttpError(404, 'Campaign not found');
    if (c.archived_at) throw new HttpError(409, 'Campaign is already archived', 'ALREADY_ARCHIVED');
    tx(db, () => {
      run("UPDATE campaigns SET archived_at=datetime('now'), updated_at=datetime('now') WHERE id=?", c.id);
      audit(user.id, 'CAMPAIGN_ARCHIVED', 'campaign', c.id, 'Archived by administrator');
      notify(one('SELECT user_id FROM charities WHERE id=?', c.charity_id).user_id, 'MODERATION', `Your campaign "${c.title}" was removed from the platform by an administrator.`);
    });
    return { body: { archived: true } };
  };
  R('POST', '/api/admin/campaigns/:id/archive', A, archiveCampaign);
  R('POST', '/api/admin/campaigns/:id/delete', A, archiveCampaign);
  R('POST', '/api/admin/campaigns/:id/unarchive', A, ({ params, user }) => {
    const c = one('SELECT * FROM campaigns WHERE id=?', parseInt(params.id) || 0);
    if (!c) throw new HttpError(404, 'Campaign not found');
    if (!c.archived_at) throw new HttpError(409, 'Campaign is not archived', 'NOT_ARCHIVED');
    tx(db, () => {
      run("UPDATE campaigns SET archived_at=NULL, updated_at=datetime('now') WHERE id=?", c.id);
      audit(user.id, 'CAMPAIGN_UNARCHIVED', 'campaign', c.id, 'Restored by administrator');
      notify(one('SELECT user_id FROM charities WHERE id=?', c.charity_id).user_id, 'MODERATION', `Your campaign "${c.title}" was restored by an administrator.`);
    });
    return { body: { archived: false, charityArchived: !!one('SELECT archived_at FROM charities WHERE id=?', c.charity_id).archived_at } };
  });
  R('POST', '/api/admin/campaigns/:id/resume', A, ({ params, user }) => {
    const c = one('SELECT * FROM campaigns WHERE id=?', parseInt(params.id) || 0);
    if (!c) throw new HttpError(404, 'Campaign not found');
    if (c.archived_at) throw new HttpError(409, 'Archived campaigns cannot be resumed', 'INVALID_TRANSITION');
    if (c.status !== 'PAUSED') throw new HttpError(409, 'Only paused campaigns can be resumed', 'INVALID_TRANSITION');
    if (one('SELECT archived_at FROM charities WHERE id=?', c.charity_id).archived_at) throw new HttpError(409, 'Restore the charity before resuming its campaign', 'CHARITY_ARCHIVED');
    tx(db, () => {
      run("UPDATE campaigns SET status='ACTIVE', resumed_at=datetime('now'), updated_at=datetime('now') WHERE id=?", c.id);
      audit(user.id, 'CAMPAIGN_RESUMED', 'campaign', c.id, c.review_note);
      notify(one('SELECT user_id FROM charities WHERE id=?', c.charity_id).user_id, 'MODERATION', `Your campaign "${c.title}" was resumed by an administrator.`);
    });
    return { body: { status: 'ACTIVE', statusLabel: 'Campaign resumed' } };
  });
  R('GET', '/api/admin/campaigns/:id', A, ({ params }) => {
    const select = CAMPAIGN_SELECT
      .replace('SELECT c.*', 'SELECT c.*, owner.name AS creator_name, owner.email AS creator_email')
      .replace('FROM campaigns c JOIN charities ch ON ch.id=c.charity_id', 'FROM campaigns c JOIN charities ch ON ch.id=c.charity_id JOIN users owner ON owner.id=ch.user_id');
    const c = one(`${select} WHERE c.id=?`, parseInt(params.id) || 0);
    if (!c) throw new HttpError(404, 'Campaign not found');
    return { body: { campaign: { ...campaignOut(c, { private: true }), creator: { name: c.creator_name, email: c.creator_email } } } };
  });
  R('GET', '/api/admin/campaigns', A, ({ query }) => {
    const { p, size, off } = page(query); const w = ['1=1']; const a = [];
    if (query.status === 'ARCHIVED') w.push('c.archived_at IS NOT NULL');
    else {
      w.push('c.archived_at IS NULL');
      if (query.status) { w.push('c.status=?'); a.push(oneOf(query.status, ['DRAFT', 'PENDING', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED'], 'status')); }
    }
    if (query.q) { w.push("c.title LIKE ? ESCAPE '\\'"); a.push(like(query.q)); }
    if (query.charityId) { w.push('c.charity_id=?'); a.push(parseInt(query.charityId) || 0); }
    if (query.from && isDate(query.from)) { w.push('date(c.created_at)>=?'); a.push(query.from); }
    if (query.to && isDate(query.to)) { w.push('date(c.created_at)<=?'); a.push(query.to); }
    const where = ' WHERE ' + w.join(' AND ');
    const adminCampaignSelect = CAMPAIGN_SELECT
      .replace('SELECT c.*', 'SELECT c.*, owner.name AS creator_name, owner.email AS creator_email')
      .replace('FROM campaigns c JOIN charities ch ON ch.id=c.charity_id', 'FROM campaigns c JOIN charities ch ON ch.id=c.charity_id JOIN users owner ON owner.id=ch.user_id');
    const items = q(`${adminCampaignSelect}${where} ORDER BY (c.status='PENDING') DESC, c.id DESC LIMIT ? OFFSET ?`, ...a, size, off).map((c) => {
      const campaign = campaignOut(c, { private: true });
      campaign.creator = { name: c.creator_name, email: c.creator_email };
      campaign.supporters = q(`SELECT u.id,u.name,SUM(d.amount_paise) amount_paise,COUNT(*) donations,MAX(d.created_at) last_donation_at,
        MIN(d.simulated) simulated FROM donations d JOIN users u ON u.id=d.donor_id
        WHERE d.campaign_id=? AND d.status='SUCCESS' GROUP BY d.donor_id ORDER BY MAX(d.created_at) DESC,u.name`, c.id)
        .map((d) => ({ id: d.id, name: d.name, amountPaise: d.amount_paise, donations: d.donations, lastDonationAt: d.last_donation_at, simulated: !!d.simulated }));
      return campaign;
    });
    return { body: { items,
      total: one(`SELECT COUNT(*) n FROM campaigns c${where}`, ...a).n, page: p, pageSize: size } };
  });
  R('GET', '/api/admin/donations', A, ({ query }) => {
    const { p, size, off } = page(query); const w = ['1=1']; const a = [];
    if (query.status) { w.push('d.status=?'); a.push(oneOf(String(query.status).toUpperCase(), ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'], 'status')); }
    const where = ' WHERE ' + w.join(' AND ');
    return { body: { items: q(`${DON_SELECT}${where} ORDER BY d.id DESC LIMIT ? OFFSET ?`, ...a, size, off).map(donationOut), total: one(`SELECT COUNT(*) n FROM donations d${where}`, ...a).n, page: p, pageSize: size } };
  });
  R('GET', '/api/admin/reports', A, ({ query }) => {
    const from = isDate(query.from) ? query.from : '0000-01-01', to = isDate(query.to) ? query.to : '9999-12-31';
    return { body: {
      definition: 'Verified = SUCCESS via a real provider; simulated = SUCCESS via demo mode. Pending/failed/cancelled/expired are never counted as contributions. Refunded amounts are excluded.',
      donationsByStatus: q(`SELECT status, simulated, COUNT(*) count, COALESCE(SUM(amount_paise),0) paise FROM donations WHERE date(created_at) BETWEEN ? AND ? GROUP BY status, simulated ORDER BY status`, from, to),
      campaignPerformance: q(`SELECT c.id, c.title, c.status, c.goal_paise, ${RAISED} raised_paise, ${DONORS} donors FROM campaigns c ORDER BY raised_paise DESC LIMIT 25`),
      approvalQueues: { charities: one("SELECT COUNT(*) n FROM charities WHERE status='PENDING'").n, campaigns: one("SELECT COUNT(*) n FROM campaigns WHERE status='PENDING'").n },
      usersByRole: q('SELECT role, status, COUNT(*) count FROM users GROUP BY role, status ORDER BY role') } };
  });
  R('GET', '/api/admin/audit', A, () => ({ body: { items: q('SELECT a.id,a.action,a.entity_type,a.entity_id,a.detail,a.created_at,u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100') } }));

  /* ----- plumbing ----- */
  function cookie(req, name) { const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '=')); return m ? m.slice(name.length + 1) : null; }
  const readBody = (req, maxBytes = 100_000) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > maxBytes) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    const origin = req.headers.origin;
    let trustedFrontend = false;
    if (origin && frontendOrigin) {
      try { trustedFrontend = new URL(origin).origin === frontendOrigin; } catch { trustedFrontend = false; }
    }
    if (trustedFrontend) {
      res.setHeader('Access-Control-Allow-Origin', frontendOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      if (!trustedFrontend) return send(403, { error: { code: 'CORS', message: 'Origin not allowed' } });
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204); return res.end();
    }
    try {
      const route = routes.map((r) => ({ r, m: r.method === req.method && url.pathname.match(r.re) })).find((x) => x.m);
      if (!route) { if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'Method not allowed'); throw new HttpError(404, 'Not found'); }
      const { r, m } = route; const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      const isHook = url.pathname === '/api/payments/webhooks/youpi';
      if (mutating && !isHook) {
        let sameOrigin = false;
        if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
        if (origin && !sameOrigin && !trustedFrontend) throw new HttpError(403, 'Cross-origin request blocked', 'CSRF');
      }
      let user = null;
      const tok = cookie(req, 'cc_sid');
      if (tok) {
        const s = one('SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?', sha(tok));
        if (s && s.expires_at > Date.now() && s.status === 'ACTIVE') user = s;
      }
      if (r.auth) {
        if (!user) throw new HttpError(401, 'Please log in', 'UNAUTHENTICATED');
        if (Array.isArray(r.auth) && !r.auth.includes(user.role)) throw new HttpError(403, 'You do not have access to this resource', 'FORBIDDEN');
      }
      const uploadRoute = url.pathname === '/api/profile' || /^\/api\/charity\/campaigns(?:\/\d+)?$/.test(url.pathname);
      const raw = mutating ? await readBody(req, uploadRoute ? 4_000_000 : 100_000) : Buffer.alloc(0); let body = {};
      if (mutating && !isHook && raw.length) {
        if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'JSON required');
        try { body = JSON.parse(raw.toString('utf8')); } catch { throw bad('Malformed JSON'); }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('JSON object required');
      }
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await r.handler({ req, res, user, params, query: Object.fromEntries(url.searchParams), body, raw });
      if (out.binary) {
        res.writeHead(out.status || 200, { 'Content-Type': out.contentType, 'Cache-Control': out.cacheControl || 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(out.binary);
      }
      send(out.status || 200, out.body);
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: { code: e.code, message: e.message, details: e.details } });
      console.error('Unhandled error:', e.message); send(500, { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
    }
  }
  async function serveStatic(pathname, res) {
    let rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || !extname(rel)) rel = '/index.html';
    try { const data = await readFile(join(PUBLIC_DIR, rel)); res.writeHead(200, { 'Content-Type': MIME[extname(rel)] || 'application/octet-stream' }); res.end(data); }
    catch { res.writeHead(404); res.end('Not found'); }
  }
  const handler = (req, res) => handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  const server = http.createServer(handler);
  return { server, db, handler, close: () => { server.close(); db.close(); } };
}
