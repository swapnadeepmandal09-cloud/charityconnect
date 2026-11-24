/* CharityConnect SPA - no framework, no build step. */
const $app = document.getElementById('app');
const API_BASE = String(globalThis.CHARITYCONNECT_API_URL || '').replace(/\/+$/, '');
const APP_BASE = new URL('.', import.meta.url);
const assetUrl = (path) => new URL(String(path).replace(/^\/+/, ''), APP_BASE).href;
const imageUrl = (path) => {
  if (/^(https?:|data:)/.test(path)) return path;
  if (path.startsWith('/api/')) return API_BASE + path;
  return assetUrl(path);
};
const FAVORITES_KEY = 'charityconnect:savedCampaigns';
function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    if (!Array.isArray(saved) || saved.some((slug) => typeof slug !== 'string')) throw new Error('Saved campaigns are invalid');
    return new Set(saved);
  } catch (error) {
    console.warn('Could not load saved campaigns:', error);
    return new Set();
  }
}
const S = { user: null, charity: null, unread: 0, meta: { categories: [], paymentMode: 'demo' }, timer: null, favorites: loadFavorites() };
const ICON = { Education: '📚', Health: '🩺', 'Child Welfare': '🧒', Environment: '🌳', 'Food & Community': '🍲', 'Animal Welfare': '🐾', 'Water & Sanitation': '💧' };
const INDIAN_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (p) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fdate = (s) => (s ? new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const causePhoto = (cat) => ({
  Education: '/images/causes/education.jpg',
  Health: '/images/campaigns/doctor-consultation.jpg',
  'Child Welfare': '/images/causes/children.jpg',
  Environment: '/images/causes/environment.jpg',
  'Food & Community': '/images/causes/food.jpg',
  'Animal Welfare': '/images/causes/animals.jpg',
  'Water & Sanitation': '/images/campaigns/water-tower.jpg',
}[cat] || '/images/causes/community.jpg');
const CAMPAIGN_PHOTOS = {
  'clean-water-for-rural-schools': '/images/campaigns/clean-water-schools.jpg',
  'school-water-tanks': '/images/campaigns/school-water.jpg',
  'school-library-project': '/images/campaigns/library.jpg',
  'digital-classrooms': '/images/campaigns/classroom.jpg',
  'plant-10000-trees': '/images/campaigns/plant-tress.jpg',
  'winter-shelter-for-dogs': '/images/campaigns/street-dog.jpg',
  'food-relief-program': '/images/campaigns/food-relief.png',
  'nutrition-for-children': '/images/campaigns/hungry-children.jpg',
  'mobile-health-camps': '/images/campaigns/health-screening.jpg',
  'river-cleanup-drive': '/images/campaigns/river.jpg',
  'old-art-supplies': '/images/campaigns/poor-children-drawing.jpg',
  'emergency-recovery-after-road-accident': '/images/campaigns/road-accident.jpg',
  'pune-community-screenings': '/images/campaigns/com-health.jpg',
  'assam-maternal-health-outreach': '/images/campaigns/maternal-health.jpg',
  'varanasi-rural-health-visits': '/images/campaigns/rural-health-visits.jpg',
  'kochi-treatment-travel-support': '/images/campaigns/treatment-travel.jpg',
  'dialysis-support-for-elderly': '/images/campaigns/dialysis-support.jpg',
  'post-surgery-transport-support': '/images/campaigns/surgery-transport.jpg',
  'cancer-drug-support-for-families': '/images/campaigns/cancer.webp',
  'women-health-clinic-expansion': '/images/campaigns/women-health-clinic.jpg',
  'rural-teleconsultations-in-odisha': '/images/campaigns/rural-consultation.jpg',
};
const campaignPhoto = (campaign) => CAMPAIGN_PHOTOS[campaign.slug] || campaign.image || causePhoto(campaign.category);
const badge = (s, extra = '') => `<span class="badge b-${esc(s)}">${esc(String(s).replace('_', ' '))}</span>${extra}`;
const verifiedBadge = () => '<span class="verified-mark" aria-label="Verified charity"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 1.5 13 3.4v3.3c0 3.1-2.1 5.7-5 7.8-2.9-2.1-5-4.7-5-7.8V3.4L8 1.5Z"/><path d="m5.4 7.7 1.7 1.7 3.6-3.7"/></svg>Verified</span>';
const sim = (on) => (on ? ' <span class="badge b-SIMULATED" title="Demo data: not a real transaction">SIMULATED</span>' : '');
const fallback = (cat) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#EAF6F2"/><stop offset="1" stop-color="#bfe6d6"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="320" y="210" font-size="110" text-anchor="middle">${ICON[cat] || '💚'}</text></svg>`);
const pic = (src, cat, alt, cls = 'pic') => `<img class="${cls}" src="${esc(imageUrl(src || causePhoto(cat)))}" data-fb="${esc(fallback(cat))}" alt="${esc(alt)}" loading="lazy">`;
document.addEventListener('error', (e) => { const t = e.target; if (t.tagName === 'IMG' && t.dataset.fb && t.src !== t.dataset.fb) t.src = t.dataset.fb; }, true);

async function api(method, path, body) {
  let res;
  try { res = await fetch(API_BASE + '/api' + path, { method, credentials: API_BASE ? 'include' : 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw Object.assign(new Error('Network error. Check your connection and try again.'), { status: 0 }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || 'Request failed'), { status: res.status, field: data.error?.details?.field, code: data.error?.code });
  return data;
}
function toast(msg, bad) { const t = document.getElementById('toast'), d = document.createElement('div'); d.textContent = msg; if (bad) d.className = 'bad'; t.append(d); setTimeout(() => d.remove(), 4500); }
function openReasonDialog(endpoint) {
  const isPause = endpoint.endsWith('/pause');
  const dialog = document.createElement('dialog');
  dialog.className = 'reason-dialog';
  dialog.innerHTML = `<form data-reason-form><h2>${isPause ? 'Pause campaign' : 'Record decision reason'}</h2><p>${isPause ? 'Explain why this campaign must be paused. The reason is recorded and shared with the charity.' : 'Provide a clear reason. The decision and reason are recorded and shared with the organisation.'}</p><label for="admin-action-reason">Reason <span aria-hidden="true">*</span></label><textarea id="admin-action-reason" name="reason" required minlength="3" maxlength="500" rows="4" placeholder="Enter a specific, factual reason"></textarea><div class="alert bad" role="alert" data-reason-error hidden></div><div class="reason-actions"><button type="button" class="btn ghost" data-close-reason>Cancel</button><button type="submit" class="btn">${isPause ? 'Pause campaign' : 'Submit decision'}</button></div></form>`;
  dialog.querySelector('form').dataset.endpoint = endpoint;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  dialog.querySelector('textarea').focus();
}
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
const loading = (n = 3) => `<div class="grid">${'<div class="skel"></div>'.repeat(n)}</div>`;
const errBox = (e) => `<div class="alert bad" role="alert">${esc(e.message)} <button class="btn sm ghost" data-act="reload">Retry</button></div>`;

/* ---------- shared components ---------- */
const LOGO = `<img src="${assetUrl('/brand-icon-192.png')}" alt="" aria-hidden="true"><span class="brand-charity">charity</span><span class="brand-connect">connect</span>`;
const home = () => (!S.user ? '/login' : { DONOR: '/donor', CHARITY: '/charity', ADMIN: '/admin' }[S.user.role]);
function header(path) {
  const on = (p) => (path === p || (p !== '/' && path.startsWith(p)) ? 'on' : '');
  return `<header class="hdr" id="hdr"><div class="wrap"><a class="logo" href="#/">${LOGO}</a>
  <nav class="nav" aria-label="Main"><a class="${on('/campaigns')}" href="#/campaigns">Explore campaigns</a><a href="#/?section=how-it-works">How it works</a><a class="${on('/about')}" href="#/about">About us</a></nav>
  <div class="right">${S.user ? `<a class="btn ghost sm" href="#${home()}">My dashboard</a><button class="btn sm" data-act="logout">Log out</button>` : `<a class="login-link" href="#/login">Log in</a><a class="btn header-join" href="#/register?type=CHARITY">Join Us</a>`}</div></div></header>`;
}
const footer = () => `<footer class="ft"><div class="wrap"><div class="ft-columns">
  <div class="ft-brand"><a class="logo" href="#/">${LOGO}</a><p>Helping good causes find the people who care about them.</p><a class="ft-inline-link" href="#/charities">Find a verified charity <span aria-hidden="true">→</span></a></div>
  <div><h3>Causes</h3>${[['Health', 'Medical support'], ['Education', 'Education'], ['Child Welfare', 'Child welfare'], ['Environment', 'Environment'], ['Animal Welfare', 'Animal welfare']].map(([value, label]) => `<a href="#/campaigns?category=${encodeURIComponent(value)}">${label}</a>`).join('')}</div>
  <div><h3>Get involved</h3><a href="#/register?type=CHARITY">Start a fundraiser</a><a href="#/?section=how-it-works">How it works</a><a href="#/campaigns">Browse campaigns</a><a href="#/charities">Our community</a></div>
  <div><h3>CharityConnect</h3><a href="#/about?section=about">About us</a><a href="#/about?section=trust">Trust &amp; safety</a><a href="#/about?section=demo-payments">Demo payments</a><a class="btn sm ghost" href="#/login?role=ADMIN">Admin Login</a></div>
  <div><h3>Contact us</h3><a href="tel:+919876543210">+91 98765 43210</a><a href="mailto:hello@charityconnect.example">hello@charityconnect.example</a><span>123 Seva Marg, Ludhiana, Punjab 141001, India</span></div>
  </div><div class="ft-bottom"><small>Copyright © 2026 CharityConnect. All rights reserved.</small><span>Demo contributions are simulated. No real money moves.</span></div></div></footer>`;
const pub = (path, html) => `${header(path)}<main id="main">${html}</main>${footer()}`;

const MENUS = {
  DONOR: [['/donor', 'Dashboard'], ['/campaigns', 'Campaigns'], ['/donor/donations', 'My Donations'], ['/notifications', 'Notifications'], ['/profile', 'Profile']],
  CHARITY: [['/charity', 'Dashboard'], ['/charity/profile', 'My Profile'], ['/charity/campaigns', 'My Campaigns'], ['/charity/campaigns/new', 'Create Campaign'], ['/charity/share', 'Share / QR'], ['/notifications', 'Notifications']],
  ADMIN: [['/admin', 'Dashboard'], ['/admin/users', 'Users'], ['/admin/charities', 'Charities'], ['/admin/campaigns', 'Campaigns'], ['/admin/donations', 'Donations'], ['/admin/reports', 'Reports'], ['/notifications', 'Notifications']],
};
function dash(path, html) {
  const links = MENUS[S.user.role].map(([p, l]) => `<a href="#${p}" class="${path === p ? 'on' : ''}">${l}${p === '/notifications' && S.unread ? ` (${S.unread})` : ''}</a>`).join('');
  const notificationLabel = S.unread ? `Notifications, ${S.unread} unread` : 'Notifications, all caught up';
  return `<div class="shell" id="shell"><button class="side-backdrop" data-act="menu" aria-label="Close dashboard menu" tabindex="-1"></button><aside class="side" id="dashboard-sidebar" aria-label="Dashboard"><a class="logo" href="#/">${LOGO}</a><nav>${links}<a href="#/">← Public site</a><a href="#" data-act="logout">Logout</a></nav></aside>
  <div><div class="top"><button class="btn ghost sm menu-btn" data-act="menu" aria-label="Open dashboard menu" aria-controls="dashboard-sidebar" aria-expanded="false">☰ Menu</button><a class="notification-link${path === '/notifications' ? ' is-current' : ''}" href="#/notifications" aria-label="${notificationLabel}"${path === '/notifications' ? ' aria-current="page"' : ''}><span class="notification-link-label">Notifications</span>${S.unread ? `<span class="notification-count" aria-hidden="true">${S.unread > 99 ? '99+' : S.unread}</span>` : '<span class="notification-status" aria-hidden="true"></span>'}</a><span><b>${esc(S.user.name)}</b> <span class="hint">${S.user.role.toLowerCase()}</span></span></div>
  <main id="main" class="content">${html}</main></div></div>`;
}
function ccard(c) {
  const days = c.daysLeft === 1 ? '1 day left' : `${c.daysLeft} days left`;
  const saved = S.favorites.has(c.slug);
  return `<article class="card ccard"><div class="campaign-cover">${pic(campaignPhoto(c), c.category, c.title)}<span class="campaign-tag">${esc(c.category)}</span><button type="button" class="campaign-save" data-fav="${esc(c.slug)}" aria-label="${saved ? 'Remove saved campaign' : 'Save campaign'}: ${esc(c.title)}" aria-pressed="${saved}">${saved ? '♥' : '♡'}</button></div><div class="body">
  <div class="campaign-charity">${esc(c.charity.name)}${c.charity.verified ? verifiedBadge() : ''}</div><h3>${esc(c.title)}</h3>
  <div class="campaign-meta">${esc(c.charity.location)}<span aria-hidden="true">·</span>${c.effectiveStatus === 'ACTIVE' ? days : esc(c.effectiveStatus.toLowerCase())}</div>
  <div class="prog" role="progressbar" aria-valuenow="${c.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Funding progress"><i style="width:${c.percent}%"></i></div>
  <div class="campaign-raised"><b>${inr(c.raisedPaise)}</b><span>${c.percent}%</span></div><div class="campaign-goal">raised of ${inr(c.goalPaise)}</div>
  <a class="btn ghost" href="#/campaigns/${esc(c.slug)}">View campaign <span aria-hidden="true">→</span></a></div></article>`;
}
function pager(total, page, size) {
  const pages = Math.ceil(total / size); if (pages <= 1) return '';
  return `<nav class="pager" aria-label="Pagination"><button class="btn ghost sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Prev</button><span class="hint" style="align-self:center">Page ${page} of ${pages} · ${total} results</span><button class="btn ghost sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next →</button></nav>`;
}
const opts = (list, sel, all) => `<option value="">${all}</option>` + list.map((x) => `<option ${x === sel ? 'selected' : ''} value="${esc(x)}">${esc(x)}</option>`).join('');
const need = (...roles) => { if (!S.user) { location.hash = '#/login'; return false; } if (!roles.includes(S.user.role)) { location.hash = '#' + home(); return false; } return true; };

/* ---------- pages: public ---------- */
const pages = {};
pages.home = async (path) => {
  const [health, education, environment, stats, stories] = await Promise.all([
    api('GET', '/campaigns?live=1&category=Health&pageSize=50&sort=progress'),
    api('GET', '/campaigns?live=1&category=Education&pageSize=1&sort=progress'),
    api('GET', '/campaigns?live=1&category=Environment&pageSize=1&sort=progress'),
    api('GET', '/public/stats'),
    api('GET', '/campaigns/success-stories?pageSize=3'),
  ]);
  const featuredCampaigns = [
    health.items.find((campaign) => campaign.slug === 'women-health-clinic-expansion') || health.items[0],
    education.items[0],
    environment.items[0],
  ].filter(Boolean);
  return pub(path, `<section class="hero"><div class="wrap hero-layout"><div class="hero-copy"><span class="hero-kicker"><span aria-hidden="true">✧</span> Small acts. Lasting change.</span><h1>Support a cause.<br><span>Make a difference.</span></h1>
  <p>Discover verified local initiatives, give with confidence, and follow the impact your support creates.</p>
  <div class="row"><a class="btn hero-primary" href="#/campaigns">Explore campaigns <span aria-hidden="true">→</span></a><a class="btn hero-secondary" href="#/register?type=CHARITY">Start a fundraiser</a></div>
  <div class="hero-trust"><span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z"/><path d="m8.7 12 2.2 2.2 4.5-4.6"/></svg>Verified charities</span><span><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16 9"/></svg>Secure &amp; transparent</span></div></div>
  <div class="hero-visual"><img src="${assetUrl('/images/causes/children.jpg')}" alt="Children smiling together in their community" fetchpriority="high"><aside class="hero-impact" aria-label="Community giving this month"><div class="hero-impact-copy"><span class="impact-label">This month, our community has given</span><p class="impact-total">${inr(stats.amountPaise)}</p>${S.meta.paymentMode === 'demo' ? '<span class="impact-note demo-label">Simulated demo data</span>' : ''}</div><div class="hero-impact-community"><div class="supporter-stack" aria-hidden="true"><span></span><span></span><span></span><b>+${stats.contributors}</b></div><span class="impact-note">${stats.contributors} ${stats.contributors === 1 ? 'supporter' : 'supporters'}</span></div></aside></div></div></section>
  <section class="sec causes"><div class="wrap"><div class="causes-heading"><div><span class="section-label">Make an impact</span><h2>Causes that need<br><em>you right now.</em></h2></div><a href="#/campaigns">View all campaigns <span aria-hidden="true">→</span></a></div>
  ${featuredCampaigns.length ? `<div class="grid">${featuredCampaigns.map(ccard).join('')}</div>` : '<div class="empty">No live campaigns yet.</div>'}</div></section>
  <section class="sec success-stories" aria-labelledby="success-stories-heading"><div class="wrap"><div class="causes-heading"><div><span class="section-label">Impact worth sharing</span><h2 id="success-stories-heading">Success stories.</h2><p>Fundraising has ended for these campaigns, which reached 90–100% of their goal.</p></div></div>
  ${stories.items.length ? `<div class="grid">${stories.items.map(ccard).join('')}</div>` : '<div class="empty">No completed campaigns have reached 90% of their goal yet.</div>'}</div></section>
  <section class="sec how-section" id="how-it-works"><div class="wrap how-layout"><div class="how-photo"><img src="${assetUrl('/images/causes/food.jpg')}" alt="Volunteers sorting food boxes for community distribution"><span>Real people.<br>Real impact.</span></div><div class="how-copy"><span class="section-label">Simple by design</span><h2>Good things happen<br><em>when we connect.</em></h2><div class="how-steps"><article><span>01</span><div><h3>Find a cause you care about</h3><p>Explore verified campaigns from people and organisations creating change.</p></div></article><article><span>02</span><div><h3>Make a contribution</h3><p>Choose a campaign and follow the available payment steps.</p></div></article><article><span>03</span><div><h3>See your impact unfold</h3><p>Follow campaign updates and review your donation history.</p></div></article></div><a class="how-link" href="#/about">Learn more about how it works <span aria-hidden="true">→</span></a></div></div></section>
  <section class="sec trust-section" id="trust"><div class="wrap"><div class="trust-heading"><span class="section-label">Giving with clarity</span><h2>Confidence at every step.</h2><p>See how CharityConnect handles review, records and demo payments.</p></div><div class="trust-grid"><article><span class="trust-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z"/><path d="m8.7 12 2.2 2.2 4.5-4.6"/></svg></span><h3>Reviewed before listing</h3><p>Charities and campaigns require administrator approval before public listing.</p><a href="#/charities">Find approved charities <span aria-hidden="true">→</span></a></article><article><span class="trust-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16 9"/></svg></span><h3>Totals based on success</h3><p>Campaign totals include only donations recorded with a successful status.</p><a href="#/campaigns">Explore campaigns <span aria-hidden="true">→</span></a></article><article><span class="trust-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8m-8 4h5"/></svg></span><h3>Demo payments stay simulated</h3><p>In demo mode no money moves, and simulated transactions are clearly labelled.</p><a href="#/about">Read about payments <span aria-hidden="true">→</span></a></article></div></div></section>`);
};
pages.about = async (path) => pub(path, `<section class="about-hero" id="about-intro"><div class="wrap about-hero-layout"><div><span class="section-label">About CharityConnect</span><h1>Good intentions deserve <em>a clear path.</em></h1><p>We bring people and causes together with a straightforward way to discover campaigns, contribute, and keep up with what happens next.</p><div class="row"><a class="btn hero-primary" href="#/campaigns">Explore campaigns <span aria-hidden="true">→</span></a><a class="about-text-link" href="#/register?type=CHARITY">For charities <span aria-hidden="true">↗</span></a></div></div><div class="about-hero-photo"><img src="${assetUrl('/images/causes/children.jpg')}" alt="Children smiling together in their community"><span>People first.<br>Progress in view.</span></div></div></section>
<section class="about-journey"><div class="wrap"><div class="about-section-heading"><span class="section-label">A simple way to take part</span><h2>From discovery to follow-through.</h2><p>Every step is designed to be easy to understand.</p></div><div class="about-steps"><article><span>01</span><div><h3>Find a cause that matters to you</h3><p>Browse active campaigns and learn about the charities and communities behind them.</p></div></article><article><span>02</span><div><h3>Contribute with clarity</h3><p>Choose an active campaign and follow the contribution flow. Your account keeps a record of its status.</p></div></article><article><span>03</span><div><h3>Stay close to the work</h3><p>Return to your dashboard to review donation history and read campaign updates.</p></div></article></div></div></section>
<section class="about-assurance" id="trust"><div class="wrap about-assurance-layout"><div><span class="section-label">Built around transparency</span><h2>Know what is real.<br><em>Know what happens next.</em></h2><p>Charities and campaigns are reviewed by an administrator before public listing. Donation records show their status, so an unsuccessful or pending payment is never presented as a completed contribution.</p><a class="how-link" href="#/?section=trust">See our trust commitments <span aria-hidden="true">→</span></a></div><aside class="about-notice" id="demo-payments"><span class="about-notice-mark" aria-hidden="true">i</span><div><h3>${S.meta.paymentMode === 'demo' ? 'Demo mode is active' : 'Payment status is confirmed'}</h3><p>${S.meta.paymentMode === 'demo' ? 'Contributions are simulated. No real money moves, and demo records are labelled throughout the site.' : 'Payments are confirmed only after a verified provider webhook reports success.'}</p><small>Charities, campaigns and people in this demo are fictional. This project is not a regulated payment aggregator or production-certified.</small></div></aside></div></section>
<section class="about-close"><div class="wrap"><span class="section-label">Ready when you are</span><h2>Find the work you want to support.</h2><a class="btn hero-primary" href="#/campaigns">Browse campaigns <span aria-hidden="true">→</span></a></div></section>`);
pages.campaigns = async (path, q) => {
  const d = await api('GET', '/campaigns' + qs({ q: q.q, category: q.category, location: q.location, sort: q.sort, status: q.status, page: q.page, pageSize: 9 }));
  return pub(path, `<div class="wrap sec"><h1>Campaigns</h1><form class="filters" data-filter="/campaigns" role="search"><input name="q" value="${esc(q.q)}" placeholder="Search campaigns or charities" aria-label="Search"><select name="category" aria-label="Category">${opts(S.meta.categories, q.category, 'All causes')}</select>
  <select name="location" aria-label="Location">${opts(d.locations, q.location, 'All locations')}</select><select name="status" aria-label="Status">${opts(['ACTIVE', 'COMPLETED'], q.status, 'Any status')}</select><select name="sort" aria-label="Sort"><option value="">Newest</option><option value="progress" ${q.sort === 'progress' ? 'selected' : ''}>Most funded</option><option value="ending" ${q.sort === 'ending' ? 'selected' : ''}>Ending soon</option></select>
  <button class="btn">Search</button><a class="btn ghost" href="#/campaigns">Clear</a></form>
  ${d.items.length ? `<div class="grid">${d.items.map(ccard).join('')}</div>${pager(d.total, d.page, d.pageSize)}` : '<div class="empty card">No campaigns match your filters.</div>'}</div>`);
};
pages.campaign = async (path, q, [slug]) => {
  const { campaign: c, updates, recentDonations, donatable } = await api('GET', '/campaigns/' + encodeURIComponent(slug));
  const mine = S.user?.role === 'DONOR';
  const form = donatable ? (mine ? `<form data-form="donate" data-id="${c.id}"><h3>Make a donation</h3><label for="amt">Amount (₹)</label><input id="amt" name="amount" type="number" inputmode="decimal" min="${S.meta.minDonationPaise / 100}" max="${S.meta.maxDonationPaise / 100}" step="0.01" placeholder="Enter amount" required>
    <div class="chips">${[500, 1000, 2500, 5000].map((a) => `<button type="button" class="chip" data-amt="${a}">₹${a.toLocaleString('en-IN')}</button>`).join('')}</div><p class="hint">Minimum ₹${S.meta.minDonationPaise / 100}. After you press Donate you'll see a payment page; the donation only counts once the server records a successful payment.${S.meta.paymentMode === 'demo' ? ' <b>Demo mode: payments are simulated.</b>' : ''}</p>
    <button class="btn block">Donate</button></form>` : S.user ? `<div class="alert info">Only donor accounts can donate.</div>` : `<a class="btn block" href="#/login">Log in to donate</a><p class="hint">New here? <a href="#/register">Create a free donor account</a>.</p>`)
    : c.isSuccessStory ? `<div class="alert info">The fundraising period has ended with ${c.percent}% of the goal raised. Thank you to everyone who supported this campaign.</div>`
      : c.effectiveStatus === 'SCHEDULED' ? `<div class="alert info">This campaign starts on ${fdate(c.startDate)} and will accept donations then.</div>`
        : `<div class="alert">This campaign is ${esc(c.effectiveStatus.toLowerCase())} and is not accepting donations.</div>`;
  return pub(path, `<div class="wrap sec"><a href="#/campaigns">← Back to campaigns</a><div class="two" style="margin-top:1rem"><div>${pic(campaignPhoto(c), c.category, c.title, 'hero-pic')}<h1 style="margin-top:1rem">${esc(c.title)}</h1>
  <p><a href="#/charities/${c.charity.id}">${esc(c.charity.name)}</a> ${c.charity.verified ? verifiedBadge() : ''} · ${badge(c.effectiveStatus)} <span class="tag">${esc(c.category)}</span></p>
  <div class="card"><h3>About this campaign</h3><p style="white-space:pre-wrap">${esc(c.description)}</p></div>
  <h3 style="margin-top:1.25rem">Updates</h3>${updates.length ? updates.map((u) => `<div class="card" style="margin-bottom:.6rem"><b>${esc(u.title)}</b> <span class="hint">${fdate(u.created_at)}</span><p>${esc(u.body)}</p></div>`).join('') : '<p class="hint">No updates yet.</p>'}</div>
  <aside class="card"><div class="stats" style="grid-template-columns:1fr 1fr;margin-top:0"><div class="stat"><span>Goal</span><b>${inr(c.goalPaise)}</b></div><div class="stat"><span>Raised</span><b>${inr(c.raisedPaise)}</b></div><div class="stat"><span>Deadline</span><b style="font-size:1.1rem">${fdate(c.endDate)}</b></div><div class="stat"><span>Donors</span><b>${c.donors}</b></div></div>
  <div class="prog" role="progressbar" aria-valuenow="${c.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Funding progress"><i style="width:${c.percent}%"></i></div><p class="hint">${c.percent}% funded · ${c.daysLeft} days left</p>${form}
  <button class="btn ghost block" style="margin-top:.75rem" data-act="share">Share this campaign</button>
  <section class="supporter-list" aria-labelledby="supporter-heading"><h3 id="supporter-heading">Recent supporters</h3>${recentDonations.length ? `<ul>${recentDonations.map((d) => `<li><span><b>${esc(d.name)}</b><small>${d.donations} ${d.donations === 1 ? 'donation' : 'donations'}</small></span><b>${inr(d.amountPaise)}${sim(d.simulated)}</b></li>`).join('')}</ul><p class="hint">Totals include successful contributions only.${S.meta.paymentMode === 'demo' ? ' All demo contributions are simulated.' : ''}</p>` : '<p class="hint">No successful donations have been recorded yet.</p>'}</section></aside></div></div>`);
};
pages.charities = async (path, q) => {
  const d = await api('GET', '/charities' + qs({ q: q.q, category: q.category, location: q.location, page: q.page, pageSize: 8 }));
  return pub(path, `<div class="wrap sec"><h1>Find a charity</h1><form class="filters" data-filter="/charities" role="search"><input name="q" value="${esc(q.q)}" placeholder="Search by name or cause" aria-label="Search"><select name="category" aria-label="Category">${opts(S.meta.categories, q.category, 'All categories')}</select>
  <select name="location" aria-label="Location">${opts([...new Set([...d.locations, ...INDIAN_STATES])].sort(), q.location, 'All locations')}</select><button class="btn">Search</button><a class="btn ghost" href="#/charities">Clear</a></form>
  ${d.items.length ? `<div class="grid">${d.items.map((c) => `<article class="card ccard">${pic(c.image, c.category, c.name)}<div class="body"><span class="tag">${esc(c.category)}</span><h3>${esc(c.name)} ${c.verified ? verifiedBadge() : ''}</h3><div class="hint">📍 ${esc(c.location)} · ${c.activeCampaigns} active campaigns</div><p>${esc(c.description.slice(0, 110))}…</p><a class="btn" href="#/charities/${c.id}">View Charity</a></div></article>`).join('')}</div>${pager(d.total, d.page, d.pageSize)}` : '<div class="empty card">No charities match your search.</div>'}</div>`);
};
pages.charity = async (path, q, [id]) => {
  const { charity: c, campaigns } = await api('GET', '/charities/' + encodeURIComponent(id));
  return pub(path, `<div class="wrap sec"><a href="#/charities">← Back to charities</a><div class="two" style="margin-top:1rem"><div class="card"><h1>${esc(c.name)} ${c.verified ? verifiedBadge() : ''}</h1><p><span class="tag">${esc(c.category)}</span> 📍 ${esc(c.location)}</p><h3>About us</h3><p style="white-space:pre-wrap">${esc(c.description)}</p><p class="hint">Verified: reviewed and approved by a CharityConnect administrator.</p></div>${pic(c.image, c.category, c.name, 'hero-pic')}</div>
  <h2 style="margin-top:1.5rem">Campaigns (${campaigns.length})</h2>${campaigns.length ? `<div class="grid">${campaigns.map(ccard).join('')}</div>` : '<div class="empty card">No public campaigns right now.</div>'}</div>`);
};

/* ---------- auth ---------- */
const authSide = `<aside class="auth-aside"><img class="auth-photo" src="${assetUrl('/images/causes/community.jpg')}" alt="" aria-hidden="true"><div class="auth-shade"></div><a class="logo auth-logo" href="#/">${LOGO}</a><div class="auth-quote"><span class="quote-mark" aria-hidden="true">“</span><blockquote>When we give together, <em>everyone</em> moves forward.</blockquote><cite>The CharityConnect community</cite></div><p class="auth-note">Connecting people with causes that matter.</p></aside>`;
const pwField = (name = 'password', label = 'Password', ac = 'current-password', meter = false, hint = false) => `<label for="${name}">${label}</label><div class="pw"><input id="${name}" name="${name}" type="password" autocomplete="${ac}" required minlength="8"><button type="button" data-act="showpw" aria-label="Show password">Show</button></div>${meter ? '<div class="meter" aria-hidden="true"><i></i></div>' : ''}${meter || hint ? '<div class="hint" id="pwhint">Use 8+ characters with letters and numbers.</div>' : ''}`;
pages.login = async (path, q) => {
  const requestedRole = q.role === 'ADMIN' ? 'ADMIN' : 'DONOR';
  return pub(path, `<div class="split">${authSide}<main><form data-form="login"><div class="login-emblem" aria-hidden="true">♡</div><span class="section-label">${requestedRole === 'ADMIN' ? 'Administrator access' : 'Welcome back'}</span><h1>${requestedRole === 'ADMIN' ? 'Admin Login' : 'Good to see you.'}</h1><p class="hint">${requestedRole === 'ADMIN' ? 'Sign in with an administrator account.' : 'Log in to continue your giving journey.'}</p>
  ${requestedRole === 'ADMIN' ? '' : `<div class="role-picker" role="group" aria-label="Choose your account type"><button type="button" class="role-choice selected" data-login-role="DONOR" aria-pressed="true"><span aria-hidden="true">♡</span>Donor</button><button type="button" class="role-choice" data-login-role="CHARITY" aria-pressed="false"><span aria-hidden="true">▤</span>Charity</button></div>`}
  <input type="hidden" name="loginRole" value="${requestedRole}"><div id="fe" class="alert bad" role="alert" hidden></div>
  <label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required>${pwField('password', 'Password', 'current-password', false, true)}
  <button class="btn block" style="margin-top:1.2rem">Login</button><p style="text-align:center">Don't have an account? <a href="#/register">Register</a></p><p class="hint">Forgot your password? Password reset by email is not configured in this demo; ask an administrator.</p>
  <details class="hint"><summary>Demo accounts (development seed)</summary>donor@charityconnect.test / Donor@12345<br>charity@charityconnect.test / Charity@12345<br>pending@charityconnect.test / Charity@12345<br>admin@charityconnect.test / Admin@12345</details></form></main></div>`);
};
pages.register = async (path, q) => pub(path, `<div class="split">${authSide}<main><form data-form="register"><span class="section-label">Join the community</span><h1>Create your CharityConnect account</h1><div id="fe" class="alert bad" role="alert" hidden></div>
  <label for="name">Full name</label><input id="name" name="name" autocomplete="name" required minlength="2"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required>${pwField('password', 'Password', 'new-password', true)}
  <label for="password2">Confirm password</label><input id="password2" name="password2" type="password" autocomplete="new-password" required>
  <fieldset class="register-roles"><legend>Account type</legend><label class="register-role"><input type="radio" name="accountType" value="DONOR" ${q.type === 'CHARITY' ? '' : 'checked'}><span>Donor</span></label><label class="register-role"><input type="radio" name="accountType" value="CHARITY" ${q.type === 'CHARITY' ? 'checked' : ''}><span>Charity</span></label></fieldset>
  <div id="charityFields" hidden><div class="alert">Charity accounts stay <b>pending</b> until an administrator approves them.</div><label for="cname">Organisation name</label><input id="cname" name="cname"><label for="ccat">Cause</label><select id="ccat" name="ccat">${opts(S.meta.categories, '', 'Select…')}</select>
  <label for="cloc">Location</label><input id="cloc" name="cloc"><label for="cdesc">About your organisation</label><textarea id="cdesc" name="cdesc"></textarea></div>
  <button class="btn block" style="margin-top:1.2rem">Register</button><p style="text-align:center">Already have an account? <a href="#/login">Login</a></p></form></main></div>`);
/* ---------- donor ---------- */
const donRows = (items, withLink = true) => items.map((d) => `<tr><td>${withLink ? `<a href="#/campaigns/${esc(d.campaign.slug)}">${esc(d.campaign.title)}</a>` : esc(d.campaign.title)}</td><td>${inr(d.amountPaise)}</td><td>${fdate(d.createdAt)}</td><td>${badge(d.status)}${sim(d.simulated)}</td><td class="hint">${d.payment ? esc(d.payment.orderId) + (d.payment.utr ? '<br>' + esc(d.payment.utr) : '') : ''}${d.status === 'PENDING' && d.payment ? `<br><a href="#/pay/${d.payment.id}">Continue payment</a>` : ''}</td></tr>`).join('');
pages.donor = async (path) => {
  if (!need('DONOR')) return '';
  const d = await api('GET', '/donor/dashboard');
  return dash(path, `<h1>Welcome, ${esc(S.user.name.split(' ')[0])}!</h1><p class="hint">Together we make a difference.</p><div class="stats"><div class="card stat"><span>Total donated</span><b>${inr(d.totalPaise)}</b></div><div class="card stat"><span>Successful donations</span><b>${d.donations}</b></div><div class="card stat"><span>Campaigns supported</span><b>${d.campaignsSupported}</b></div></div>
  <div class="row" style="margin-bottom:1rem"><a class="btn" href="#/campaigns">Explore campaigns</a><a class="btn ghost" href="#/donor/donations">View donation history</a></div><h2>Recent donations</h2>
  ${d.recent.length ? `<div class="tw"><table><thead><tr><th>Campaign</th><th>Amount</th><th>Date</th><th>Status</th><th>Reference</th></tr></thead><tbody>${donRows(d.recent)}</tbody></table></div>` : '<div class="empty card">You have not donated yet. <a href="#/campaigns">Find a campaign</a>.</div>'}`);
};
pages.mydonations = async (path, q) => {
  if (!need('DONOR')) return '';
  const d = await api('GET', '/donor/donations' + qs({ status: q.status, page: q.page, pageSize: 10 }));
  return dash(path, `<h1>My donations</h1><form class="filters" data-filter="/donor/donations"><select name="status" aria-label="Status">${opts(['SUCCESS', 'PENDING', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'], q.status, 'All statuses')}</select><button class="btn">Filter</button><a class="btn ghost" href="#/donor/donations">Clear</a></form>
  ${d.items.length ? `<div class="tw"><table><thead><tr><th>Campaign</th><th>Amount</th><th>Date</th><th>Status</th><th>Receipt / reference</th></tr></thead><tbody>${donRows(d.items)}</tbody></table></div>${pager(d.total, d.page, d.pageSize)}<p class="hint">SIMULATED records come from demo mode and are not real transactions.</p>` : '<div class="empty card">No donations found.</div>'}`);
};
pages.pay = async (path, q, [id]) => {
  if (!need('DONOR')) return '';
  const { payment: p } = await api('GET', `/payments/${id}/status`);
  const final = p.status !== 'PENDING';
  const msg = { SUCCESS: ['ok', `Thank you! Your ${p.simulated ? 'simulated ' : ''}donation was recorded as successful.`], FAILED: ['bad', 'The payment failed. No donation was recorded. You can try again.'], CANCELLED: ['bad', 'You cancelled this payment. Nothing was recorded.'], EXPIRED: ['bad', 'This payment session expired. Nothing was recorded. Start a new donation to try again.'], UNDER_REVIEW: ['', 'This payment is under review. It does not count until confirmed.'] }[p.status];
  const body = final ? `<div class="alert ${msg[0]}" role="status">${msg[1]}</div><div class="card"><div class="kv"><span>Order</span><b>${esc(p.orderId)}</b></div>${p.utr ? `<div class="kv"><span>Reference</span><b>${esc(p.utr)}</b></div>` : ''}<div class="kv"><span>Amount</span><b>${inr(p.amountPaise)}</b></div></div>
    <div class="row" style="margin-top:1rem"><a class="btn" href="#/donor/donations">My donations</a><a class="btn ghost" href="#/campaigns/${esc(p.campaign.slug)}">Back to campaign</a></div>`
    : `${p.simulated ? `<div class="demo"><h3>⚠ SIMULATED PAYMENT (demo mode)</h3><p>No real money is transferred. Nothing below is a real UPI request.</p><p><b>Demo UPI ID:</b> ${esc(p.instructions?.upiId || 'demo@charityconnect')}</p></div>` : `<div class="alert info">Complete the payment using the provider's instructions. This page updates only when the server confirms payment.</div>`}
    <div class="card" style="margin-top:1rem"><div class="kv"><span>Campaign</span><b>${esc(p.campaign.title)}</b></div><div class="kv"><span>Amount</span><b>${inr(p.amountPaise)}</b></div><div class="kv"><span>Status</span>${badge(p.status)}</div><div class="kv"><span>Expires</span><b>${new Date(p.expiresAt).toLocaleTimeString()}</b></div></div>
    <div class="row" style="margin-top:1rem">${p.simulated ? `<button class="btn" data-pay="success" data-id="${p.id}">Simulate successful payment</button><button class="btn ghost" data-pay="fail" data-id="${p.id}">Simulate failure</button>` : ''}<button class="btn danger" data-pay="cancel" data-id="${p.id}">Cancel payment</button></div>`;
  S.timer = final ? null : setInterval(async () => { try { const r = await api('GET', `/payments/${id}/status`); if (r.payment.status !== 'PENDING') { clearInterval(S.timer); route(); } } catch {} }, 4000);
  return dash(path, `<a href="#/campaigns/${esc(p.campaign.slug)}">← Back to campaign</a><h1>Complete your donation</h1>${body}`);
};

/* ---------- charity ---------- */
const approvalBanner = () => (S.charity && S.charity.status !== 'APPROVED' ? `<div class="alert ${S.charity.status === 'REJECTED' ? 'bad' : ''}" role="status"><b>Your charity is ${S.charity.status.toLowerCase()}.</b> ${S.charity.status === 'PENDING' ? 'An administrator is reviewing your application; you can create campaigns once approved.' : `Reason: ${esc(S.charity.review_note || 'not given')}. Update your <a href="#/charity/profile">profile</a> to resubmit.`}</div>` : '');
const campRows = (items) => items.map((c) => `<tr><td><a href="#/campaigns/${esc(c.slug)}">${esc(c.title)}</a>${c.reviewNote ? `<div class="hint">Note: ${esc(c.reviewNote)}</div>` : ''}</td><td>${inr(c.goalPaise)}</td><td>${inr(c.raisedPaise)} <span class="hint">(${c.percent}%)</span></td><td>${c.status === 'ACTIVE' ? c.daysLeft + ' days' : '-'}</td><td>${badge(c.effectiveStatus)}</td><td>${campActions(c)}</td></tr>`).join('');
const campActions = (c) => [c.status === 'DRAFT' ? `<a class="btn sm" href="#/charity/campaigns/${c.id}/edit">Complete details</a>` : ['PENDING', 'REJECTED'].includes(c.status) ? `<a class="btn sm ghost" href="#/charity/campaigns/${c.id}/edit">Edit</a>` : '', c.status === 'PAUSED' && !c.reviewNote ? `<button class="btn sm ghost" data-camp="resume" data-id="${c.id}">Resume</button>` : '',
  ['ACTIVE', 'PAUSED', 'COMPLETED'].includes(c.status) ? `<a class="btn sm ghost" href="#/charity/campaigns/${c.id}/update">Post update</a>` : ''].join(' ');
pages.charitydash = async (path) => {
  if (!need('CHARITY')) return '';
  const d = await api('GET', '/charity/dashboard');
  return dash(path, `<section class="charity-welcome"><div><span class="section-label">Charity workspace</span><h1>Welcome, ${esc(d.charity.name)}</h1><p>Your campaign activity and contributions, gathered in one place.</p></div><a class="btn charity-create" href="#/charity/campaigns/new"><span aria-hidden="true">＋</span> Create campaign</a></section>${approvalBanner()}<section class="charity-metrics" aria-label="Charity impact overview"><article><span>Campaigns</span><b>${d.campaigns}</b><small>All your campaigns</small></article><article><span>Active campaigns</span><b>${d.activeCampaigns}</b><small>Currently open to support</small></article><article><span>Total raised</span><b>${inr(d.raisedPaise)}</b><small>Across your campaigns</small></article><article><span>Donors</span><b>${d.donors}</b><small>Supporters who contributed</small></article></section>
  <section class="dashboard-section"><div class="head"><div><span class="section-label">Campaign activity</span><h2>Recent campaigns</h2></div><a class="btn sm ghost" href="#/charity/campaigns">Manage campaigns <span aria-hidden="true">→</span></a></div>${d.recentCampaigns.length ? `<div class="tw"><table><thead><tr><th>Campaign</th><th>Goal</th><th>Raised</th><th>Left</th><th>Status</th><th>Actions</th></tr></thead><tbody>${campRows(d.recentCampaigns)}</tbody></table></div>` : '<div class="empty card">No campaigns yet. Create your first campaign to introduce your work.</div>'}</section>
  <section class="dashboard-section"><div class="head"><div><span class="section-label">Community support</span><h2>Supporter contributions</h2></div></div><p class="hint">Successful contributions are grouped by supporter across your campaigns.</p>${d.recentDonations.length ? `<div class="tw"><table><thead><tr><th>Supporter</th><th>Total contributed</th><th>Donations</th><th>Last contribution</th></tr></thead><tbody>${d.recentDonations.map((r) => `<tr><td>${esc(r.donor)}${sim(r.simulated)}</td><td>${inr(r.amountPaise)}</td><td>${r.donations}</td><td>${fdate(r.createdAt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty card">Your supporters’ contributions will appear here.</div>'}</section>`);
};
pages.mycampaigns = async (path, q) => {
  if (!need('CHARITY')) return '';
  const d = await api('GET', '/charity/campaigns' + qs({ status: q.status }));
  return dash(path, `<div class="head"><h1>My campaigns</h1><a class="btn" href="#/charity/campaigns/new">Create campaign</a></div>${approvalBanner()}<form class="filters" data-filter="/charity/campaigns"><select name="status" aria-label="Status">${opts(['DRAFT', 'PENDING', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED'], q.status, 'All statuses')}</select><button class="btn">Filter</button></form>
  ${d.items.length ? `<div class="tw"><table><thead><tr><th>Campaign</th><th>Goal</th><th>Raised</th><th>Left</th><th>Status</th><th>Actions</th></tr></thead><tbody>${campRows(d.items)}</tbody></table></div>` : '<div class="empty card">No campaigns match.</div>'}`);
};
pages.campform = async (path, q, [id]) => {
  if (!need('CHARITY')) return '';
  const c = id ? (await api('GET', '/charity/campaigns/' + id)).campaign : null;
  if (!id && S.charity?.status !== 'APPROVED') return dash(path, `<h1>Create campaign</h1>${approvalBanner()}`);
  return dash(path, `<h1>${c?.status === 'DRAFT' ? 'Complete campaign details' : c ? 'Edit campaign' : 'Create campaign'}</h1>${c?.status === 'DRAFT' ? '<div class="alert info">Complete your campaign information and submit it for administrator review. It will not be public until approved.</div>' : ''}${c?.reviewNote ? `<div class="alert bad">Admin note: ${esc(c.reviewNote)}</div>` : ''}<form class="card campaign-form" data-form="campaign" data-id="${id || ''}" data-has-image="${c?.hasImage ? '1' : '0'}" data-has-document="${c?.hasDocument ? '1' : '0'}" data-document-name="${esc(c?.documentName || '')}"><div id="fe" class="alert bad" role="alert" hidden tabindex="-1"></div>
  <label for="title">Campaign title <span class="required-mark" aria-hidden="true">*</span></label><input id="title" name="title" required minlength="5" maxlength="120" value="${esc(c?.title)}"><div class="row"><div><label for="category">Cause / category <span class="required-mark" aria-hidden="true">*</span></label><select id="category" name="category" required>${opts(S.meta.categories, c?.category, 'Select…')}</select></div><div><label for="goal">Funding goal (₹ INR) <span class="required-mark" aria-hidden="true">*</span></label><input id="goal" name="goal" type="number" min="1000" step="1" required value="${c ? c.goalPaise / 100 : ''}"></div></div>
  <div class="row"><div><label for="startDate">Start date <span class="required-mark" aria-hidden="true">*</span></label><input id="startDate" name="startDate" type="date" required value="${esc(c?.startDate || new Date().toISOString().slice(0, 10))}"></div><div><label for="endDate">End date <span class="required-mark" aria-hidden="true">*</span></label><input id="endDate" name="endDate" type="date" required value="${esc(c?.endDate)}"></div></div>
  <label for="description">Description and objective <span class="required-mark" aria-hidden="true">*</span></label><textarea id="description" name="description" required minlength="20" maxlength="5000">${esc(c?.description)}</textarea>
  <section class="campaign-upload-section" aria-labelledby="campaign-image-heading"><div class="campaign-upload-heading"><h2 id="campaign-image-heading">Campaign image <span class="required-mark" aria-hidden="true">*</span></h2><p class="hint">Upload a JPG, PNG, or WebP image. Maximum 1 MB.</p></div>${c?.image ? `<img class="campaign-upload-preview" src="${esc(c.image)}" alt="Current campaign image">` : ''}<label class="profile-upload" for="campaign-image"><span class="profile-upload-icon" aria-hidden="true">↑</span><span><b data-campaign-image-name>${c?.hasImage ? 'Replace campaign image (optional)' : 'Choose a campaign image'}</b><small>JPG, PNG, or WebP · maximum 1 MB</small></span><input id="campaign-image" name="campaignImage" type="file" accept="image/jpeg,image/png,image/webp" ${c?.hasImage ? '' : 'required'}></label></section>
  <section class="campaign-upload-section" aria-labelledby="campaign-document-heading"><div class="campaign-upload-heading"><h2 id="campaign-document-heading">Supporting document <span class="required-mark" aria-hidden="true">*</span></h2><p class="hint">Upload a relevant JPG, PNG, or PDF. This document is private and is not shown publicly. Maximum 1.5 MB.</p></div><label class="profile-upload" for="campaign-document"><span class="profile-upload-icon" aria-hidden="true">↑</span><span><b data-campaign-document-name>${c?.hasDocument ? esc(c.documentName || 'Supporting document on file') : 'Choose a supporting document'}</b><small>JPG, PNG, or PDF · maximum 1.5 MB</small></span><input id="campaign-document" name="campaignDocument" type="file" accept="image/jpeg,image/png,application/pdf" ${c?.hasDocument ? '' : 'required'}></label></section>
  <div class="row" style="margin-top:1rem"><button class="btn ghost" data-submit="0">Save as draft</button><button class="btn" data-submit="1">${c?.status === 'DRAFT' ? 'Save &amp; submit for review' : 'Submit for approval'}</button></div></form>`);
};
pages.updateform = async (path, q, [id]) => {
  if (!need('CHARITY')) return '';
  return dash(path, `<h1>Post a campaign update</h1><form class="card" data-form="update" data-id="${esc(id)}"><div id="fe" class="alert bad" role="alert" hidden></div><label for="title">Title</label><input id="title" name="title" required minlength="3"><label for="body">Update</label><textarea id="body" name="body" required></textarea><button class="btn" style="margin-top:1rem">Post update</button><p class="hint">Past donors are notified.</p></form>`);
};
pages.charityprofile = async (path) => {
  if (!need('CHARITY')) return '';
  const { charity: c } = await api('GET', '/charity/profile');
  return dash(path, `<h1>Organisation profile</h1>${approvalBanner()}<form class="card" data-form="cprofile"><div id="fe" class="alert bad" role="alert" hidden></div><label for="name">Name</label><input id="name" name="name" value="${esc(c.name)}" required><div class="row"><div><label for="category">Cause</label><select id="category" name="category">${opts(S.meta.categories, c.category, 'Select…')}</select></div><div><label for="location">Location</label><input id="location" name="location" value="${esc(c.location)}" required></div></div>
  <label for="description">About</label><textarea id="description" name="description" required>${esc(c.description)}</textarea><label for="image">Logo/image URL (https)</label><input id="image" name="image" type="url" value="${esc(c.image)}"><button class="btn" style="margin-top:1rem">${c.status === 'REJECTED' ? 'Save and resubmit for review' : 'Save profile'}</button></form>`);
};
pages.share = async (path) => {
  if (!need('CHARITY')) return '';
  const d = await api('GET', '/charity/campaigns?status=ACTIVE');
  return dash(path, `<h1>Share &amp; QR</h1><div class="alert info">Share the campaign link below. A scannable QR image is not generated in this build (it needs a QR library); this link is the real donation page. It is <b>not</b> proof of money received, and payment sessions are created separately per donation.</div>
  ${d.items.length ? d.items.map((c) => { const url = `${location.origin}/#/campaigns/${c.slug}`; return `<div class="card" style="margin-bottom:.8rem"><b>${esc(c.title)}</b><div class="row" style="margin-top:.5rem"><input readonly value="${esc(url)}" aria-label="Campaign link"><button class="btn sm" data-copy="${esc(url)}" style="flex:0 0 auto">Copy link</button><a class="btn sm ghost" style="flex:0 0 auto" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Support ' + c.title + ': ' + url)}">WhatsApp</a></div></div>`; }).join('') : '<div class="empty card">You have no active campaigns to share.</div>'}`);
};

/* ---------- admin ---------- */
pages.admin = async (path) => {
  if (!need('ADMIN')) return '';
  const d = await api('GET', '/admin/dashboard'); const max = Math.max(1, ...d.byCategory.map((x) => x.raised));
  return dash(path, `<h1>Admin dashboard</h1><div class="stats"><div class="card stat"><span>Users</span><b>${d.users}</b></div><div class="card stat"><span>Charities</span><b>${d.charities}</b></div><div class="card stat"><span>Active campaigns</span><b>${d.activeCampaigns}</b></div><div class="card stat"><span>Total raised (incl. simulated)</span><b>${inr(d.raisedPaise)}</b></div></div>
  <div class="two"><div class="card"><h3>Pending approvals</h3><div class="kv"><span><a href="#/admin/charities?status=PENDING">Charities</a></span><b>${d.pendingCharities}</b></div><div class="kv"><span><a href="#/admin/campaigns?status=PENDING">Campaigns</a></span><b>${d.pendingCampaigns}</b></div>
  <h3 style="margin-top:1rem">Raised by cause</h3>${d.byCategory.map((x) => `<div class="bar"><span>${esc(x.category)}</span><div class="prog"><i style="width:${(x.raised / max) * 100}%"></i></div><b>${inr(x.raised)}</b></div>`).join('')}</div>
  <div class="card"><h3>Recent admin activity</h3>${d.recentAudit.length ? d.recentAudit.map((a) => `<div class="kv"><span>${esc(a.actor || '')} · ${esc(a.action)} #${a.entity_id}</span><span>${fdate(a.created_at)}</span></div>`).join('') : '<p class="hint">No actions yet.</p>'}</div></div>`);
};
const adminFilters = (base, q, statuses, search = true) => `<form class="filters" data-filter="${base}">${search ? `<input name="q" value="${esc(q.q)}" placeholder="Search" aria-label="Search">` : ''}<select name="status" aria-label="Status">${opts(statuses, q.status, 'All statuses')}</select>${base === '/admin/users' ? `<select name="role" aria-label="Role">${opts(['DONOR', 'CHARITY', 'ADMIN'], q.role, 'All roles')}</select>` : ''}<button class="btn">Filter</button><a class="btn ghost" href="#${base}">Clear</a></form>`;
pages.admincharities = async (path, q) => {
  if (!need('ADMIN')) return '';
  const d = await api('GET', '/admin/charities' + qs({ q: q.q, status: q.status, page: q.page, pageSize: 10 }));
  return dash(path, `<h1>Charity management</h1>${adminFilters('/admin/charities', q, ['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'])}<div class="tw"><table><thead><tr><th>Charity</th><th>Created by</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead><tbody>${d.items.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="hint">${esc(c.category)} · ${esc(c.location)}</div><details><summary class="hint">View details</summary><p>${esc(c.description)}</p>${c.review_note ? `<p class="hint">Decision note: ${esc(c.review_note)}</p>` : ''}</details></td><td><b>${esc(c.creator_name)}</b><div class="hint">${esc(c.email)}</div></td><td>${fdate(c.created_at)}</td><td>${badge(c.archived_at ? 'ARCHIVED' : c.status)}</td>
  <td>${c.archived_at ? `<button class="btn sm ghost" data-charityunarchive="${c.id}">Unarchive</button>` : `${c.status === 'PENDING' ? `<button class="btn sm" data-decide="charities/${c.id}/approve">Approve</button> <button class="btn sm danger" data-decide="charities/${c.id}/reject" data-reason="1">Reject</button>` : ''}<button class="btn sm danger" data-charityarchive="${c.id}">Archive</button>`} <button class="btn sm danger" data-charitydelete="${c.id}">Permanently Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing found.</td></tr>'}</tbody></table></div>${pager(d.total, d.page, d.pageSize)}`);
};
pages.admincampaigns = async (path, q) => {
  if (!need('ADMIN')) return '';
  const d = await api('GET', '/admin/campaigns' + qs({ q: q.q, status: q.status, page: q.page, pageSize: 10 }));
  return dash(path, `<h1>Campaign management</h1>${adminFilters('/admin/campaigns', q, ['PENDING', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED', 'DRAFT', 'ARCHIVED'])}<div class="tw"><table><thead><tr><th>Campaign</th><th>Charity &amp; creator</th><th>Goal</th><th>Raised</th><th>Status</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>${d.items.map((c) => `<tr><td><b>${esc(c.title)}</b><details><summary class="hint">Campaign details &amp; donors</summary><p>${esc(c.description)}</p><p><b>Category:</b> ${esc(c.category)} · <b>Dates:</b> ${fdate(c.startDate)} – ${fdate(c.endDate)}</p><h4>Successful donors (${c.supporters.length})</h4>${c.supporters.length ? `<ul class="admin-supporters">${c.supporters.map((d) => `<li><span>${esc(d.name)} · ${d.donations} ${d.donations === 1 ? 'donation' : 'donations'}</span><b>${inr(d.amountPaise)}${sim(d.simulated)}</b></li>`).join('')}</ul>` : '<p class="hint">No successful donations recorded.</p>'}</details></td><td><b>${esc(c.charity.name)}</b><div class="hint">${esc(c.creator.name)} · ${esc(c.creator.email)}</div><div class="hint">${esc(c.charity.location)}</div></td><td>${inr(c.goalPaise)}</td><td>${inr(c.raisedPaise)}</td><td>${c.archivedAt ? badge('ARCHIVED') : c.status === 'PAUSED' ? `${badge(c.status)}${c.reviewNote ? `<div class="hint pause-reason"><b>Reason:</b> ${esc(c.reviewNote)}</div>` : ''}` : c.status === 'ACTIVE' && c.resumedAt && c.effectiveStatus === 'ACTIVE' ? '<span class="badge b-ACTIVE">Campaign resumed</span>' : badge(c.effectiveStatus)}</td><td>${fdate(c.createdAt)}</td>
  <td>${c.archivedAt ? `<button class="btn sm ghost" data-campaignunarchive="${c.id}">Unarchive</button>` : `${c.status === 'PENDING' ? `<button class="btn sm" data-decide="campaigns/${c.id}/approve">Approve</button> <button class="btn sm danger" data-decide="campaigns/${c.id}/reject" data-reason="1">Reject</button>` : c.status === 'ACTIVE' ? `<button class="btn sm danger" data-decide="campaigns/${c.id}/pause" data-reason="1">Pause</button>` : c.status === 'PAUSED' ? `<button class="btn sm" data-campaignresume="${c.id}">Resume Campaign</button>` : ''} <button class="btn sm danger" data-campaignarchive="${c.id}">Archive</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing found.</td></tr>'}</tbody></table></div>${pager(d.total, d.page, d.pageSize)}`);
};
pages.adminusers = async (path, q) => {
  if (!need('ADMIN')) return '';
  const d = await api('GET', '/admin/users' + qs({ q: q.q, role: q.role, status: q.status, page: q.page, pageSize: 10 }));
  return dash(path, `<h1>User management</h1>${adminFilters('/admin/users', q, ['ACTIVE', 'DISABLED'])}<div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead><tbody>${d.items.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${badge(u.status)}</td><td>${fdate(u.created_at)}</td><td>${u.role === 'ADMIN' || u.id === S.user.id ? '-' : u.status === 'ACTIVE' ? `<button class="btn sm danger" data-userstatus="DISABLED" data-id="${u.id}">Deactivate</button>` : `<button class="btn sm ghost" data-userstatus="ACTIVE" data-id="${u.id}">Activate</button>`}</td></tr>`).join('')}</tbody></table></div>${pager(d.total, d.page, d.pageSize)}<p class="hint">Disabling an account never deletes its donation history.</p>`);
};
pages.admindonations = async (path, q) => {
  if (!need('ADMIN')) return '';
  const d = await api('GET', '/admin/donations' + qs({ status: q.status, page: q.page, pageSize: 15 }));
  return dash(path, `<h1>Donations</h1>${adminFilters('/admin/donations', q, ['SUCCESS', 'PENDING', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'], false)}<div class="tw"><table><thead><tr><th>Campaign</th><th>Amount</th><th>Date</th><th>Status</th><th>Reference</th></tr></thead><tbody>${donRows(d.items, false)}</tbody></table></div>${pager(d.total, d.page, d.pageSize)}`);
};
pages.adminreports = async (path) => {
  if (!need('ADMIN')) return '';
  const r = await api('GET', '/admin/reports');
  return dash(path, `<h1>Reports</h1><div class="alert info">${esc(r.definition)}</div><h3>Donations by status</h3><div class="tw"><table><thead><tr><th>Status</th><th>Type</th><th>Count</th><th>Amount</th></tr></thead><tbody>${r.donationsByStatus.map((x) => `<tr><td>${badge(x.status)}</td><td>${x.simulated ? 'Simulated' : 'Real / verified'}</td><td>${x.count}</td><td>${inr(x.paise)}</td></tr>`).join('')}</tbody></table></div>
  <h3 style="margin-top:1.2rem">Campaign performance</h3><div class="tw"><table><thead><tr><th>Campaign</th><th>Status</th><th>Goal</th><th>Raised</th><th>Donors</th></tr></thead><tbody>${r.campaignPerformance.map((x) => `<tr><td>${esc(x.title)}</td><td>${badge(x.status)}</td><td>${inr(x.goal_paise)}</td><td>${inr(x.raised_paise)}</td><td>${x.donors}</td></tr>`).join('')}</tbody></table></div>
  <div class="two" style="margin-top:1.2rem"><div class="card"><h3>Approval queues</h3><div class="kv"><span>Charities</span><b>${r.approvalQueues.charities}</b></div><div class="kv"><span>Campaigns</span><b>${r.approvalQueues.campaigns}</b></div></div><div class="card"><h3>Users by role / status</h3>${r.usersByRole.map((u) => `<div class="kv"><span>${esc(u.role)} · ${esc(u.status)}</span><b>${u.count}</b></div>`).join('')}</div></div>`);
};
pages.notifications = async (path) => {
  if (!need('DONOR', 'CHARITY', 'ADMIN')) return '';
  const d = await api('GET', '/notifications'); S.unread = d.unread;
  return dash(path, `<div class="head"><div><span class="section-label">${d.unread ? `${d.unread} unread` : 'All caught up'}</span><h1>Notifications</h1></div><button class="btn ghost sm" data-act="readall" ${d.unread ? '' : 'disabled'}>${d.unread ? 'Mark all as read' : 'All caught up'}</button></div>${d.items.length ? `<section class="notification-list" aria-label="Your notifications">${d.items.map((n) => `<article class="card notification-item${n.isRead ? ' is-read' : ' is-unread'}" aria-label="${n.isRead ? 'Read notification' : 'Unread notification'}"><span class="notification-indicator" aria-hidden="true"></span><div><p>${esc(n.message)}</p><time class="hint">${fdate(n.created_at)}</time></div>${n.isRead ? '' : '<span class="notification-new">New</span>'}</article>`).join('')}</section>` : '<div class="empty card">You have no notifications.</div>'}`);
};
pages.profile = async (path) => {
  if (!need('DONOR')) return '';
  const { profile: p } = await api('GET', '/profile');
  const percent = p.completionPercent;
  return dash(path, `<section class="profile-page">
    <header class="profile-heading"><div><span class="section-label">Your account</span><h1>Profile</h1><p class="hint">Keep your details up to date to build a complete supporter profile.</p></div></header>
    <section class="profile-completion card" aria-label="Profile completeness">
      <div class="profile-completion-copy"><span class="profile-completion-icon" aria-hidden="true">✓</span><div><h2 data-profile-status>${percent === 100 ? 'Your profile is complete' : 'Your profile is not 100% complete'}</h2><p class="hint">Add a photo, address, and ID proof to complete your profile.</p></div></div>
      <div class="profile-score"><strong data-profile-percent>${percent}%</strong><span>complete</span></div>
      <div class="profile-progress" role="progressbar" aria-label="Profile completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>
    </section>
    <form class="profile-form" data-form="profile" data-has-photo="${p.photo ? '1' : '0'}" data-has-proof="${p.hasIdProof ? '1' : '0'}" data-proof-name="${esc(p.idProofName || '')}">
      <section class="card profile-card">
        <div class="profile-card-heading"><div><span class="section-label">Personal information</span><h2>About you</h2><p class="hint">Your name and email are connected to your account.</p></div></div>
        <div class="profile-identity">
          <div class="profile-photo-wrap"><img class="profile-photo" data-photo-preview src="${esc(p.photo || assetUrl('/brand-icon.png'))}" alt="Profile photo preview"><span class="profile-photo-mark" aria-hidden="true">+</span></div>
          <div class="profile-photo-fields"><label for="profile-photo">Profile photo</label><input id="profile-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp"><p class="hint">JPG, PNG, or WebP. Maximum 1 MB.</p></div>
        </div>
        <div class="profile-fields">
          <div><label for="profile-name">Full name</label><input id="profile-name" value="${esc(p.name)}" readonly aria-describedby="profile-name-note"><small id="profile-name-note" class="hint">To change your name, contact support.</small></div>
          <div><label for="profile-email">Email address</label><input id="profile-email" type="email" value="${esc(p.email)}" readonly></div>
          <div class="profile-address"><label for="profile-address">Address</label><textarea id="profile-address" name="address" maxlength="300" rows="3" placeholder="Street, city, state, postal code">${esc(p.address)}</textarea><small class="hint">Use the address where you can be reached.</small></div>
        </div>
      </section>
      <section class="card profile-card">
        <div class="profile-card-heading"><div><span class="section-label">Identity details</span><h2>ID proof</h2><p class="hint">Add a document to complete your profile.</p></div><span class="profile-proof-state" data-proof-status>${p.hasIdProof ? 'Document added' : 'Not added'}</span></div>
        <label class="profile-upload" for="profile-id-proof"><span class="profile-upload-icon" aria-hidden="true">↑</span><span><b data-proof-name>${p.hasIdProof ? esc(p.idProofName || 'ID proof on file') : 'Choose an ID proof file'}</b><small>JPG, PNG, or PDF · maximum 1.5 MB</small></span><input id="profile-id-proof" name="idProof" type="file" accept="image/jpeg,image/png,application/pdf"></label>
        <p class="hint profile-privacy">Files are stored with your account and are not displayed publicly. File upload does not independently verify identity. Do not upload sensitive government ID to this demo.</p>
      </section>
      <div class="profile-actions"><div class="alert bad" id="fe" role="alert" hidden tabindex="-1"></div><button class="btn" type="submit">Save profile</button></div>
    </form>
  </section>`);
};

/* ---------- router ---------- */
const ROUTES = [
  [/^\/$/, 'home'], [/^\/about$/, 'about'], [/^\/campaigns$/, 'campaigns'], [/^\/campaigns\/([^/]+)$/, 'campaign'], [/^\/charities$/, 'charities'], [/^\/charities\/(\d+)$/, 'charity'], [/^\/login$/, 'login'], [/^\/register$/, 'register'],
  [/^\/donor$/, 'donor'], [/^\/donor\/donations$/, 'mydonations'], [/^\/pay\/(\d+)$/, 'pay'], [/^\/profile$/, 'profile'], [/^\/notifications$/, 'notifications'],
  [/^\/charity$/, 'charitydash'], [/^\/charity\/campaigns$/, 'mycampaigns'], [/^\/charity\/campaigns\/new$/, 'campform'], [/^\/charity\/campaigns\/(\d+)\/edit$/, 'campform'], [/^\/charity\/campaigns\/(\d+)\/update$/, 'updateform'], [/^\/charity\/profile$/, 'charityprofile'], [/^\/charity\/share$/, 'share'],
  [/^\/admin$/, 'admin'], [/^\/admin\/charities$/, 'admincharities'], [/^\/admin\/campaigns$/, 'admincampaigns'], [/^\/admin\/users$/, 'adminusers'], [/^\/admin\/donations$/, 'admindonations'], [/^\/admin\/reports$/, 'adminreports'],
];
const parseHash = () => { const h = location.hash.slice(1) || '/'; const [p, s] = h.split('?'); return { path: p, q: Object.fromEntries(new URLSearchParams(s || '')) }; };
async function refreshMe() {
  try { const m = await api('GET', '/auth/me'); S.user = m.user; S.unread = m.unread; S.charity = m.charity || null; } catch { S.user = null; S.charity = null; S.unread = 0; }
}
let seq = 0;
async function route() {
  clearInterval(S.timer); const my = ++seq; const { path, q } = parseHash();
  const hit = ROUTES.map(([re, name]) => [path.match(re), name]).find(([m]) => m);
  $app.setAttribute('aria-busy', 'true');
  let html;
  try {
    if (S.user && ['/login', '/register'].includes(path)) { location.hash = '#' + home(); return; }
    html = hit ? await pages[hit[1]](path, q, hit[0].slice(1)) : pub(path, '<div class="wrap sec empty"><h1>Page not found</h1><a class="btn" href="#/">Go home</a></div>');
  } catch (e) {
    if (e.status === 401 && S.user) { S.user = null; location.hash = '#/login'; return; }
    html = (S.user && path.match(/^\/(donor|charity|admin|pay)/)) ? dash(path, errBox(e)) : pub(path, `<div class="wrap sec">${e.status === 404 ? '<div class="empty card"><h2>Not found</h2><p>This page does not exist or is not public.</p><a class="btn" href="#/">Go home</a></div>' : errBox(e)}</div>`);
  }
  if (my !== seq || html === '') return;
  $app.innerHTML = html; $app.removeAttribute('aria-busy'); document.title = 'CharityConnect';
  const sectionId = path === '/' && ['how-it-works', 'trust'].includes(q.section) ? q.section
    : path === '/about' ? ({ about: 'about-intro', trust: 'trust', 'demo-payments': 'demo-payments' }[q.section] || '') : '';
  if (sectionId) window.setTimeout(() => {
    if (my !== seq) return;
    const section = document.getElementById(sectionId);
    if (section) {
      section.classList.add('section-highlight');
      window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - 96, behavior: 'instant' });
    }
  }, 0);
  else window.scrollTo(0, 0);
  if (path === '/register') syncCharityFields();
}
const setErr = (f, e) => { const box = f.querySelector('#fe'); if (box) { box.textContent = e.message; box.hidden = false; box.focus?.(); } else toast(e.message, true); };
function syncCharityFields() { const f = document.querySelector('[data-form=register]'); if (!f) return; f.querySelector('#charityFields').hidden = f.accountType.value !== 'CHARITY'; }
function strength(v) { let s = 0; if (v.length >= 8) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v) || v.length >= 12) s++; return s; }
function updateProfileCompletion(form) {
  const complete = [form.querySelector('#profile-name').value, form.querySelector('#profile-email').value, form.elements.address.value.trim(),
    form.dataset.hasPhoto === '1' || form.elements.photo.files.length > 0, form.dataset.hasProof === '1' || form.elements.idProof.files.length > 0].filter(Boolean).length;
  const percent = Math.round(complete * 20), bar = form.parentElement.querySelector('.profile-progress');
  form.parentElement.querySelector('[data-profile-percent]').textContent = `${percent}%`;
  form.parentElement.querySelector('[data-profile-status]').textContent = percent === 100 ? 'Your profile is complete' : 'Your profile is not 100% complete';
  bar.setAttribute('aria-valuenow', String(percent));
  bar.querySelector('i').style.width = `${percent}%`;
}
const fileDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read the selected file. Please try again.'));
  reader.readAsDataURL(file);
});

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a'); if (!t) return;
  const act = t.dataset.act;
  if (t.hasAttribute('data-close-reason')) { t.closest('dialog')?.close(); return; }
  if (act === 'menu') {
    const shell = document.getElementById('shell');
    shell.classList.toggle('open');
    shell.querySelector('.menu-btn')?.setAttribute('aria-expanded', String(shell.classList.contains('open')));
    if (shell.classList.contains('open')) shell.querySelector('.menu-btn')?.focus();
  }
  if (t.closest('.side nav a')) {
    const shell = document.getElementById('shell');
    shell?.classList.remove('open');
    shell?.querySelector('.menu-btn')?.setAttribute('aria-expanded', 'false');
    shell?.querySelector('.menu-btn')?.focus();
  }
  if (act === 'reload') route();
  if (act === 'showpw') { const i = t.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; t.textContent = i.type === 'password' ? 'Show' : 'Hide'; t.setAttribute('aria-label', i.type === 'password' ? 'Show password' : 'Hide password'); }
  if (t.dataset.loginRole) {
    const form = t.closest('form');
    form.elements.loginRole.value = t.dataset.loginRole;
    form.querySelectorAll('[data-login-role]').forEach((choice) => {
      const selected = choice === t;
      choice.classList.toggle('selected', selected);
      choice.setAttribute('aria-pressed', String(selected));
    });
  }
  if (t.dataset.fav) {
    const next = new Set(S.favorites);
    if (next.has(t.dataset.fav)) next.delete(t.dataset.fav);
    else next.add(t.dataset.fav);
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next])); }
    catch (error) { console.error('Could not save campaign:', error); toast('This campaign could not be saved in this browser.', true); return; }
    S.favorites = next;
    const saved = next.has(t.dataset.fav);
    t.textContent = saved ? '♥' : '♡';
    t.setAttribute('aria-pressed', String(saved));
    t.setAttribute('aria-label', `${saved ? 'Remove saved campaign' : 'Save campaign'}: ${t.closest('.ccard').querySelector('h3').textContent}`);
    toast(saved ? 'Campaign saved' : 'Campaign removed from saved');
  }
  if (act === 'logout') { e.preventDefault(); await api('POST', '/auth/logout').catch(() => {}); S.user = null; S.charity = null; location.hash = '#/'; route(); }
  if (act === 'share') { const url = location.href; try { if (navigator.share) await navigator.share({ title: document.title, url }); else { await navigator.clipboard.writeText(url); toast('Link copied'); } } catch {} }
  if (act === 'readall') {
    t.disabled = true;
    try { await api('POST', '/notifications/read', {}); S.unread = 0; toast('Notifications marked as read'); route(); }
    catch (error) { t.disabled = false; toast(error.message, true); }
  }
  if (t.dataset.copy) { try { await navigator.clipboard.writeText(t.dataset.copy); toast('Link copied'); } catch { toast('Copy failed: select the text manually', true); } }
  if (t.dataset.amt) document.getElementById('amt').value = t.dataset.amt;
  if (t.dataset.page) { const { path, q } = parseHash(); q.page = t.dataset.page; location.hash = '#' + path + '?' + new URLSearchParams(q); }
  if (t.dataset.pay) {
    document.querySelectorAll('[data-pay]').forEach((b) => (b.disabled = true));
    try { await api('POST', `/payments/${t.dataset.id}/${t.dataset.pay === 'cancel' ? 'cancel' : 'demo-resolve'}`, t.dataset.pay === 'cancel' ? {} : { outcome: t.dataset.pay }); } catch (er) { toast(er.message, true); }
    route();
  }
  if (t.dataset.camp) { try { await api('PATCH', `/charity/campaigns/${t.dataset.id}`, { action: t.dataset.camp }); toast('Campaign updated'); } catch (er) { toast(er.message, true); } route(); }
  if (t.dataset.decide) {
    if (t.dataset.reason) { openReasonDialog(t.dataset.decide); return; }
    const body = {};
    t.disabled = true;
    try { await api('POST', '/admin/' + t.dataset.decide, body); toast('Decision recorded'); } catch (er) { toast(er.message, true); } route();
  }
  if (t.dataset.campaignarchive) {
    if (!confirm('Archive this campaign? It will be removed from public listings, and donation history will be preserved.')) return;
    t.disabled = true;
    try { await api('POST', `/admin/campaigns/${t.dataset.campaignarchive}/archive`, {}); toast('Campaign archived'); }
    catch (er) { toast(er.message, true); }
    route();
  }
  if (t.dataset.charityarchive) {
    if (!confirm('Archive this charity and its campaigns from public listings? Donation history will be preserved.')) return;
    t.disabled = true;
    try { await api('POST', `/admin/charities/${t.dataset.charityarchive}/archive`, {}); toast('Charity archived'); }
    catch (er) { toast(er.message, true); }
    route();
  }
  if (t.dataset.charityunarchive) {
    t.disabled = true;
    try {
      const result = await api('POST', `/admin/charities/${t.dataset.charityunarchive}/unarchive`, {});
      toast(`Charity restored. ${result.archivedCampaigns} campaign(s) remain archived.`);
    } catch (er) { toast(er.message, true); }
    route();
  }
  if (t.dataset.campaignunarchive) {
    t.disabled = true;
    try {
      const result = await api('POST', `/admin/campaigns/${t.dataset.campaignunarchive}/unarchive`, {});
      toast(result.charityArchived ? 'Campaign restored, but its charity is still archived.' : 'Campaign restored');
    } catch (er) { toast(er.message, true); }
    route();
  }
  if (t.dataset.campaignresume) {
    t.disabled = true;
    try { await api('POST', `/admin/campaigns/${t.dataset.campaignresume}/resume`, {}); toast('Campaign resumed'); }
    catch (er) { toast(er.message, true); }
    route();
  }
  if (t.dataset.charitydelete) {
    if (!confirm('Permanently delete this charity and its campaign records? This is irreversible and only allowed if it has no donation history.')) return;
    t.disabled = true;
    try { await api('POST', `/admin/charities/${t.dataset.charitydelete}/permanent-delete`, {}); toast('Charity permanently deleted'); }
    catch (er) { toast(er.message, true); }
    route();
  }
  if (t.dataset.userstatus) { try { await api('PATCH', `/admin/users/${t.dataset.id}/status`, { status: t.dataset.userstatus }); toast('User updated'); } catch (er) { toast(er.message, true); } route(); }
});
document.addEventListener('input', (e) => {
  if (e.target.name === 'password' && e.target.closest('[data-form=register]')) { const s = strength(e.target.value), m = document.querySelector('.meter i'); m.style.width = s * 25 + '%'; m.style.background = ['#B42318', '#B42318', '#B45309', '#16A778', '#07865F'][s]; document.getElementById('pwhint').textContent = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][s]; }
  if (e.target.name === 'accountType') syncCharityFields();
  if (e.target.name === 'address' && e.target.form?.dataset.form === 'profile') updateProfileCompletion(e.target.form);
});
document.addEventListener('change', (e) => {
  const input = e.target, form = input.form;
  if (form?.dataset.form === 'campaign' && input.matches('input[type=file]')) {
    const file = input.files[0];
    if (file) {
      const image = input.name === 'campaignImage';
      const accepted = image ? ['image/jpeg', 'image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'application/pdf'];
      const max = image ? 1_000_000 : 1_500_000;
      if (!accepted.includes(file.type)) { input.value = ''; toast('Choose a supported image or PDF file.', true); return; }
      if (file.size > max) { input.value = ''; toast(`Choose a file smaller than ${image ? '1' : '1.5'} MB.`, true); return; }
      form.querySelector(image ? '[data-campaign-image-name]' : '[data-campaign-document-name]').textContent = file.name;
    } else {
      const image = input.name === 'campaignImage';
      form.querySelector(image ? '[data-campaign-image-name]' : '[data-campaign-document-name]').textContent =
        image ? (form.dataset.hasImage === '1' ? 'Replace campaign image (optional)' : 'Choose a campaign image')
          : (form.dataset.hasDocument === '1' ? form.dataset.documentName : 'Choose a supporting document');
    }
    return;
  }
  if (form?.dataset.form !== 'profile' || !input.matches('input[type=file]')) return;
  const file = input.files[0];
  if (file) {
    const accepted = input.name === 'photo' ? ['image/jpeg', 'image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'application/pdf'];
    if (!accepted.includes(file.type)) { input.value = ''; toast('Choose a supported image or PDF file.', true); return; }
    const max = input.name === 'photo' ? 1_000_000 : 1_500_000;
    if (file.size > max) { input.value = ''; toast(`Choose a file smaller than ${max === 1_000_000 ? '1' : '1.5'} MB.`, true); return; }
    if (input.name === 'photo') {
      if (!form.dataset.originalPhotoSrc) form.dataset.originalPhotoSrc = form.querySelector('[data-photo-preview]').src;
      if (form.dataset.previewUrl) URL.revokeObjectURL(form.dataset.previewUrl);
      form.dataset.previewUrl = URL.createObjectURL(file);
      form.querySelector('[data-photo-preview]').src = form.dataset.previewUrl;
    } else {
      form.querySelector('[data-proof-name]').textContent = file.name;
      form.querySelector('[data-proof-status]').textContent = 'New document selected';
    }
  } else if (input.name === 'photo') {
    if (form.dataset.previewUrl) URL.revokeObjectURL(form.dataset.previewUrl);
    delete form.dataset.previewUrl;
    form.querySelector('[data-photo-preview]').src = form.dataset.originalPhotoSrc || assetUrl('/brand-icon.png');
    delete form.dataset.originalPhotoSrc;
  } else if (input.name === 'idProof') {
    form.querySelector('[data-proof-name]').textContent = form.dataset.proofName || 'Choose an ID proof file';
    form.querySelector('[data-proof-status]').textContent = form.dataset.hasProof === '1' ? 'Document added' : 'Not added';
  }
  updateProfileCompletion(form);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const shell = document.getElementById('shell');
  if (!shell?.classList.contains('open')) return;
  shell.classList.remove('open');
  shell.querySelector('.menu-btn')?.setAttribute('aria-expanded', 'false');
  shell.querySelector('.menu-btn')?.focus();
});
document.addEventListener('submit', async (e) => {
  const f = e.target; e.preventDefault();
  if (f.hasAttribute('data-reason-form')) {
    const dialog = f.closest('dialog'), error = dialog.querySelector('[data-reason-error]');
    const reason = String(new FormData(f).get('reason') || '').trim(), button = e.submitter || f.querySelector('button[type="submit"]');
    if (reason.length < 3) { error.textContent = 'Please provide a reason of at least 3 characters.'; error.hidden = false; return; }
    button.disabled = true;
    try {
      await api('POST', '/admin/' + f.dataset.endpoint, { reason });
      toast(f.dataset.endpoint.endsWith('/pause') ? 'Campaign paused with reason recorded' : 'Decision recorded with reason');
      dialog.close();
      await route();
    } catch (er) {
      error.textContent = er.message; error.hidden = false; button.disabled = false;
    }
    return;
  }
  if (f.dataset.filter) { const p = new URLSearchParams(); new FormData(f).forEach((v, k) => v && p.set(k, v)); location.hash = '#' + f.dataset.filter + (p.toString() ? '?' + p : ''); if (location.hash === '#' + f.dataset.filter + (p.toString() ? '?' + p : '')) route(); return; }
  const kind = f.dataset.form; if (!kind) return; const fd = Object.fromEntries(new FormData(f)); const btn = e.submitter || f.querySelector('button:not([type])'); const all = f.querySelectorAll('button'); all.forEach((b) => (b.disabled = true));
  try {
    if (kind === 'login') {
      await api('POST', '/auth/login', { email: fd.email, password: fd.password });
      await refreshMe();
      if (S.user?.role !== fd.loginRole) {
        await api('POST', '/auth/logout');
        S.user = null; S.charity = null; S.unread = 0;
        throw new Error('Those credentials do not match the selected account type.');
      }
      toast('Welcome back!'); location.hash = '#' + home(); route();
    }
    if (kind === 'register') {
      if (fd.password !== fd.password2) throw new Error('Passwords do not match');
      await api('POST', '/auth/register', { name: fd.name, email: fd.email, password: fd.password, accountType: fd.accountType, charity: fd.accountType === 'CHARITY' ? { name: fd.cname, category: fd.ccat, location: fd.cloc, description: fd.cdesc } : undefined });
      await api('POST', '/auth/login', { email: fd.email, password: fd.password });
      await refreshMe(); location.hash = '#' + home(); route();
    }
    if (kind === 'donate') { const r = await api('POST', '/donations', { campaignId: Number(f.dataset.id), amount: fd.amount }); location.hash = '#/pay/' + r.paymentId; }
    if (kind === 'campaign') {
      const body = { title: fd.title, category: fd.category, goal: Number(fd.goal), startDate: fd.startDate,
        endDate: fd.endDate, description: fd.description, submit: btn?.dataset.submit === '1' };
      for (const [field, key] of [['campaignImage', 'campaignImage'], ['campaignDocument', 'campaignDocument']]) {
        const file = f.elements[field].files[0];
        if (file) body[key] = { data: await fileDataUrl(file), type: file.type, name: file.name };
      }
      const r = f.dataset.id ? await api('PATCH', '/charity/campaigns/' + f.dataset.id, body) : await api('POST', '/charity/campaigns', body);
      toast(body.submit ? 'Submitted for admin approval (status: Pending)' : 'Saved as draft'); location.hash = '#/charity/campaigns'; if (r) route();
    }
    if (kind === 'update') { await api('POST', `/charity/campaigns/${f.dataset.id}/updates`, fd); toast('Update posted'); location.hash = '#/charity/campaigns'; }
    if (kind === 'cprofile') { const r = await api('PATCH', '/charity/profile', { ...fd, image: fd.image || '' }); await refreshMe(); toast(r.status === 'PENDING' ? 'Saved. Awaiting review.' : 'Profile saved'); route(); }
    if (kind === 'profile') {
      const payload = { address: fd.address };
      for (const [field, key] of [['photo', 'photo'], ['idProof', 'idProof']]) {
        const file = f.elements[field].files[0];
        if (file) payload[key] = { data: await fileDataUrl(file), type: file.type, name: file.name };
      }
      const result = await api('PATCH', '/profile', payload);
      toast(`Profile saved · ${result.profile.completionPercent}% complete`);
      if (f.dataset.previewUrl) URL.revokeObjectURL(f.dataset.previewUrl);
      await route();
    }
  } catch (er) {
    setErr(f, er); all.forEach((b) => (b.disabled = false));
  }
});
window.addEventListener('hashchange', route);
(async () => { try { S.meta = await api('GET', '/meta'); } catch {} await refreshMe(); route(); })();
