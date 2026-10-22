#!/usr/bin/env node
/*
 * Publishes scheduled blog posts whose date has arrived.
 *
 * How it works (no dependencies, plain Node):
 *   - _scheduled/schedule.json lists posts in publish order: { order, date, slug, title, category, blurb }
 *   - _scheduled/<slug>.html is the finished post, ready to live at the site root
 *   - On each run, every unpublished post whose date <= today (America/New_York) is:
 *       1. moved from _scheduled/<slug>.html to <slug>.html (the live URL is /<slug>, cleanUrls)
 *       2. added as the newest card in blog.html (after the <!-- posts:start --> marker)
 *       3. added to sitemap.xml
 *       4. marked published in schedule.json
 *   - The GitHub Action (.github/workflows/publish-scheduled.yml) runs this daily and commits
 *     the result; Vercel deploys the push.
 *
 * Usage:
 *   node scripts/publish-scheduled.js            # publish everything due today
 *   node scripts/publish-scheduled.js --dry-run  # report what would publish, change nothing
 *   node scripts/publish-scheduled.js --all      # publish everything regardless of date (testing)
 *   node scripts/publish-scheduled.js --as-of 2026-11-05   # pretend today is that date
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCHED_DIR = path.join(ROOT, '_scheduled');
const MANIFEST = path.join(SCHED_DIR, 'schedule.json');
const BLOG = path.join(ROOT, 'blog.html');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const SITE = 'https://micahjacobi.me';
const MARKER = '<!-- posts:start -->';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ALL = args.includes('--all');
const asOfIdx = args.indexOf('--as-of');

function todayNY() {
  if (asOfIdx !== -1 && args[asOfIdx + 1]) return args[asOfIdx + 1];
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function monthLabel(iso) {
  const [y, m] = iso.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1]} ${y}`;
}

function cardTitleFrom(html, fallback) {
  // Use the post's H1 (sentence case, matches the existing cards), stripped of tags.
  const m = html.match(/<h1 class="hl">([\s\S]*?)<\/h1>/);
  if (!m) return fallback;
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function buildCard(post, title) {
  return `      <article class="post"><div class="thumb" style="background:linear-gradient(135deg,#100E0C,#3a2020);border-bottom:none;display:flex;align-items:center;justify-content:center;"><span style="font-family:var(--fr);font-weight:600;font-size:22px;color:var(--gold);">MJ.</span></div><div class="body"><div class="cat">${post.category}</div><h3><a href="${post.slug}.html" style="color:inherit;text-decoration:none;">${title}</a></h3><p class="date">Published · ${monthLabel(post.date)}</p></div></article>`;
}

function main() {
  const today = todayNY();
  if (!fs.existsSync(MANIFEST)) { console.log('No _scheduled/schedule.json; nothing to do.'); return finish([]); }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let blog = fs.readFileSync(BLOG, 'utf8');
  let sitemap = fs.readFileSync(SITEMAP, 'utf8');
  if (!blog.includes(MARKER)) throw new Error(`blog.html is missing the ${MARKER} marker`);
  if (!sitemap.includes('</urlset>')) throw new Error('sitemap.xml is missing </urlset>');

  const published = [];
  for (const post of manifest) {
    if (post.published) continue;
    if (!ALL && post.date > today) continue;
    const src = path.join(SCHED_DIR, `${post.slug}.html`);
    const dest = path.join(ROOT, `${post.slug}.html`);
    if (!fs.existsSync(src)) { console.warn(`WARN due but missing: ${src}`); continue; }
    if (fs.existsSync(dest)) { console.warn(`WARN ${post.slug}.html already exists at root; refusing to overwrite`); continue; }
    const html = fs.readFileSync(src, 'utf8');
    if (html.includes('{{')) { console.warn(`WARN ${post.slug}.html still has {{placeholders}}; skipping`); continue; }
    const title = cardTitleFrom(html, post.title);
    console.log(`${DRY ? '[dry-run] would publish' : 'Publishing'}: ${post.date}  ${post.slug}  "${title}"`);
    if (DRY) { published.push(post); continue; }

    fs.renameSync(src, dest);
    blog = blog.replace(MARKER, `${MARKER}\n${buildCard(post, title)}`);
    const urlLine = `  <url><loc>${SITE}/${post.slug}</loc><lastmod>${post.date}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`;
    sitemap = sitemap.replace('</urlset>', `${urlLine}</urlset>`);
    sitemap = sitemap.replace(/(<loc>https:\/\/micahjacobi\.me\/blog<\/loc><lastmod>)[0-9-]+(<\/lastmod>)/, `$1${today}$2`);
    post.published = today;
    published.push(post);
  }

  if (!DRY && published.length) {
    fs.writeFileSync(BLOG, blog);
    fs.writeFileSync(SITEMAP, sitemap);
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  }
  const remaining = manifest.filter(p => !p.published).length;
  console.log(published.length ? `${DRY ? 'Would publish' : 'Published'} ${published.length} post(s). ${remaining} still scheduled.` : `Nothing due as of ${today}. ${remaining} still scheduled.`);
  finish(published);
}

function finish(published) {
  const slugs = published.map(p => p.slug).join(', ');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `published=${DRY ? '' : slugs}\n`);
}

main();
