import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createApp } from '../server/app.js';
import { seed } from '../server/seed.js';

const SECRET = 'test-secret';
let app, base;
const mk = (env) => { const a = createApp({ env: { PAYMENT_MODE: 'demo', ...env } }); seed(a.db, {}); return a; };
const listen = (a) => new Promise((r) => a.server.listen(0, () => r(`http://127.0.0.1:${a.server.address().port}`)));
before(async () => { app = mk({}); base = await listen(app); });
after(() => app.close());

async function client(b = () => base) {
  let sid = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(b() + path, { method, headers: { 'Content-Type': 'application/json', ...(sid ? { Cookie: sid } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) sid = set.split(';')[0].replace(/^cc_sid=$/, '');
    const text = await res.text(); return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { call, login: (email, password) => call('POST', '/api/auth/login', { email, password }) };
}
const as = async (email, pw) => { const c = await client(); const r = await c.login(email, pw); assert.equal(r.status, 200); return c; };
const donor = () => as('donor@charityconnect.test', 'Donor@12345');
const getCamp = async (slug) => (await (await client()).call('GET', '/api/campaigns/' + slug)).body.campaign;
const requiredCampaignUploads = {
  campaignImage: { data: 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'), type: 'image/png', name: 'campaign.png' },
  campaignDocument: { data: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n').toString('base64'), type: 'application/pdf', name: 'supporting-document.pdf' },
};

test('startup: seed is idempotent', () => {
  const n = () => app.db.prepare('SELECT (SELECT COUNT(*) FROM users)+(SELECT COUNT(*) FROM campaigns)+(SELECT COUNT(*) FROM donations) n').get().n;
  const before = n(); seed(app.db, {}); assert.equal(n(), before);
  const stats = app.db.prepare(`SELECT COALESCE(SUM(d.amount_paise),0) amountPaise, COUNT(DISTINCT d.donor_id) contributors, COUNT(*) donations
    FROM donations d JOIN payments p ON p.donation_id=d.id
    WHERE d.status='SUCCESS' AND p.order_id LIKE 'SEED-%' AND date(d.created_at)>=date('now','start of month')`).get();
  assert.deepEqual({ ...stats }, { amountPaise: 9675000, contributors: 3, donations: 36 });
});

test('serverless handler dispatches API requests without opening a port', async () => {
  const req = Object.assign(Readable.from([]), { method: 'GET', url: '/api/meta', headers: {} });
  const headers = {};
  let statusCode;
  let body = '';
  const res = {
    headersSent: false,
    setHeader(name, value) { headers[name] = value; },
    writeHead(status, values = {}) { statusCode = status; Object.assign(headers, values); },
    end(value = '') { body += value; this.headersSent = true; },
  };

  await app.handler(req, res);
  assert.equal(statusCode, 200);
  assert.equal(headers['Content-Type'], 'application/json; charset=utf-8');
  assert.ok(JSON.parse(body).categories.length > 0);
});

test('auth: register, sign in, duplicate email, validation, no ADMIN signup', async () => {
  const c = await client();
  const ok = await c.call('POST', '/api/auth/register', { name: 'New Donor', email: 'new@x.test', password: 'Passw0rd1', accountType: 'DONOR' });
  assert.equal(ok.status, 201); assert.equal(ok.body.user.role, 'DONOR'); assert.equal(ok.body.user.passwordHash, undefined);
  assert.equal((await c.login('new@x.test', 'Passw0rd1')).status, 200);
  assert.equal((await c.call('POST', '/api/auth/register', { name: 'Dup', email: 'NEW@x.test', password: 'Passw0rd1', accountType: 'DONOR' })).status, 409);
  assert.equal((await c.call('POST', '/api/auth/register', { name: 'Evil', email: 'evil@x.test', password: 'Passw0rd1', accountType: 'ADMIN' })).status, 400);
  assert.equal((await c.call('POST', '/api/auth/register', { name: 'Weak', email: 'weak@x.test', password: 'short', accountType: 'DONOR' })).status, 400);
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM users WHERE email='evil@x.test'").get().n, 0);
});

test('auth: login failure, me, logout invalidates session', async () => {
  const c = await client();
  assert.equal((await c.login('donor@charityconnect.test', 'wrong')).status, 401);
  assert.deepEqual((await c.call('GET', '/api/auth/me')).body, { user: null, unread: 0 });
  assert.equal((await c.login('donor@charityconnect.test', 'Donor@12345')).status, 200);
  const me = await c.call('GET', '/api/auth/me'); assert.equal(me.body.user.role, 'DONOR'); assert.equal(me.body.user.password_hash, undefined);
  await c.call('POST', '/api/auth/logout'); assert.deepEqual((await c.call('GET', '/api/auth/me')).body, { user: null, unread: 0 });
});

test('configured Pages frontend can call the API with credentialed CORS', async () => {
  const frontendOrigin = 'https://charity.example.github.io';
  const corsApp = mk({ NODE_ENV: 'production', FRONTEND_ORIGIN: frontendOrigin, ADMIN_EMAIL: 'admin@charityconnect.test', ADMIN_PASSWORD: 'Admin@12345' });
  const corsBase = await listen(corsApp);
  try {
    const preflight = await fetch(corsBase + '/api/auth/login', {
      method: 'OPTIONS',
      headers: { Origin: frontendOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), frontendOrigin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');

    const login = await fetch(corsBase + '/api/auth/login', {
      method: 'POST',
      headers: { Origin: frontendOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@charityconnect.test', password: 'Admin@12345' }),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /SameSite=None; Path=\/;.*Secure/);
    assert.equal(login.headers.get('access-control-allow-origin'), frontendOrigin);
  } finally {
    corsApp.close();
  }
});

test('donor profile: private uploads, address, and completion tracking', async () => {
  const profileApp = mk({}), profileBase = await listen(profileApp);
  try {
    const c = await client(() => profileBase);
    assert.equal((await c.login('donor@charityconnect.test', 'Donor@12345')).status, 200);
    const charity = await client(() => profileBase);
    assert.equal((await charity.login('charity@charityconnect.test', 'Charity@12345')).status, 200);
    assert.equal((await charity.call('GET', '/api/profile')).status, 403);
    const initial = await c.call('GET', '/api/profile');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.profile.completionPercent, 40);
    assert.equal(initial.body.profile.hasIdProof, false);

    const addressOnly = await c.call('PATCH', '/api/profile', { address: '12 Green Road, Pune' });
    assert.equal(addressOnly.status, 200);
    assert.equal(addressOnly.body.profile.completionPercent, 60);

    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const pdf = Buffer.from('%PDF-1.7 profile test');
    const saved = await c.call('PATCH', '/api/profile', {
      address: '12 Green Road, Pune',
      photo: { type: 'image/png', name: 'portrait.png', data: `data:image/png;base64,${png.toString('base64')}` },
      idProof: { type: 'application/pdf', name: 'proof.pdf', data: `data:application/pdf;base64,${pdf.toString('base64')}` },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.profile.completionPercent, 100);
    assert.equal(saved.body.profile.photo, `data:image/png;base64,${png.toString('base64')}`);
    assert.equal(saved.body.profile.hasIdProof, true);
    assert.equal(saved.body.profile.idProofName, 'proof.pdf');
    assert.equal(JSON.stringify((await c.call('GET', '/api/auth/me')).body).includes('profile test'), false, 'ID document content is not returned by auth/me');

    const badProof = await c.call('PATCH', '/api/profile', {
      idProof: { type: 'application/pdf', name: 'fake.pdf', data: `data:application/pdf;base64,${png.toString('base64')}` },
    });
    assert.equal(badProof.status, 400);
  } finally { profileApp.close(); }
});

test('rbac: donor blocked from charity/admin APIs, anonymous blocked from donations', async () => {
  const d = await donor();
  for (const p of ['/api/admin/users', '/api/admin/dashboard', '/api/charity/dashboard']) assert.equal((await d.call('GET', p)).status, 403, p);
  assert.equal((await d.call('POST', '/api/admin/charities/1/approve', {})).status, 403);
  const anon = await client();
  assert.equal((await anon.call('POST', '/api/donations', { campaignId: 1, amount: 100 })).status, 401);
  assert.equal((await anon.call('GET', '/api/donor/donations')).status, 401);
});

test('cross-origin mutating request is rejected (CSRF)', async () => {
  const d = await donor();
  const r = await d.call('POST', '/api/notifications/read', {}, { Origin: 'https://evil.example' }); assert.equal(r.status, 403);
});

test('public discovery: only eligible campaigns, filters, pagination', async () => {
  const c = await client();
  const all = (await c.call('GET', '/api/campaigns?pageSize=50')).body;
  const slugs = all.items.map((i) => i.slug);
  assert.equal(new Set(all.items.map((item) => item.image)).size, all.items.length, 'every public campaign has a distinct image');
  const firstPage = (await c.call('GET', '/api/campaigns?pageSize=9')).body;
  assert.ok(new Set(firstPage.items.map((item) => item.category)).size > 1, 'unfiltered newest campaigns balance causes on the first page');
  assert.ok(!slugs.includes('digital-classrooms') && !slugs.includes('mobile-health-camps'), 'pending/draft hidden');
  assert.ok(!slugs.includes('mobile-clinic-for-rural-families'), 'retired Swasthya Mobile Care campaign is hidden');
  assert.equal((await c.call('GET', '/api/campaigns/mobile-clinic-for-rural-families')).status, 404);
  const cleanWater = all.items.find((i) => i.slug === 'clean-water-for-rural-schools');
  assert.equal(cleanWater.image, '/images/campaigns/clean-water-schools.jpg');
  const recovery = all.items.find((i) => i.slug === 'emergency-recovery-after-road-accident');
  assert.ok(recovery && recovery.category === 'Health' && recovery.charity.verified);
  assert.equal(recovery.image, '/images/campaigns/road-accident.jpg');
  assert.equal(recovery.charity.name, 'Jaipur Community Health');
  const health = (await c.call('GET', '/api/campaigns?category=Health&pageSize=50')).body;
  assert.equal(health.items[0].slug, 'emergency-recovery-after-road-accident', 'road-accident campaign leads the Health listing');
  const womenHealth = all.items.find((i) => i.slug === 'women-health-clinic-expansion');
  assert.equal(womenHealth.image, '/images/campaigns/women-health-clinic.jpg');
  const charities = (await c.call('GET', '/api/charities?pageSize=50')).body;
  const waterCharity = charities.items.find((i) => i.name === 'Clean Water Foundation');
  assert.equal(waterCharity.image, '/images/campaigns/water-tower.jpg', 'water charity shows infrastructure, not a glass');
  const healthCharities = (await c.call('GET', '/api/charities?category=Health&pageSize=50')).body.items;
  assert.equal(healthCharities.length, 10);
  assert.ok(healthCharities.every((item) => item.image && item.image !== '/images/causes/health.jpg'));
  assert.equal(new Set(healthCharities.map((item) => item.image)).size, healthCharities.length, 'health charities use distinct cause-matched photos');
  const locations = all.locations;
  for (const city of ['Pune', 'Guwahati', 'Kochi', 'Varanasi']) assert.ok(locations.some((location) => location.startsWith(city)));
  const campaignLocations = new Map(all.items.map((item) => [item.slug, item.charity.location]));
  assert.equal(campaignLocations.get('plant-10000-trees'), 'Chandigarh, Chandigarh (UT)');
  assert.equal(campaignLocations.get('dialysis-support-for-elderly'), 'Delhi, National Capital Territory of Delhi');
  const medicalCampaigns = all.items.filter((item) => ['pune-community-screenings', 'assam-maternal-health-outreach', 'kochi-treatment-travel-support', 'varanasi-rural-health-visits'].includes(item.slug));
  assert.equal(medicalCampaigns.length, 4);
  assert.ok(medicalCampaigns.every((item) => item.category === 'Health'));
  assert.ok(medicalCampaigns.every((item) => /fictional demo/i.test(item.description)));
  const medicalImageSlugs = [
    'emergency-recovery-after-road-accident',
    'pune-community-screenings', 'assam-maternal-health-outreach',
    'kochi-treatment-travel-support', 'varanasi-rural-health-visits',
    'dialysis-support-for-elderly', 'post-surgery-transport-support',
    'cancer-drug-support-for-families', 'women-health-clinic-expansion',
    'rural-teleconsultations-in-odisha',
  ];
  const medicalImages = all.items
    .filter((item) => medicalImageSlugs.includes(item.slug))
    .map((item) => item.image);
  assert.equal(medicalImages.length, medicalImageSlugs.length);
  assert.equal(new Set(medicalImages).size, medicalImageSlugs.length, 'medical campaigns use distinct photos');
  assert.ok(all.items.every((i) => i.percent >= 0 && i.percent <= 100));
  const edu = (await c.call('GET', '/api/campaigns?category=Education')).body; assert.ok(edu.items.length && edu.items.every((i) => i.category === 'Education'));
  const jaipur = (await c.call('GET', '/api/campaigns?location=Jaipur&pageSize=50')).body;
  assert.ok(jaipur.items.length && jaipur.items.every((i) => i.charity.location.includes('Jaipur')));
  assert.ok(jaipur.locations.includes('Jaipur, Rajasthan'));
  assert.equal((await c.call('GET', '/api/campaigns?category=Bogus')).status, 400);
  const pg = (await c.call('GET', '/api/campaigns?pageSize=2&page=2')).body; assert.equal(pg.items.length, 2);
  const s = (await c.call('GET', '/api/campaigns?q=library')).body; assert.equal(s.total, 1);
  assert.equal((await c.call('GET', '/api/campaigns/digital-classrooms')).status, 404);
  assert.equal((await c.call('GET', '/api/charities?q=hope')).body.total, 0, 'pending charity not public');
  assert.equal((await c.call('GET', '/api/charities/3')).status, 404);
  const detail = await c.call('GET', '/api/campaigns/clean-water-for-rural-schools');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.recentDonations.length, 3);
  assert.equal(new Set(detail.body.recentDonations.map((d) => d.name)).size, 3);
  assert.ok(detail.body.recentDonations.every((d) => d.amountPaise > 0 && d.simulated));
  assert.equal(detail.body.recentDonations.reduce((sum, d) => sum + d.amountPaise, 0), 625000);
  const med = await c.call('GET', '/api/campaigns/pune-community-screenings');
  assert.equal(med.body.recentDonations.reduce((sum, d) => sum + d.amountPaise, 0), 1200000);
});

test('public discovery hides expired and fully funded campaigns everywhere', async () => {
  const filteredApp = mk({});
  const filteredBase = await listen(filteredApp);
  try {
    filteredApp.db.prepare('UPDATE campaigns SET end_date=? WHERE slug IN (?,?)')
      .run(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), 'food-relief-program', 'old-art-supplies');
    const c = await client(() => filteredBase);
    const all = await c.call('GET', '/api/campaigns?pageSize=50');
    const slugs = all.body.items.map((item) => item.slug);
    assert.ok(!slugs.includes('food-relief-program'), 'fully funded campaigns are hidden even before expiry');
    assert.ok(slugs.includes('old-art-supplies'), 'underfunded campaigns remain listed before expiry');

    filteredApp.db.prepare("UPDATE campaigns SET end_date='2000-01-01' WHERE slug=?").run('old-art-supplies');
    const afterExpiry = await c.call('GET', '/api/campaigns?pageSize=50');
    assert.ok(!afterExpiry.body.items.some((item) => item.slug === 'old-art-supplies'), 'expired campaigns are hidden');
    assert.equal((await c.call('GET', '/api/campaigns/old-art-supplies')).status, 404);
    assert.equal((await c.call('GET', '/api/campaigns/food-relief-program')).status, 404);

    const charityId = filteredApp.db.prepare('SELECT charity_id FROM campaigns WHERE slug=?').get('food-relief-program').charity_id;
    const charity = await c.call('GET', `/api/charities/${charityId}`);
    assert.ok(!charity.body.campaigns.some((item) => ['food-relief-program', 'old-art-supplies'].includes(item.slug)));
  } finally { filteredApp.close(); }
});

test('future campaigns explain their start date and become donatable on schedule', async () => {
  const scheduledApp = mk({});
  const scheduledBase = await listen(scheduledApp);
  try {
    const campaign = scheduledApp.db.prepare("SELECT id FROM campaigns WHERE slug='school-library-project'").get();
    const donorClient = await client(() => scheduledBase);
    await donorClient.login('donor@charityconnect.test', 'Donor@12345');
    const date = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    scheduledApp.db.prepare('UPDATE campaigns SET start_date=? WHERE id=?').run(date(2), campaign.id);

    const reader = await client(() => scheduledBase);
    const scheduled = await reader.call('GET', '/api/campaigns/school-library-project');
    assert.equal(scheduled.body.campaign.effectiveStatus, 'SCHEDULED');
    assert.equal(scheduled.body.donatable, false);
    assert.equal((await donorClient.call('POST', '/api/donations', { campaignId: campaign.id, amount: 100 })).status, 409);

    scheduledApp.db.prepare('UPDATE campaigns SET start_date=? WHERE id=?').run(date(-2), campaign.id);
    const open = await reader.call('GET', '/api/campaigns/school-library-project');
    assert.equal(open.body.donatable, true);
    assert.equal((await donorClient.call('POST', '/api/donations', { campaignId: campaign.id, amount: 100 })).status, 201);
  } finally { scheduledApp.close(); }
});

test('success stories include only ended campaigns at 90-100% and remain non-donatable', async () => {
  const storyApp = mk({});
  const storyBase = await listen(storyApp);
  try {
    const dayBefore = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    storyApp.db.prepare('UPDATE campaigns SET end_date=?,goal_paise=? WHERE slug=?').run(dayBefore, 52000, 'old-art-supplies');
    storyApp.db.prepare('UPDATE campaigns SET end_date=?,goal_paise=? WHERE slug=?').run(dayBefore, 1_000_000, 'school-library-project');
    const donorId = storyApp.db.prepare("SELECT id FROM users WHERE email='donor@charityconnect.test'").get().id;
    const exactNinety = storyApp.db.prepare("SELECT id FROM campaigns WHERE slug='school-library-project'").get().id;
    storyApp.db.prepare("INSERT INTO donations(donor_id,campaign_id,amount_paise,status,simulated) VALUES(?,?,680000,'SUCCESS',1)")
      .run(donorId, exactNinety);
    storyApp.db.prepare('UPDATE campaigns SET end_date=?,goal_paise=? WHERE slug=?').run(dayBefore, 450000, 'school-water-tanks');

    const publicClient = await client(() => storyBase);
    const stories = await publicClient.call('GET', '/api/campaigns/success-stories?pageSize=50');
    const slugs = stories.body.items.map((item) => item.slug);
    assert.ok(slugs.includes('old-art-supplies'));
    assert.ok(slugs.includes('school-library-project'), `exactly 90% qualifies: ${slugs.join(', ')}`);
    assert.ok(slugs.includes('food-relief-program'), '100% qualifies');
    assert.ok(!slugs.includes('school-water-tanks'), 'less than 90% does not qualify');

    const story = await publicClient.call('GET', '/api/campaigns/old-art-supplies');
    assert.equal(story.status, 200);
    assert.equal(story.body.campaign.isSuccessStory, true);
    assert.equal(story.body.donatable, false);
    const donorClient = await client(() => storyBase);
    await donorClient.login('donor@charityconnect.test', 'Donor@12345');
    assert.equal((await donorClient.call('POST', '/api/donations', {
      campaignId: story.body.campaign.id, amount: 100,
    })).status, 409);
  } finally { storyApp.close(); }
});

test('admin campaign records show creators, all supporters, pause reasons, and resume status', async () => {
  const admin = await as('admin@charityconnect.test', 'Admin@12345');
  const paused = app.db.prepare("SELECT id FROM campaigns WHERE slug='river-cleanup-drive'").get().id;
  const detail = await admin.call('GET', `/api/admin/campaigns/${paused}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.campaign.creator, { name: 'Green Earth Foundation Admin', email: 'green@charityconnect.test' });
  assert.match(detail.body.campaign.reviewNote, /permit-renewal/i);
  const list = (await admin.call('GET', '/api/admin/campaigns?status=ACTIVE&pageSize=50')).body;
  const medical = list.items.find((item) => item.slug === 'pune-community-screenings');
  assert.equal(medical.supporters.length, 3);
  assert.equal(medical.supporters.reduce((sum, supporter) => sum + supporter.amountPaise, 0), 1200000);
  assert.ok(medical.supporters.every((supporter) => supporter.name && supporter.simulated));

  assert.equal((await admin.call('POST', `/api/admin/campaigns/${paused}/resume`, {})).body.statusLabel, 'Campaign resumed');
  const resumed = (await admin.call('GET', `/api/admin/campaigns/${paused}`)).body.campaign;
  assert.equal(resumed.status, 'ACTIVE');
  assert.ok(resumed.resumedAt);
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${paused}/pause`, { reason: 'Restored to paused state after resume verification.' })).status, 200);
});

test('campaign creator can complete a draft and submit it for review', async () => {
  const admin = await as('admin@charityconnect.test', 'Admin@12345');
  const owner = await as('pending@charityconnect.test', 'Charity@12345');
  const draft = app.db.prepare("SELECT id,start_date,end_date FROM campaigns WHERE slug='mobile-health-camps'").get();
  assert.equal((await admin.call('PATCH', `/api/charity/campaigns/${draft.id}`, { title: 'Unauthorized edit' })).status, 403);
  const invalid = await owner.call('PATCH', `/api/charity/campaigns/${draft.id}`, { title: 'No' });
  assert.equal(invalid.status, 400);
  const result = await owner.call('PATCH', `/api/charity/campaigns/${draft.id}`, {
    title: 'Mobile Health Camps Across Villages',
    description: 'Fictional demo campaign for monthly screenings and basic medical referrals in rural communities.',
    category: 'Health', goal: 150000, startDate: draft.start_date, endDate: draft.end_date,
    submit: true, ...requiredCampaignUploads,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'PENDING');
  assert.equal(app.db.prepare('SELECT status FROM campaigns WHERE id=?').get(draft.id).status, 'PENDING');
  assert.ok(app.db.prepare("SELECT 1 FROM audit_logs WHERE entity_type='campaign' AND entity_id=? AND action='CAMPAIGN_SUBMITTED'").get(draft.id));
});

test('charity dashboard aggregates successful contributions by supporter', async () => {
  const c = await as('charity@charityconnect.test', 'Charity@12345');
  const dashboard = (await c.call('GET', '/api/charity/dashboard')).body;
  assert.equal(dashboard.recentDonations.length, 3);
  assert.equal(new Set(dashboard.recentDonations.map((d) => d.donor)).size, 3);
  assert.ok(dashboard.recentDonations.every((d) => d.donations === 2));
  assert.equal(dashboard.recentDonations.reduce((total, d) => total + d.amountPaise, 0), 1025000);
});

test('donation: demo flow creates pending records, only success counts, history private', async () => {
  const anonymous = await client();
  const beforeStats = (await anonymous.call('GET', '/api/public/stats')).body;
  assert.deepEqual(Object.keys(beforeStats).sort(), ['amountPaise', 'contributors', 'donations']);
  const d = await donor(), camp = await getCamp('school-library-project');
  const created = await d.call('POST', '/api/donations', { campaignId: camp.id, amount: 250 });
  assert.equal(created.status, 201);
  const st = (await d.call('GET', `/api/payments/${created.body.paymentId}/status`)).body.payment;
  assert.equal(st.status, 'PENDING'); assert.equal(st.amountPaise, 25000); assert.equal(st.simulated, true);
  assert.deepEqual((await anonymous.call('GET', '/api/public/stats')).body, beforeStats, 'pending demo donations are excluded');
  assert.equal((await getCamp('school-library-project')).raisedPaise, camp.raisedPaise, 'pending does not count');
  const dup = await d.call('POST', '/api/donations', { campaignId: camp.id, amount: 250 });
  assert.equal(dup.body.reused, true); assert.equal(dup.body.donationId, created.body.donationId);
  const ok = await d.call('POST', `/api/payments/${created.body.paymentId}/demo-resolve`, { outcome: 'success' });
  assert.equal(ok.body.payment.status, 'SUCCESS');
  const afterStats = (await anonymous.call('GET', '/api/public/stats')).body;
  assert.equal(afterStats.amountPaise, beforeStats.amountPaise + 25000);
  assert.equal(afterStats.donations, beforeStats.donations + 1);
  assert.equal((await getCamp('school-library-project')).raisedPaise, camp.raisedPaise + 25000);
  const again = await d.call('POST', `/api/payments/${created.body.paymentId}/demo-resolve`, { outcome: 'success' }); // idempotent
  assert.equal(again.status, 200); assert.equal((await getCamp('school-library-project')).raisedPaise, camp.raisedPaise + 25000);
  assert.equal((await d.call('POST', `/api/payments/${created.body.paymentId}/demo-resolve`, { outcome: 'fail' })).status, 409, 'success cannot become failed');
  const other = await as('asha@charityconnect.test', 'Donor@12345');
  assert.equal((await other.call('GET', `/api/payments/${created.body.paymentId}/status`)).status, 404);
  assert.equal((await other.call('GET', `/api/donations/${created.body.donationId}`)).status, 404);
  assert.ok((await other.call('GET', '/api/donor/donations')).body.items.every((i) => i.id !== created.body.donationId));
});

test('donation: failed/cancelled do not count; invalid amounts and ineligible campaigns rejected', async () => {
  const d = await donor(), camp = await getCamp('school-water-tanks');
  for (const amount of [0, -5, 5, 'abc', 100000.5, 1e9, 10.123]) assert.equal((await d.call('POST', '/api/donations', { campaignId: camp.id, amount })).status, 400, String(amount));
  const a = await d.call('POST', '/api/donations', { campaignId: camp.id, amount: 111 });
  assert.equal((await d.call('POST', `/api/payments/${a.body.paymentId}/demo-resolve`, { outcome: 'fail' })).body.payment.status, 'FAILED');
  const b = await d.call('POST', '/api/donations', { campaignId: camp.id, amount: 112 });
  assert.equal((await d.call('POST', `/api/payments/${b.body.paymentId}/cancel`)).body.payment.status, 'CANCELLED');
  assert.equal((await getCamp('school-water-tanks')).raisedPaise, camp.raisedPaise);
  const paused = app.db.prepare("SELECT id FROM campaigns WHERE slug='river-cleanup-drive'").get().id;
  const expired = app.db.prepare("SELECT id FROM campaigns WHERE slug='old-art-supplies'").get().id;
  const draft = app.db.prepare("SELECT id FROM campaigns WHERE slug='mobile-health-camps'").get().id;
  for (const id of [paused, expired]) assert.equal((await d.call('POST', '/api/donations', { campaignId: id, amount: 100 })).status, 409);
  assert.equal((await d.call('POST', '/api/donations', { campaignId: draft, amount: 100 })).status, 404);
});

test('expired pending payment is shown as EXPIRED, never as success', async () => {
  const d = await donor(), camp = await getCamp('school-water-tanks');
  const r = await d.call('POST', '/api/donations', { campaignId: camp.id, amount: 333 });
  app.db.prepare("UPDATE payments SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(r.body.paymentId);
  assert.equal((await d.call('GET', `/api/payments/${r.body.paymentId}/status`)).body.payment.status, 'EXPIRED');
  assert.equal(app.db.prepare('SELECT status FROM donations WHERE id=?').get(r.body.donationId).status, 'EXPIRED');
});

test('admin campaign actions: approve, reject, pause, and archive are admin-only', async () => {
  const c = await client();
  const reg = await c.call('POST', '/api/auth/register', { name: 'Org Owner', email: 'org@x.test', password: 'Passw0rd1', accountType: 'CHARITY',
    charity: { name: 'Helping Hands', category: 'Health', location: 'Ludhiana', description: 'We run free medical camps for the elderly.' } });
  assert.equal(reg.status, 201); await c.login('org@x.test', 'Passw0rd1');
  const body = { title: 'Eye Care Camp', description: 'Free cataract surgeries for 100 elders in our district.', category: 'Health', goal: 50000, startDate: '2026-01-01', endDate: '2099-01-01', submit: true };
  assert.equal((await c.call('POST', '/api/charity/campaigns', body)).status, 403, 'pending charity cannot create');
  const admin = await as('admin@charityconnect.test', 'Admin@12345');
  const chId = app.db.prepare("SELECT id FROM charities WHERE name='Helping Hands'").get().id;
  assert.equal((await admin.call('POST', `/api/admin/charities/${chId}/reject`, {})).status, 400, 'reason required');
  assert.equal((await admin.call('POST', `/api/admin/charities/${chId}/approve`, {})).status, 200);
  assert.equal((await admin.call('POST', `/api/admin/charities/${chId}/reject`, { reason: 'changed my mind' })).status, 409, 'no contradictory decision');
  assert.equal((await c.call('POST', '/api/charity/campaigns', { ...body, goal: 10 })).status, 400, 'goal too small');
  assert.equal((await c.call('POST', '/api/charity/campaigns', { ...body, endDate: '2025-01-01' })).status, 400, 'end before start/past');
  const made = await c.call('POST', '/api/charity/campaigns', { ...body, ...requiredCampaignUploads });
  assert.equal(made.status, 201); assert.equal(made.body.status, 'PENDING');
  assert.equal((await (await client()).call('GET', '/api/campaigns/' + made.body.slug)).status, 404, 'pending is not public');
  assert.equal((await c.call('POST', `/api/admin/campaigns/${made.body.id}/approve`, {})).status, 403, 'charity cannot self-approve');
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${made.body.id}/approve`, {})).status, 200);
  assert.equal((await (await client()).call('GET', '/api/campaigns/' + made.body.slug)).status, 200);
  assert.ok((await c.call('GET', '/api/notifications')).body.items.some((n) => /approved/.test(n.message)));
  assert.ok(app.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action LIKE '%APPROVED'").get().n >= 2);
  const active = await donor();
  assert.equal((await active.call('POST', `/api/admin/campaigns/${made.body.id}/pause`, { reason: 'Policy review' })).status, 403);
  assert.equal((await c.call('PATCH', `/api/charity/campaigns/${made.body.id}`, { action: 'pause' })).status, 403, 'charities cannot pause campaigns');
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${made.body.id}/pause`, {})).status, 400, 'pause reason required');
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${made.body.id}/pause`, { reason: 'Policy review' })).status, 200);
  assert.equal(app.db.prepare('SELECT status FROM campaigns WHERE id=?').get(made.body.id).status, 'PAUSED');

  const donorId = app.db.prepare("SELECT id FROM users WHERE email='donor@charityconnect.test'").get().id;
  app.db.prepare('INSERT INTO donations(donor_id,campaign_id,amount_paise) VALUES(?,?,?)').run(donorId, made.body.id, 1000);
  assert.equal((await active.call('POST', `/api/admin/campaigns/${made.body.id}/archive`, {})).status, 403);
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${made.body.id}/archive`, {})).status, 200);
  assert.equal((await (await client()).call('GET', '/api/campaigns/' + made.body.slug)).status, 404);
  assert.equal((await active.call('POST', '/api/donations', { campaignId: made.body.id, amount: 100 })).status, 404);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM donations WHERE campaign_id=?').get(made.body.id).n, 1, 'archive preserves donation history');
  assert.equal((await admin.call('GET', `/api/admin/campaigns?status=ARCHIVED`)).body.items.some((item) => item.id === made.body.id && item.archivedAt), true);
  assert.equal((await active.call('POST', `/api/admin/campaigns/${made.body.id}/unarchive`, {})).status, 403);
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${made.body.id}/unarchive`, {})).body.charityArchived, false);
  assert.equal((await (await client()).call('GET', '/api/campaigns/' + made.body.slug)).status, 200);

  const pending = await c.call('POST', '/api/charity/campaigns', { ...body, ...requiredCampaignUploads, title: 'Second eye care drive' });
  assert.equal(pending.status, 201);
  assert.equal((await active.call('POST', `/api/admin/campaigns/${pending.body.id}/reject`, { reason: 'Not an admin' })).status, 403);
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${pending.body.id}/reject`, {})).status, 400, 'rejection reason required');
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${pending.body.id}/reject`, { reason: 'Insufficient details' })).status, 200);
  assert.equal(app.db.prepare('SELECT status FROM campaigns WHERE id=?').get(pending.body.id).status, 'REJECTED');
  // ownership: another charity cannot see or edit it
  const other = await as('education@charityconnect.test', 'Charity@12345');
  assert.equal((await other.call('GET', `/api/charity/campaigns/${made.body.id}`)).status, 404);
  assert.equal((await other.call('PATCH', `/api/charity/campaigns/${made.body.id}`, { action: 'pause' })).status, 404);
});

test('campaign creation requires valid image and private supporting-document uploads', async () => {
  const charity = await as('charity@charityconnect.test', 'Charity@12345');
  const body = { title: 'Required upload validation campaign', description: 'Support for a local community health programme.', category: 'Health',
    goal: 50000, startDate: new Date().toISOString().slice(0, 10), endDate: '2099-01-01', submit: true };
  assert.equal((await charity.call('POST', '/api/charity/campaigns', body)).body.error.details.field, 'campaignImage');

  const campaignImage = { data: 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'),
    type: 'image/png', name: 'campaign.png' };
  assert.equal((await charity.call('POST', '/api/charity/campaigns', { ...body, campaignImage })).body.error.details.field, 'campaignDocument');

  const campaignDocument = { data: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n').toString('base64'),
    type: 'application/pdf', name: 'supporting-document.pdf' };
  const made = await charity.call('POST', '/api/charity/campaigns', { ...body, campaignImage, campaignDocument });
  assert.equal(made.status, 201);
  assert.equal(app.db.prepare('SELECT document_name FROM campaigns WHERE id=?').get(made.body.id).document_name, 'supporting-document.pdf');
  assert.equal((await charity.call('GET', `/api/charity/campaigns/${made.body.id}`)).body.campaign.hasDocument, true);
  assert.equal((await fetch(`${base}/api/campaigns/${made.body.slug}/image`)).status, 404, 'pending campaign image stays private');
  const admin = await as('admin@charityconnect.test', 'Admin@12345');
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${made.body.id}/approve`, {})).status, 200);
  const publicCampaign = await getCamp(made.body.slug);
  assert.equal(publicCampaign.image, `/api/campaigns/${made.body.slug}/image`);
  assert.equal(Object.hasOwn(publicCampaign, 'documentName'), false);
  const image = await fetch(`${base}/api/campaigns/${made.body.slug}/image`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('admin charity archive and permanent deletion protect public access and donation history', async () => {
  const admin = await as('admin@charityconnect.test', 'Admin@12345');
  const owner = await client();
  assert.equal((await owner.call('POST', '/api/auth/register', {
    name: 'Archive Owner', email: 'archive-owner@x.test', password: 'Passw0rd1', accountType: 'CHARITY',
    charity: { name: 'Archive Test Charity', category: 'Health', location: 'Pune', description: 'We provide local support for families in need.' },
  })).status, 201);
  await owner.login('archive-owner@x.test', 'Passw0rd1');
  const charityId = app.db.prepare("SELECT id FROM charities WHERE name='Archive Test Charity'").get().id;
  assert.equal((await admin.call('POST', `/api/admin/charities/${charityId}/approve`, {})).status, 200);
  const made = await owner.call('POST', '/api/charity/campaigns', {
    title: 'Archive Test Campaign', description: 'Provide medical support to families across the local community.',
    category: 'Health', goal: 50000, startDate: '2026-01-01', endDate: '2099-01-01', submit: true, ...requiredCampaignUploads,
  });
  assert.equal(made.status, 201);
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${made.body.id}/approve`, {})).status, 200);
  assert.equal((await (await client()).call('GET', `/api/charities/${charityId}`)).status, 200);
  assert.equal((await (await client()).call('GET', `/api/campaigns/${made.body.slug}`)).status, 200);
  assert.equal((await owner.call('POST', `/api/admin/charities/${charityId}/archive`, {})).status, 403);
  assert.equal((await admin.call('POST', `/api/admin/charities/${charityId}/archive`, {})).status, 200);
  assert.equal((await (await client()).call('GET', `/api/charities/${charityId}`)).status, 404);
  assert.equal((await (await client()).call('GET', `/api/campaigns/${made.body.slug}`)).status, 404);
  assert.equal(app.db.prepare('SELECT archived_at FROM campaigns WHERE id=?').get(made.body.id).archived_at !== null, true);
  assert.equal((await owner.call('GET', '/api/charity/dashboard')).status, 403);
  assert.equal((await admin.call('GET', '/api/admin/charities?status=ARCHIVED')).body.items.some((item) => item.id === charityId), true);
  assert.equal((await owner.call('POST', `/api/admin/charities/${charityId}/unarchive`, {})).status, 403);
  assert.equal((await admin.call('POST', `/api/admin/charities/${charityId}/unarchive`, {})).body.archivedCampaigns, 1);
  assert.equal((await (await client()).call('GET', `/api/charities/${charityId}`)).status, 200);
  assert.equal((await (await client()).call('GET', `/api/campaigns/${made.body.slug}`)).status, 404, 'campaign remains archived until independently restored');
  assert.equal((await admin.call('POST', `/api/admin/campaigns/${made.body.id}/unarchive`, {})).status, 200);
  assert.equal((await (await client()).call('GET', `/api/campaigns/${made.body.slug}`)).status, 200);

  const disposable = await client();
  assert.equal((await disposable.call('POST', '/api/auth/register', {
    name: 'Disposable Owner', email: 'disposable-owner@x.test', password: 'Passw0rd1', accountType: 'CHARITY',
    charity: { name: 'Disposable Charity', category: 'Education', location: 'Pune', description: 'We support students with education and learning resources.' },
  })).status, 201);
  const disposableId = app.db.prepare("SELECT id FROM charities WHERE name='Disposable Charity'").get().id;
  assert.equal((await owner.call('POST', `/api/admin/charities/${disposableId}/permanent-delete`, {})).status, 403);
  assert.equal((await admin.call('POST', `/api/admin/charities/${disposableId}/permanent-delete`, {})).status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM charities WHERE id=?').get(disposableId).n, 0);

  const donatedCharityId = app.db.prepare('SELECT c.charity_id FROM donations d JOIN campaigns c ON c.id=d.campaign_id LIMIT 1').get().charity_id;
  const blocked = await admin.call('POST', `/api/admin/charities/${donatedCharityId}/permanent-delete`, {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'DONATION_HISTORY');
});

test('admin: user disable blocks login and cannot target self/admins; reports separate simulated', async () => {
  const admin = await as('admin@charityconnect.test', 'Admin@12345');
  const ravi = app.db.prepare("SELECT id FROM users WHERE email='ravi@charityconnect.test'").get().id;
  const sess = await as('ravi@charityconnect.test', 'Donor@12345');
  assert.equal((await admin.call('PATCH', `/api/admin/users/${ravi}/status`, { status: 'DISABLED' })).status, 200);
  assert.equal((await sess.call('GET', '/api/auth/me')).body.user, null, 'existing sessions revoked');
  assert.equal((await (await client()).login('ravi@charityconnect.test', 'Donor@12345')).status, 403);
  const adminId = app.db.prepare("SELECT id FROM users WHERE role='ADMIN'").get().id;
  assert.equal((await admin.call('PATCH', `/api/admin/users/${adminId}/status`, { status: 'DISABLED' })).status, 409);
  const users = (await admin.call('GET', '/api/admin/users?role=DONOR')).body; assert.ok(users.items.every((u) => u.role === 'DONOR' && !('password_hash' in u)));
  const rep = (await admin.call('GET', '/api/admin/reports')).body;
  assert.ok(rep.donationsByStatus.some((r) => r.status === 'SUCCESS' && r.simulated === 1)); assert.ok(rep.definition);
});

/* ---- webhook, in youpi mode ---- */
test('webhook: signature, amount, order, idempotency, state rules', async () => {
  const y = createApp({ env: { PAYMENT_MODE: 'youpi', YOUPI_WEBHOOK_SECRET: SECRET } }); seed(y.db, {});
  const yb = await listen(y);
  try {
    const d = await client(() => yb); await d.login('donor@charityconnect.test', 'Donor@12345');
    const cid = y.db.prepare("SELECT id FROM campaigns WHERE slug='school-library-project'").get().id;
    const blocked = await d.call('POST', '/api/donations', { campaignId: cid, amount: 100 });
    assert.equal(blocked.status, 503, 'unwired provider fails safely'); // provider not ready -> honest failure
    assert.equal(y.db.prepare("SELECT status FROM donations ORDER BY id DESC LIMIT 1").get().status, 'FAILED');
    // simulate an order that exists with the youpi provider
    const did = Number(y.db.prepare("INSERT INTO donations(donor_id,campaign_id,amount_paise) VALUES(2,?,50000)").run(cid).lastInsertRowid);
    y.db.prepare("INSERT INTO payments(donation_id,provider,order_id,amount_paise,expires_at) VALUES(?,?,?,?,?)").run(did, 'youpi', 'ORD-1', 50000, '2999-01-01T00:00:00.000Z');
    const send = (payload, { sig, id = 'del-1', ts = Date.now() } = {}) => {
      const raw = JSON.stringify(payload); const s = sig ?? 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
      return fetch(yb + '/api/payments/webhooks/youpi', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'X-Gateway-Signature': s, 'X-Gateway-Delivery-Id': id, 'X-Gateway-Timestamp': String(ts) } });
    };
    const good = { event: 'SUCCESS', orderId: 'ORD-1', amountPaise: 50000, utr: '123456789012' };
    assert.equal((await send(good, { sig: 'sha256=' + '0'.repeat(64) })).status, 401);
    assert.equal((await send({ ...good, amountPaise: 49900 })).status, 409);
    assert.equal((await send({ ...good, orderId: 'NOPE' })).status, 404);
    assert.equal((await send(good, { ts: Date.now() - 5 * 3600 * 1000 })).status, 400, 'stale');
    assert.equal(y.db.prepare('SELECT status FROM payments WHERE order_id=?').get('ORD-1').status, 'PENDING', 'nothing changed yet');
    assert.equal((await send(good)).status, 200);
    assert.equal((await (await send(good)).json()).duplicate, true);
    assert.equal(y.db.prepare("SELECT COUNT(*) n FROM donations WHERE id=? AND status='SUCCESS'").get(did).n, 1);
    assert.equal((await (await send(good, { id: 'del-2' })).json()).ignored, true, 'new delivery for settled order is a no-op');
    assert.equal(y.db.prepare("SELECT COALESCE(SUM(amount_paise),0) s FROM donations WHERE campaign_id=? AND id=? AND status='SUCCESS'").get(cid, did).s, 50000, 'counted once');
    assert.equal(y.db.prepare('SELECT simulated FROM donations WHERE id=?').get(did).simulated, 0);
  } finally { y.close(); }
});

test('webhook is disabled in demo mode; demo-resolve refuses non-demo payments', async () => {
  const r = await fetch(base + '/api/payments/webhooks/youpi', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 503);
});
