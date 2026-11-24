import { existsSync, readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDb } from './db.js';
import { hashPw } from './app.js';

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ts = (n) => new Date(Date.now() + n * 86400000).toISOString().replace('T', ' ').slice(0, 19);
const tsThisMonth = (daysAgo = 0) => {
  const now = new Date();
  const dayOfMonth = Math.max(1, now.getUTCDate() - Math.min(daysAgo, now.getUTCDate() - 1));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth)).toISOString().replace('T', ' ').slice(0, 19);
};

/** Idempotent: users/charities/campaigns use INSERT OR IGNORE on unique keys; demo donations are only created once. */
export function seed(db, env = process.env) {
  const prod = env.NODE_ENV === 'production';
  // Demo data is seeded everywhere except production, unless DEMO_SEED=true (used by the Vercel entry so the hosted demo isn't empty).
  const demo = !prod || env.DEMO_SEED === 'true';
  if (prod && (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD)) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD to seed in production.');
  const user = (name, email, pw, role) => { db.prepare('INSERT OR IGNORE INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(name, email, hashPw(pw), role); return db.prepare('SELECT id FROM users WHERE email=?').get(email).id; };
  user('Platform Admin', env.ADMIN_EMAIL || 'admin@charityconnect.test', env.ADMIN_PASSWORD || 'Admin@12345', 'ADMIN');
  if (!demo) return 'production: admin only';

  const donor = user('John Doe', 'donor@charityconnect.test', 'Donor@12345', 'DONOR');
  const donors = [donor, user('Asha Verma', 'asha@charityconnect.test', 'Donor@12345', 'DONOR'), user('Ravi Singh', 'ravi@charityconnect.test', 'Donor@12345', 'DONOR')];
  const charity = (email, pw, name, cat, loc, status, desc, image = null) => {
    const uid = user(name + ' Admin', email, pw, 'CHARITY');
    db.prepare('INSERT OR IGNORE INTO charities(user_id,name,description,category,location,contact_email,status,image) VALUES(?,?,?,?,?,?,?,?)').run(uid, name, desc, cat, loc, email, status, image);
    const id = db.prepare('SELECT id FROM charities WHERE user_id=?').get(uid).id;
    if (image) db.prepare('UPDATE charities SET image=COALESCE(image, ?) WHERE id=?').run(image, id);
    return id;
  };
  const cw = charity('charity@charityconnect.test', 'Charity@12345', 'Clean Water Foundation', 'Water & Sanitation', 'Ludhiana, Punjab', 'APPROVED', 'We work to improve access to clean drinking water in underserved communities across Punjab (fictional demo organisation).', '/images/campaigns/water-tower.jpg');
  const ed = charity('education@charityconnect.test', 'Charity@12345', 'Education For All', 'Education', 'Jalandhar, Punjab', 'APPROVED', 'We fund school libraries, scholarships and digital classrooms for rural children (fictional demo organisation).', '/images/campaigns/classroom.jpg');
  const hope = charity('pending@charityconnect.test', 'Charity@12345', 'Hope Foundation', 'Health', 'Amritsar, Punjab', 'PENDING', 'Community health camps and free medicines (fictional; awaiting approval).', '/images/campaigns/health-screening.jpg');
  const green = charity('green@charityconnect.test', 'Charity@12345', 'Green Earth Foundation', 'Environment', 'Chandigarh, Chandigarh (UT)', 'APPROVED', 'Tree plantation and river clean-up drives (fictional demo organisation).', '/images/campaigns/tree-planting.jpg');
  db.prepare("UPDATE charities SET location='Chandigarh, Chandigarh (UT)' WHERE user_id=(SELECT id FROM users WHERE email=?) AND location='Chandigarh'")
    .run('green@charityconnect.test');
  const paws = charity('paws@charityconnect.test', 'Charity@12345', 'Paws & Care', 'Animal Welfare', 'Patiala, Punjab', 'APPROVED', 'Shelter, vaccination and rescue for street animals (fictional demo organisation).', '/images/causes/animals.jpg');
  const food = charity('food@charityconnect.test', 'Charity@12345', 'Food Relief Network', 'Food & Community', 'Ludhiana, Punjab', 'APPROVED', 'Community kitchens and ration kits for families in need (fictional demo organisation).', '/images/campaigns/food-bank.jpg');
  const kids = charity('kids@charityconnect.test', 'Charity@12345', 'Bright Futures', 'Child Welfare', 'Mohali, Punjab', 'APPROVED', 'Shelter, nutrition and schooling for children (fictional demo organisation).', '/images/causes/children.jpg');
  const medical = charity('medical@charityconnect.test', 'Charity@12345', 'Jaipur Community Health', 'Health', 'Jaipur, Rajasthan', 'APPROVED', 'A fictional community health organisation connecting rural families with primary care, screenings and essential medicines.', '/images/campaigns/mobile-doctor.jpg');
  db.prepare("UPDATE charities SET name=? WHERE user_id=(SELECT id FROM users WHERE email=?) AND name=?")
    .run('Jaipur Community Health', 'medical@charityconnect.test', 'Swasthya Mobile Care');
  const puneCare = charity('pune-care@charityconnect.test', 'Charity@12345', 'Sahyog Community Health', 'Health', 'Pune, Maharashtra', 'APPROVED', 'A fictional community health organisation planning local screenings and follow-up referrals in Pune.', '/images/campaigns/health-screening.jpg');
  const assamCare = charity('assam-care@charityconnect.test', 'Charity@12345', 'Brahmaputra Family Health Initiative', 'Health', 'Guwahati, Assam', 'APPROVED', 'A fictional community organisation supporting maternal health information and clinic referrals in Assam.', '/images/campaigns/maternal-health.jpg');
  const keralaCare = charity('kerala-care@charityconnect.test', 'Charity@12345', 'Coastal Care Network', 'Health', 'Kochi, Kerala', 'APPROVED', 'A fictional community health organisation helping families navigate treatment and local care services.', '/images/campaigns/treatment-travel.jpg');
  const upCare = charity('up-care@charityconnect.test', 'Charity@12345', 'Sehat Access Collective', 'Health', 'Varanasi, Uttar Pradesh', 'APPROVED', 'A fictional community organisation improving access to basic health services in rural areas near Varanasi.', '/images/campaigns/doctor-consultation.jpg');
  const delhiCare = charity('delhi-care@charityconnect.test', 'Charity@12345', 'Delhi Community Health Coalition', 'Health', 'Delhi, National Capital Territory of Delhi', 'APPROVED', 'A fictional health network coordinating transport, palliative care and outpatient referrals for low-income families across Delhi.', '/images/campaigns/hospital-ward.jpg');
  db.prepare("UPDATE charities SET location='Delhi, National Capital Territory of Delhi' WHERE user_id=(SELECT id FROM users WHERE email=?) AND location='Delhi'")
    .run('delhi-care@charityconnect.test');
  const mumbaiCare = charity('mumbai-care@charityconnect.test', 'Charity@12345', 'Mumbai Recovery Network', 'Health', 'Mumbai, Maharashtra', 'APPROVED', 'A fictional support network for post-surgery recovery, travel assistance and recovery follow-ups for vulnerable families.', '/images/campaigns/medical-recovery.jpg');
  const ahmedabadCare = charity('ahmedabad-care@charityconnect.test', 'Charity@12345', 'Amdavad Care Circle', 'Health', 'Ahmedabad, Gujarat', 'APPROVED', 'A fictional care group enabling access to medicines, long-term treatment support and family counselling in underserved communities.', '/images/campaigns/cancer-treatment.jpg');
  const bengaluruCare = charity('bengaluru-care@charityconnect.test', 'Charity@12345', 'Bengaluru Women’s Health Collective', 'Health', 'Bengaluru, Karnataka', 'APPROVED', 'A fictional community health initiative focused on preventive screenings, counselling and treatment continuity for women in urban low-income communities.', '/images/campaigns/women-health-clinic.jpg');
  const odishaCare = charity('odisha-care@charityconnect.test', 'Charity@12345', 'Odisha Rural Care Initiative', 'Health', 'Bhubaneswar, Odisha', 'APPROVED', 'A fictional community organisation supporting rural tele-consultation, follow-up care and medication access for families in Odisha.', '/images/campaigns/telemedicine-consult.jpg');

  const camp = (slug, chId, title, cat, goal, from, to, status, desc, image = null) =>
    db.prepare(`INSERT INTO campaigns(charity_id,title,slug,description,category,goal_paise,start_date,end_date,status,image)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET image=COALESCE(excluded.image,campaigns.image)`)
      .run(chId, title, slug, desc, cat, goal * 100, day(from), day(to), status, image);
  camp('clean-water-for-rural-schools', cw, 'Clean Water for Rural Schools', 'Water & Sanitation', 100000, -40, 50, 'ACTIVE', 'Help us install water purifiers and handwash stations in rural schools so children can drink safe water every day.', '/images/campaigns/clean-water-schools.jpg');
  camp('school-water-tanks', cw, 'School Water Tanks', 'Water & Sanitation', 50000, -30, 40, 'ACTIVE', 'Storage tanks for schools that lose water supply for days at a time.', '/images/campaigns/school-water.jpg');
  camp('school-library-project', ed, 'School Library Project', 'Education', 50000, -35, 45, 'ACTIVE', 'Books, shelves and a reading corner for a village school with no library.', '/images/campaigns/library.jpg');
  camp('digital-classrooms', ed, 'Digital Classrooms', 'Education', 200000, -10, 80, 'PENDING', 'Tablets and a projector for a rural classroom (awaiting admin approval).', '/images/campaigns/classroom.jpg');
  camp('plant-10000-trees', green, 'Plant 10,000 Trees', 'Environment', 300000, -20, 100, 'ACTIVE', 'Native saplings with three years of care to restore degraded land along local canals.', '/images/campaigns/plant-tress.jpg');
  camp('winter-shelter-for-dogs', paws, 'Winter Shelter for Street Dogs', 'Animal Welfare', 80000, -25, 30, 'ACTIVE', 'Straw beds, heated kennels and vaccinations for street dogs through winter.', '/images/campaigns/street-dog.jpg');
  camp('food-relief-program', food, 'Food Relief Program', 'Food & Community', 25000, -60, -5, 'COMPLETED', 'Ration kits for 200 families. Goal reached - thank you!', '/images/campaigns/food-relief.png');
  camp('nutrition-for-children', kids, 'Nutrition for Shelter Children', 'Child Welfare', 120000, -15, 60, 'ACTIVE', 'A year of nutritious meals for children in our shelter.', '/images/campaigns/hungry-children.jpg');
  camp('mobile-health-camps', hope, 'Mobile Health Camps', 'Health', 150000, 5, 90, 'DRAFT', 'Draft: monthly health camps in border villages.', '/images/campaigns/health-screening.jpg');
  camp('river-cleanup-drive', green, 'River Clean-up Drive', 'Environment', 60000, -50, 60, 'PAUSED', 'Paused while permits are renewed.', '/images/campaigns/river.jpg');
  camp('old-art-supplies', ed, 'Art Supplies Drive', 'Education', 20000, -70, -10, 'ACTIVE', 'Ended before reaching goal (shows as expired).', '/images/campaigns/poor-children-drawing.jpg');
  db.prepare("UPDATE campaigns SET status='DRAFT', archived_at=COALESCE(archived_at, datetime('now')) WHERE slug='mobile-clinic-for-rural-families'").run();
  camp('emergency-recovery-after-road-accident', medical, 'Emergency care after a road accident', 'Health', 240000, -3, 80, 'ACTIVE',
    'Fictional demo fundraiser for post-accident treatment, rehabilitation visits and follow-up transport. The story is not about a real person, and no real money is being requested.', '/images/campaigns/road-accident.jpg');
  camp('pune-community-screenings', puneCare, 'Community health screenings in Pune', 'Health', 125000, -12, 70, 'ACTIVE',
    'Fictional demo campaign to arrange scheduled blood-pressure and diabetes screenings, basic clinician consultations and referrals for 120 adults at neighbourhood community centres in Pune. No real patient or provider is represented.', '/images/campaigns/com-health.jpg');
  camp('assam-maternal-health-outreach', assamCare, 'Maternal health outreach in Guwahati', 'Health', 100000, -9, 75, 'ACTIVE',
    'Fictional demo campaign for small-group maternal health sessions, transport coordination and clinic referrals for families in communities around Guwahati. It does not represent a real patient, clinic or medical claim.', '/images/campaigns/doctor-consultation.jpg');
  const kochiDescription = 'Fictional demo campaign to help 30 low-income families plan local transport to scheduled hospital appointments in Kochi, with receipts reviewed by the fictional organisation. The photo is illustrative and shows an unrelated patient transfer in Uganda; it does not depict a campaign beneficiary or activity in Kochi.';
  camp('kochi-treatment-travel-support', keralaCare, 'Treatment travel support in Kochi', 'Health', 180000, -6, 80, 'ACTIVE',
    kochiDescription, '/images/campaigns/treatment-travel.jpg');
  db.prepare('UPDATE campaigns SET description=? WHERE slug=? AND description=?').run(
    kochiDescription,
    'kochi-treatment-travel-support',
    'Fictional demo campaign to help 30 low-income families plan local transport to scheduled hospital appointments in Kochi, with receipts reviewed by the fictional organisation. No real patient is depicted.',
  );
  camp('varanasi-rural-health-visits', upCare, 'Rural health visits in Varanasi', 'Health', 90000, -4, 85, 'ACTIVE',
    'Fictional demo campaign for monthly primary-care visits, basic screening supplies and follow-up referrals for three rural communities near Varanasi. This is sample data and is not a real medical service.', '/images/campaigns/rural-health-visits.jpg');
  camp('dialysis-support-for-elderly', delhiCare, 'Dialysis support for elderly patients', 'Health', 210000, -8, 60, 'ACTIVE',
    'Fictional demo fundraiser for recurring dialysis visits, transport vouchers and outpatient monitoring for senior citizens in Delhi who need frequent treatment access.', '/images/campaigns/dialysis-support.jpg');
  camp('post-surgery-transport-support', mumbaiCare, 'Post-surgery transport support', 'Health', 160000, -7, 55, 'ACTIVE',
    'Fictional demo campaign to cover follow-up transport costs, basic home nursing kits and recovery counselling for vulnerable families after surgery in Mumbai.', '/images/campaigns/surgery-transport.jpg');
  camp('cancer-drug-support-for-families', ahmedabadCare, 'Cancer drug support for families', 'Health', 280000, -2, 65, 'ACTIVE',
    'Fictional demo fundraiser for essential outpatient medicines, laboratory tests and emergency support for families navigating oncology treatment in Ahmedabad.', '/images/campaigns/cancer.webp');
  camp('women-health-clinic-expansion', bengaluruCare, 'Women’s health clinic expansion', 'Health', 195000, -11, 72, 'ACTIVE',
    'Fictional demo campaign to expand a community health clinic with counselling rooms, screening equipment and preventive care outreach for women in Bengaluru.', '/images/campaigns/women-health-clinic.jpg');
  camp('rural-teleconsultations-in-odisha', odishaCare, 'Rural teleconsultations in Odisha', 'Health', 145000, -15, 82, 'ACTIVE',
    'Fictional demo initiative for digital consults, medicine coordination and referral support for families in remote communities across Odisha.', '/images/campaigns/rural-consultation.jpg');
  db.prepare(`UPDATE campaigns SET review_note='Field activities are on hold while permit-renewal documentation is reviewed.' WHERE slug='river-cleanup-drive' AND status='PAUSED' AND (review_note IS NULL OR review_note='')`).run();

  const plan = [['clean-water-for-rural-schools', 6250], ['school-library-project', 2200], ['food-relief-program', 25000], ['school-water-tanks', 4000],
    ['plant-10000-trees', 9000], ['winter-shelter-for-dogs', 1800], ['nutrition-for-children', 3000], ['old-art-supplies', 500]];
  // Demo donations: only once, always flagged simulated. They are NOT real transactions.
  if (db.prepare('SELECT COUNT(*) n FROM donations').get().n === 0) {
    let i = 0;
    for (const [slug, total] of plan) {
      const c = db.prepare('SELECT id FROM campaigns WHERE slug=?').get(slug);
      for (const part of [0.5, 0.3, 0.2]) {
        const amt = Math.round(total * part) * 100, d = donors[i++ % donors.length];
        const id = Number(db.prepare("INSERT INTO donations(donor_id,campaign_id,amount_paise,status,simulated,created_at) VALUES(?,?,?,'SUCCESS',1,?)").run(d, c.id, amt, tsThisMonth(i % 20)).lastInsertRowid);
        db.prepare("INSERT INTO payments(donation_id,provider,order_id,amount_paise,status,utr,expires_at) VALUES(?,'demo',?,?,'SUCCESS',?,?)").run(id, `SEED-${id}`, amt, `SIMULATED-SEED-${id}`, ts(1));
      }
    }
    const c = db.prepare("SELECT id FROM campaigns WHERE slug='school-library-project'").get().id;
    for (const [st, amt] of [['PENDING', 50000], ['FAILED', 70000], ['CANCELLED', 30000]]) {
      const id = Number(db.prepare('INSERT INTO donations(donor_id,campaign_id,amount_paise,status,simulated) VALUES(?,?,?,?,1)').run(donor, c, amt, st).lastInsertRowid);
      db.prepare('INSERT INTO payments(donation_id,provider,order_id,amount_paise,status,expires_at) VALUES(?,?,?,?,?,?)').run(id, 'demo', `SEED-${id}`, amt, st, ts(st === 'PENDING' ? 1 : -1));
    }
    db.prepare("INSERT INTO campaign_updates(campaign_id,author_id,title,body) SELECT c.id, ch.user_id, 'Purifiers ordered', 'We have ordered the first 10 water purifiers; installation starts next week.' FROM campaigns c JOIN charities ch ON ch.id=c.charity_id WHERE c.slug='clean-water-for-rural-schools'").run();
  }
  const medicalPlan = [
    ['pune-community-screenings', 12000],
    ['assam-maternal-health-outreach', 15000],
    ['kochi-treatment-travel-support', 10000],
    ['varanasi-rural-health-visits', 8000],
  ];
  for (const [slug, total] of medicalPlan) {
    const c = db.prepare('SELECT id FROM campaigns WHERE slug=?').get(slug);
    for (const [index, part] of [0.5, 0.3, 0.2].entries()) {
      const orderId = `SEED-MED-${slug}-${index + 1}`;
      if (db.prepare('SELECT 1 FROM payments WHERE order_id=?').get(orderId)) continue;
      const amount = Math.round(total * part) * 100;
      const donorId = donors[index];
      const id = Number(db.prepare("INSERT INTO donations(donor_id,campaign_id,amount_paise,status,simulated,created_at) VALUES(?,?,?,'SUCCESS',1,?)")
        .run(donorId, c.id, amount, tsThisMonth(index + 1)).lastInsertRowid);
      db.prepare("INSERT INTO payments(donation_id,provider,order_id,amount_paise,status,utr,expires_at) VALUES(?,'demo',?,?,'SUCCESS',?,?)")
        .run(id, orderId, amount, `SIMULATED-${orderId}`, ts(1));
    }
  }
  for (const [slug, total] of plan) {
    const seededSuccesses = db.prepare(`SELECT d.id, p.id payment_id FROM donations d
      JOIN payments p ON p.donation_id=d.id JOIN campaigns c ON c.id=d.campaign_id
      WHERE p.provider='demo' AND p.order_id LIKE 'SEED-%' AND d.status='SUCCESS' AND c.slug=? ORDER BY d.id`).all(slug);
    for (const [index, donation] of seededSuccesses.entries()) {
      const amountPaise = Math.round(total * [0.5, 0.3, 0.2][index]) * 100;
      db.prepare('UPDATE donations SET amount_paise=? WHERE id=?').run(amountPaise, donation.id);
      db.prepare('UPDATE payments SET amount_paise=? WHERE id=?').run(amountPaise, donation.payment_id);
    }
  }
  const seededSuccesses = db.prepare(`SELECT d.id, d.created_at FROM donations d JOIN payments p ON p.donation_id=d.id
    WHERE p.provider='demo' AND p.order_id LIKE 'SEED-%' AND d.status='SUCCESS' ORDER BY d.id`).all();
  const currentMonth = new Date().toISOString().slice(0, 7);
  for (const [index, donation] of seededSuccesses.entries()) {
    if (donation.created_at.slice(0, 7) !== currentMonth) {
      db.prepare('UPDATE donations SET created_at=? WHERE id=?').run(tsThisMonth(index % 20), donation.id);
    }
  }
  return 'seeded';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
  const path = process.env.DB_PATH || 'data/charityconnect.sqlite';
  if (process.argv.includes('--reset')) { if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset in production'); for (const s of ['', '-wal', '-shm']) rmSync(path + s, { force: true }); }
  const db = openDb(path); console.log(seed(db)); db.close();
}
