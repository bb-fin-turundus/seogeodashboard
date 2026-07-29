/**
 * SEO / GEO / Technical Site Analyzer
 * Crawls a list of URLs, runs a battery of checks, and produces:
 *  - a list of findings (issue / pass) per category
 *  - an issue count ("vigade arv") and a normalized 0-100 health score
 *  - appends the result into data/history.json (one entry per site per day)
 *
 * Usage: node analyzer.js
 * Intended to be run once per day via cron / GitHub Actions / any scheduler.
 */

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const SITES = [
  { id: 'hyba', name: 'Hyba.ee', url: 'https://www.hyba.ee' },
  { id: 'raha24', name: 'Raha24.ee', url: 'https://www.raha24.ee' },
  { id: 'moneyzen', name: 'MoneyZen.eu', url: 'https://www.moneyzen.eu' },
];

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'history.json');
const TIMEOUT_MS = 15000;

function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal, redirect: 'follow' }).finally(() => clearTimeout(t));
}

// severity weights used to compute the 0-100 score from raw issues
const WEIGHT = { critical: 8, major: 4, minor: 1 };

function addFinding(findings, category, name, status, severity, message) {
  findings.push({ category, name, status, severity: status === 'fail' ? severity : null, message });
}

async function getText(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    return { ok: true, status: res.status, text, headers: res.headers };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function analyzeSite(site) {
  const findings = [];
  const start = Date.now();
  const main = await getText(site.url);
  const loadTime = Date.now() - start;

  if (!main.ok) {
    addFinding(findings, 'Tehniline', 'Lehe kättesaadavus', 'fail', 'critical', `Lehte ei õnnestunud laadida: ${main.error || main.status}`);
    return finalize(site, findings, null);
  }
  addFinding(findings, 'Tehniline', 'Lehe kättesaadavus', 'pass', null, 'Leht vastab HTTP 200-ga');

  const $ = cheerio.load(main.text);
  const html = main.text;

  // ---- HTTPS ----
  if (site.url.startsWith('https://')) {
    addFinding(findings, 'Tehniline', 'HTTPS kasutusel', 'pass', null, 'Sait kasutab HTTPS-i');
  } else {
    addFinding(findings, 'Tehniline', 'HTTPS kasutusel', 'fail', 'critical', 'Sait ei kasuta HTTPS-i');
  }

  // ---- Response time ----
  if (loadTime < 1000) {
    addFinding(findings, 'Tehniline', 'Serveri vastuseaeg', 'pass', null, `Vastuseaeg ${loadTime}ms — hea`);
  } else if (loadTime < 2500) {
    addFinding(findings, 'Tehniline', 'Serveri vastuseaeg', 'fail', 'minor', `Vastuseaeg ${loadTime}ms — jälgi jõudlust`);
  } else {
    addFinding(findings, 'Tehniline', 'Serveri vastuseaeg', 'fail', 'major', `Vastuseaeg ${loadTime}ms — aeglane`);
  }

  // ---- Page size ----
  const sizeKB = Buffer.byteLength(html, 'utf8') / 1024;
  if (sizeKB > 300) {
    addFinding(findings, 'Tehniline', 'HTML dokumendi suurus', 'fail', 'minor', `HTML on ${sizeKB.toFixed(0)}KB — kaalu optimeerimist`);
  } else {
    addFinding(findings, 'Tehniline', 'HTML dokumendi suurus', 'pass', null, `HTML suurus ${sizeKB.toFixed(0)}KB`);
  }

  // ---- Compression ----
  const enc = main.headers.get('content-encoding');
  if (enc && /gzip|br/.test(enc)) {
    addFinding(findings, 'Tehniline', 'Sisu tihendamine (gzip/brotli)', 'pass', null, `Kasutusel: ${enc}`);
  } else {
    addFinding(findings, 'Tehniline', 'Sisu tihendamine (gzip/brotli)', 'fail', 'minor', 'Tihendamist ei tuvastatud vastuse päistest');
  }

  // ---- Security headers ----
  const secHeaders = ['strict-transport-security', 'x-content-type-options', 'content-security-policy'];
  const missingSec = secHeaders.filter(h => !main.headers.get(h));
  if (missingSec.length === 0) {
    addFinding(findings, 'Tehniline', 'Turvapäised', 'pass', null, 'Peamised turvapäised olemas');
  } else {
    addFinding(findings, 'Tehniline', 'Turvapäised', 'fail', 'minor', `Puuduvad: ${missingSec.join(', ')}`);
  }

  // ---- Viewport / mobile ----
  const viewport = $('meta[name="viewport"]').attr('content');
  if (viewport) {
    addFinding(findings, 'Tehniline', 'Mobiili viewport meta-silt', 'pass', null, `viewport: ${viewport}`);
  } else {
    addFinding(findings, 'Tehniline', 'Mobiili viewport meta-silt', 'fail', 'major', 'Viewport meta-silt puudub — mobiilivaade võib olla katki');
  }

  // ---- Favicon ----
  const favicon = $('link[rel="icon"], link[rel="shortcut icon"]').attr('href');
  if (favicon) {
    addFinding(findings, 'Tehniline', 'Favicon', 'pass', null, 'Favicon defineeritud');
  } else {
    addFinding(findings, 'Tehniline', 'Favicon', 'fail', 'minor', 'Favicon puudub');
  }

  // ---- Title tag ----
  const title = $('title').first().text().trim();
  if (!title) {
    addFinding(findings, 'SEO', 'Title-silt', 'fail', 'critical', 'Title-silt puudub');
  } else if (title.length < 15 || title.length > 65) {
    addFinding(findings, 'SEO', 'Title-silt', 'fail', 'minor', `Title pikkus ${title.length} tm — soovituslik 15-65 ("${title}")`);
  } else {
    addFinding(findings, 'SEO', 'Title-silt', 'pass', null, `"${title}" (${title.length} tm)`);
  }

  // ---- Meta description ----
  const metaDesc = $('meta[name="description"]').attr('content');
  if (!metaDesc) {
    addFinding(findings, 'SEO', 'Meta description', 'fail', 'major', 'Meta description puudub');
  } else if (metaDesc.length < 50 || metaDesc.length > 160) {
    addFinding(findings, 'SEO', 'Meta description', 'fail', 'minor', `Pikkus ${metaDesc.length} tm — soovituslik 50-160`);
  } else {
    addFinding(findings, 'SEO', 'Meta description', 'pass', null, `Pikkus ${metaDesc.length} tm`);
  }

  // ---- H1 ----
  const h1s = $('h1');
  if (h1s.length === 0) {
    addFinding(findings, 'SEO', 'H1 pealkiri', 'fail', 'major', 'Lehel puudub H1');
  } else if (h1s.length > 1) {
    addFinding(findings, 'SEO', 'H1 pealkiri', 'fail', 'minor', `Lehel on ${h1s.length} H1 silti — soovituslik 1`);
  } else {
    addFinding(findings, 'SEO', 'H1 pealkiri', 'pass', null, `H1: "${$(h1s[0]).text().trim().slice(0, 60)}"`);
  }

  // ---- Canonical ----
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical) {
    addFinding(findings, 'SEO', 'Canonical link', 'pass', null, `Canonical: ${canonical}`);
  } else {
    addFinding(findings, 'SEO', 'Canonical link', 'fail', 'minor', 'Canonical link puudub');
  }

  // ---- Images alt text ----
  const imgs = $('img');
  const imgsNoAlt = imgs.filter((i, el) => !$(el).attr('alt') || $(el).attr('alt').trim() === '').length;
  if (imgs.length === 0) {
    addFinding(findings, 'SEO', 'Piltide alt-tekstid', 'pass', null, 'Lehel pole pilte kontrollida');
  } else if (imgsNoAlt === 0) {
    addFinding(findings, 'SEO', 'Piltide alt-tekstid', 'pass', null, `Kõigil ${imgs.length} pildil on alt-tekst`);
  } else {
    const sev = imgsNoAlt / imgs.length > 0.5 ? 'major' : 'minor';
    addFinding(findings, 'SEO', 'Piltide alt-tekstid', 'fail', sev, `${imgsNoAlt}/${imgs.length} pildil puudub alt-tekst`);
  }

  // ---- Structured data (schema.org) ----
  const ldJson = $('script[type="application/ld+json"]');
  if (ldJson.length > 0) {
    addFinding(findings, 'SEO', 'Struktureeritud andmed (Schema.org)', 'pass', null, `${ldJson.length} JSON-LD plokki leitud`);
  } else {
    addFinding(findings, 'SEO', 'Struktureeritud andmed (Schema.org)', 'fail', 'major', 'JSON-LD struktureeritud andmeid ei leitud');
  }

  // ---- Open Graph ----
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogTitle && ogImage) {
    addFinding(findings, 'SEO', 'Open Graph sildid (jagamine sotsiaalmeedias)', 'pass', null, 'og:title ja og:image olemas');
  } else {
    addFinding(findings, 'SEO', 'Open Graph sildid (jagamine sotsiaalmeedias)', 'fail', 'minor', 'og:title ja/või og:image puuduvad');
  }

  // ---- lang attribute ----
  const htmlLang = $('html').attr('lang');
  if (htmlLang) {
    addFinding(findings, 'SEO', 'Lehe keele määratlus (lang)', 'pass', null, `lang="${htmlLang}"`);
  } else {
    addFinding(findings, 'SEO', 'Lehe keele määratlus (lang)', 'fail', 'minor', 'HTML lang atribuut puudub');
  }

  // ---- robots.txt ----
  const robots = await getText(new URL('/robots.txt', site.url).toString());
  let robotsBody = '';
  if (robots.ok) {
    robotsBody = robots.text;
    addFinding(findings, 'SEO', 'robots.txt', 'pass', null, 'robots.txt eksisteerib');
  } else {
    addFinding(findings, 'SEO', 'robots.txt', 'fail', 'minor', 'robots.txt puudub või pole kättesaadav');
  }

  // ---- sitemap.xml ----
  let sitemapFound = /sitemap:/i.test(robotsBody);
  if (!sitemapFound) {
    const sm = await getText(new URL('/sitemap.xml', site.url).toString());
    sitemapFound = sm.ok;
  }
  if (sitemapFound) {
    addFinding(findings, 'SEO', 'sitemap.xml', 'pass', null, 'Sitemap leitud (robots.txt viide või /sitemap.xml)');
  } else {
    addFinding(findings, 'SEO', 'sitemap.xml', 'fail', 'major', 'Sitemapi ei leitud');
  }

  // ================= GEO (Generative Engine Optimization) =================

  // ---- llms.txt ----
  const llms = await getText(new URL('/llms.txt', site.url).toString());
  if (llms.ok) {
    addFinding(findings, 'GEO', 'llms.txt', 'pass', null, 'llms.txt leitud — AI-mudelitele mõeldud lehe kirjeldus olemas');
  } else {
    addFinding(findings, 'GEO', 'llms.txt', 'fail', 'minor', 'llms.txt puudub (soovituslik AI-otsingumootoritele nähtavuse jaoks)');
  }

  // ---- AI crawler access in robots.txt ----
  const aiBots = ['GPTBot', 'Google-Extended', 'PerplexityBot', 'ClaudeBot', 'CCBot'];
  const blockedBots = aiBots.filter(b => new RegExp(`User-agent:\\s*${b}[\\s\\S]*?Disallow:\\s*/\\s*$`, 'im').test(robotsBody));
  if (robotsBody && blockedBots.length > 0) {
    addFinding(findings, 'GEO', 'AI-robotite ligipääs (robots.txt)', 'fail', 'major', `Blokeeritud: ${blockedBots.join(', ')} — AI-otsingumootorid ei saa sisu indekseerida`);
  } else {
    addFinding(findings, 'GEO', 'AI-robotite ligipääs (robots.txt)', 'pass', null, 'AI-robotite (GPTBot, Google-Extended jt) ligipääsu ei blokeerita');
  }

  // ---- FAQ schema / question-style content ----
  const faqSchema = ldJson.toString().includes('FAQPage');
  const hasFaqHeadings = /\?/.test($('h2, h3').text());
  if (faqSchema) {
    addFinding(findings, 'GEO', 'FAQ struktureeritud andmed', 'pass', null, 'FAQPage schema leitud — sobib AI-vastustesse tsiteerimiseks');
  } else if (hasFaqHeadings) {
    addFinding(findings, 'GEO', 'FAQ struktureeritud andmed', 'fail', 'minor', 'Küsimuse-stiilis pealkirju leidub, kuid FAQPage schema puudub');
  } else {
    addFinding(findings, 'GEO', 'FAQ struktureeritud andmed', 'fail', 'minor', 'FAQ-tüüpi sisu/schema ei tuvastatud');
  }

  // ---- Clear heading hierarchy for chunking ----
  const h2Count = $('h2').length;
  if (h2Count >= 2) {
    addFinding(findings, 'GEO', 'Sisu jaotus alapealkirjadega (H2)', 'pass', null, `${h2Count} H2 pealkirja — AI mudelitel lihtsam sisu tükeldada`);
  } else {
    addFinding(findings, 'GEO', 'Sisu jaotus alapealkirjadega (H2)', 'fail', 'minor', 'Vähe või puuduvad H2 pealkirjad — raskendab AI-l sisu struktuuri mõistmist');
  }

  // ---- Organization/Author schema (E-E-A-T signal for GEO) ----
  const orgSchema = ldJson.toString().includes('Organization') || ldJson.toString().includes('"author"');
  if (orgSchema) {
    addFinding(findings, 'GEO', 'Organisatsiooni/autori andmed', 'pass', null, 'Organization/author schema leitud — usaldusväärsuse signaal AI-mudelitele');
  } else {
    addFinding(findings, 'GEO', 'Organisatsiooni/autori andmed', 'fail', 'minor', 'Organization/author struktureeritud andmed puuduvad');
  }

  // ---- Text-to-HTML ratio (content richness for AI extraction) ----
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const ratio = bodyText.length / html.length;
  if (ratio < 0.1) {
    addFinding(findings, 'GEO', 'Teksti/HTML suhe', 'fail', 'minor', `Suhe ${(ratio*100).toFixed(1)}% — vähe reaalset tekstisisu AI-le töötlemiseks`);
  } else {
    addFinding(findings, 'GEO', 'Teksti/HTML suhe', 'pass', null, `Suhe ${(ratio*100).toFixed(1)}% — piisavalt tekstisisu`);
  }

  return finalize(site, findings, { loadTime, sizeKB });
}

function finalize(site, findings, meta) {
  const issues = findings.filter(f => f.status === 'fail');
  const deduction = issues.reduce((sum, f) => sum + (WEIGHT[f.severity] || 1), 0);
  const score = Math.max(0, Math.round(100 - deduction));
  const byCategory = { SEO: [], GEO: [], Tehniline: [] };
  findings.forEach(f => byCategory[f.category] && byCategory[f.category].push(f));

  return {
    siteId: site.id,
    siteName: site.name,
    url: site.url,
    date: new Date().toISOString().slice(0, 10),
    timestamp: new Date().toISOString(),
    issueCount: issues.length,
    score,
    meta,
    findings: byCategory,
  };
}

const DASHBOARD_DATA_PATH = path.join(__dirname, '..', 'data.json');

// Builds the compact structure the static dashboard (dashboard/index.html) reads.
// One entry per site per day is collapsed into parallel arrays (scores/issues) to
// keep the file small even after a year of daily runs; only the LATEST run keeps
// full per-check findings (older days only need the score for the trend line).
function buildDashboardData(history) {
  const trend = {};
  history.runs.forEach(run => {
    run.results.forEach(r => {
      if (!trend[r.siteId]) trend[r.siteId] = { start: run.date, scores: [], issues: [] };
      trend[r.siteId].scores.push(r.score);
      trend[r.siteId].issues.push(r.issueCount);
    });
  });

  const latest = {};
  const lastRun = history.runs[history.runs.length - 1];
  lastRun.results.forEach(r => {
    latest[r.siteId] = {
      siteName: r.siteName, url: r.url, date: r.date,
      score: r.score, issueCount: r.issueCount, meta: r.meta, findings: r.findings,
    };
  });

  return { generatedAt: new Date().toISOString(), trend, latest };
}

async function run() {
  const results = [];
  for (const site of SITES) {
    console.error(`Analüüsin: ${site.name} (${site.url})...`);
    const result = await analyzeSite(site);
    results.push(result);
    console.error(`  -> vigu: ${result.issueCount}, skoor: ${result.score}`);
  }

  let history = { runs: [] };
  if (fs.existsSync(HISTORY_PATH)) {
    history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  }
  // If a run already exists for today (e.g. workflow re-triggered), replace it instead of duplicating.
  const today = results[0].date;
  history.runs = history.runs.filter(r => r.date !== today);
  history.runs.push({ date: today, timestamp: new Date().toISOString(), results });
  history.runs.sort((a, b) => a.date.localeCompare(b.date));

  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  console.error(`Salvestatud: ${HISTORY_PATH}`);

  const dashboardData = buildDashboardData(history);
  fs.mkdirSync(path.dirname(DASHBOARD_DATA_PATH), { recursive: true });
  fs.writeFileSync(DASHBOARD_DATA_PATH, JSON.stringify(dashboardData));
  console.error(`Salvestatud: ${DASHBOARD_DATA_PATH}`);

  return results;
}

if (require.main === module) {
  run().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { run, analyzeSite, SITES };
