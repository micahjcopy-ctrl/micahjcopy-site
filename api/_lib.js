// MRGN Leak Report — shared logic for Vercel functions (CommonJS).
// All math is deterministic. Copy source: vault 08-Implementation-Week-Sequence.md.
const { createClient } = require("@supabase/supabase-js");
const Stripe = require("stripe");
const { Resend } = require("resend");

function supabase() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}
function stripe() {
  return process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
}
function resend() {
  return process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
}
const SITE_URL = process.env.SITE_URL || "https://micahjacobi.me";
const EMAIL_FROM = process.env.EMAIL_FROM || "Micah Jacobi <micah@micahjacobi.me>";
const fmt = (n) => "$" + Math.round(n).toLocaleString("en-US");

const FLOWS = [
  { key: "cart", name: "Cart abandon flow", share: 0.30, effort: 1, when: "day 1–7", steps: [
    "Build a 3-email + 1-SMS leg: 1hr / 24hr / 48hr after abandon.",
    "Email 1 = plain reminder with cart contents, no discount. Live-text CTA button, not an image.",
    "Check channel eligibility and quiet hours. Most accounts only reach 10–20% of abandoners, and that setting is why.",
    "Suppress buyers in real time; UTM-tag every link so revenue attributes." ]},
  { key: "welcome", name: "Welcome series", share: 0.25, effort: 1, when: "day 1–7", steps: [
    "Trigger on signup, first email inside 5 minutes (highest-RPR send you will ever have).",
    "3 emails: deliver the signup promise → founder story + best sellers → social proof + first-purchase nudge.",
    "Split buyer vs non-buyer legs. Never send a first-order discount to a customer.",
    "Verify entries vs list growth weekly; under-triggering welcomes silently starve revenue." ]},
  { key: "pp", name: "Post-purchase flow", share: 0.15, effort: 2, when: "day 7–14", steps: [
    "4-email arc: order celebration → how-to-use (consumption drives reorders) → check-in + review ask → cross-sell the logical next product.",
    "Time email 2 to arrival day, not order day.",
    "Reviews harvested here feed every other flow." ]},
  { key: "winback", name: "Winback + sunset", share: 0.12, effort: 2, when: "day 14–21", steps: [
    "Winback at 45–90 days since last order (30 is too aggressive): reminder → social proof → incentive → last call.",
    "Sunset: 90-day non-openers get a 3-email re-permission arc, then suppress. Deliverability is a list-quality game.",
    "This is also where dead lists get revived before any paid re-acquisition." ]},
  { key: "checkout", name: "Checkout abandon flow", share: 0.10, effort: 1, when: "day 7–14", steps: [
    "Separate from cart abandon. These buyers got further and convert hotter.",
    "2 emails + 1 SMS inside 24 hours; answer the 3 killers: shipping cost, trust, payment friction." ]},
  { key: "browse", name: "Browse abandon flow", share: 0.08, effort: 2, when: "day 21–30", steps: [
    "Trigger on product views ≥2 or 30s+ dwell, cap at 2 sends/week/person.",
    "Content = the product + 2 alternatives + one review. Soft tone; they never carted." ]},
];

function computeReport(i) {
  const emailRev = i.monthlyRevenue * (i.emailSharePct / 100);
  const flowShare = i.flowSharePct / 100;
  const live = FLOWS.map((f) => !!(i.flowsLive && i.flowsLive[f.key]));
  const nLive = live.filter(Boolean).length;
  let s = 0;
  s += 20 * Math.min(flowShare / 0.35, 1);
  s += 20 * (nLive / 6);
  s += 15 * 0.5;
  s += 15 * (i.blastPct <= 15 ? 1 : i.blastPct <= 50 ? 0.5 : 0);
  s += 10 * 0.5;
  s += 10 * (i.listGrowing ? 1 : 0);
  s += 10 * ((i.flowsLive.pp || i.flowsLive.winback) ? 1 : 0) * (i.flowsLive.winback ? 1 : 0.5);
  const score = Math.round(s);
  const flowGap = Math.max(0.35 - flowShare, 0) * emailRev;
  const campLeak = (i.blastPct >= 90 ? 0.10 : i.blastPct >= 50 ? 0.05 : 0) * emailRev * (1 - flowShare);
  const leak = flowGap + campLeak;
  const recoverable = leak * 0.7;
  const offWeight = FLOWS.filter((_, idx) => !live[idx]).reduce((a, f) => a + f.share, 0) || 1;
  const fixes = FLOWS.filter((_, idx) => !live[idx]).map((f) => ({
    name: f.name, dollars: flowGap * (f.share / offWeight), effort: f.effort, when: f.when, steps: f.steps }));
  if (i.blastPct >= 50) fixes.push({
    name: "Stop blasting the full list", dollars: campLeak, effort: 1, when: "day 1–7", steps: [
      "Build 3 engagement segments: 30-day, 60-day, 90-day openers/clickers.",
      "Default campaign audience = 90-day engaged. Full-list sends earn ~2 slots/month (launches, biggest promos).",
      "Expect open rates to jump within 2 weeks. Deliverability repairs itself once you stop blasting, and that protects every flow you fix after this." ]});
  if (fixes.length === 0) fixes.push({
    name: "Optimize send-through + RPR on live flows", dollars: emailRev * 0.05, effort: 2, when: "day 1–14", steps: [
      "Audit entry triggers and channel eligibility per flow. Most 'complete' accounts still only reach a fraction of eligible volume.",
      "A/B one variable per flow per fortnight: timing first, subject second, offer last." ]});
  fixes.sort((a, b) => b.dollars / b.effort - a.dollars / a.effort);
  return { score, leak, recoverable, emailRev, flowShare, nLive, fixes, isICP: i.monthlyRevenue >= 50000 };
}

// ---- Implementation Week emails (1–7). Email 1 = day 0 (webhook), 2–7 = days 1–6 (cron).
function sequenceEmail(day, inputs, reportId) {
  const r = computeReport(inputs);
  const f1 = r.fixes[0];
  const link = `${SITE_URL}/api/report?id=${reportId}`;
  const sign = "\n— Micah\n";
  const emails = {
    1: { subject: `Your first ${fmt(f1.dollars)}/mo is the easy one`,
      text: `Micah here. Your report says "${f1.name}" is worth about ${fmt(f1.dollars)}/mo. It's ranked #1 because it's the highest dollars-per-effort on your list, not because it's fancy.

Here's the whole play: open your report (${link}), follow the numbered steps under Fix #1, use the template if you grabbed the pack. Most brands finish this one in under an hour. If/then, so you know what you're buying with that hour: fix goes live this week → it touches every eligible customer automatically → you see it in flow revenue within 14 days → you've verified the mechanism on your own account, with your own money.

One ask, and it's for your benefit: when it's live, reply "DONE." I read those, and I'll sanity-check what you built. Send-through settings are where 80% of "finished" flows quietly fail. No charge. No pitch on the other side of it.

The rest of the week: one fix per day, easiest first. Delete any email that doesn't apply to your account.
${sign}
P.S. Your leak isn't a verdict on you or your list. Flows get paused in replatforms and "revamps" all the time. I once found a welcome flow that had earned seven figures sitting in "paused" for months. Nobody noticed. Now you're the person who notices.` },
    2: { subject: "Send fewer emails. Make more. (Here's the math)",
      text: `Quick one today, because it protects every other fix this week.

If your campaigns go to the full list, here's what's actually happening: the majority of that list hasn't opened in 90+ days. Every blast to them tells inbox providers "people ignore this sender," so your emails start landing in places nobody looks, including for the people who love you. That's the blast tax. It was priced into your leak number.

The fix is 20 minutes. Build three segments: 30-day, 60-day, 90-day engaged. Default every campaign to 90-day engaged. Full-list sends earn about two slots a month: real launches, your biggest promo. That's it.

If/then: segment this week → opens climb inside two weeks → that's deliverability repairing itself → every flow you fix after this lands in more inboxes. Order matters. That's why this is early.
${sign}
P.S. "But I'll reach fewer people." You'll DELIVER to more. Reach without inbox placement is a spreadsheet number, not revenue.` },
    3: { subject: "The $1,000,000 flow someone switched off",
      text: `A brand I work with, big list, strong product, watched email revenue fall 42% in a month. Everyone blamed the list. "It's burnt." "People don't read email anymore."

The real cause: during a revamp, someone paused the welcome flow. The PROVEN one. It had earned over $1M lifetime. Its replacement was live but under-triggering, reaching a fraction of new signups. Nobody checked entries vs signups, so for months, the most motivated people on the list, the ones who JUST raised their hand, heard nothing.

Your welcome flow math: a new subscriber's first email is the highest revenue-per-recipient send you will ever make, and it's worth the most in the first 5 minutes, while you're the tab that's still open. Three emails minimum: deliver whatever you promised at signup, then your story + best sellers, then proof + a first-purchase nudge. Split buyers from non-buyers. Never send "10% off your first order" to someone who ordered yesterday.

Then the operator's habit: once a week, compare flow ENTRIES to new SIGNUPS. If those numbers drift apart, something got paused or broken, and you'll catch it in days, not quarters.
${sign}
P.S. Reply DONE when yours is live and I'll look at your trigger settings. Under-triggering is invisible from inside the account.` },
    4: { subject: "Most people stall right here",
      text: `Day 3 is where implementation weeks die, so today is deliberately small.

Here's the trap I see constantly: a cart-abandon flow is "live," the team moves on, and it's reaching 12% of cart abandoners. Twelve. The other 88% enter the flow and never get a message: channel eligibility, quiet hours, suppression rules, SMS-only legs on email subscribers. The flow WORKS. The plumbing doesn't.

Ten minutes today: open your biggest flow. Compare "entered" to "sent" for the last 30 days. If sent ÷ entered is under 80%, click into the filters and eligibility settings. The culprit is almost always one checkbox someone set two years ago for a reason nobody remembers.

That's it. No new builds today. If you found a number under 80% and can't see why, reply with a screenshot. This one's genuinely faster for me to spot than for you to hunt.
${sign}
P.S. If you've done fixes 1–3: you've likely already covered most of your ${fmt(r.recoverable)}/mo. The back half of the week is compounders.` },
    5: { subject: "The most expensive email you're not sending",
      text: `Acquisition keeps getting more expensive. That's not a trend that reverses. The brands that survive it make every buyer worth more, and the post-purchase flow is where that happens or doesn't.

Four emails: celebrate the order (confirmation ≠ celebration) → how to actually use the thing, timed to ARRIVAL day, not order day → a check-in + review ask → the logical next product. Not a random cross-sell. The thing their purchase says they'll need next. Someone who bought a starter kit needs the refill. Someone who bought sleep support will ask about energy. Solve the next problem in line.

If/then: buyer uses the product properly → gets the result → the reorder email lands on someone who's GLAD to see it → your revenue stops being 100% hostage to ad platforms.
${sign}
P.S. The reviews you harvest in email 3 of this flow become the proof in your welcome flow, your cart flow, your ads. One flow feeds all of them.` },
    6: { subject: "Delete 30% of your list (I'm serious)",
      text: `Two flows today, one principle: every address on your list either makes you money, might make you money, or costs you money. Most lists are heavy on category three.

WINBACK: for lapsed BUYERS, triggered 45–90 days after last order (30 is too pushy; you'll train people to wait for discounts). Reminder → proof → incentive → last call.

SUNSET: for 90-day non-openers, a short "should we stay in touch?" arc, then suppress the silent. Yes, suppress. They're not reading anyway. But their silence is dragging your deliverability for everyone who is.

The gut-check: your list count will go DOWN and your revenue will go UP, because open rates, inbox placement, and per-send revenue all climb when the audience is real. Vanity metric down, bank account up.
${sign}
P.S. If losing the number on the dashboard stings, re-run your Retention Score in a few weeks and watch what happens to the parts that pay.` },
    7: { subject: "You're not the same account you were on Monday",
      text: `Look at what you did this week: found the leak, fixed by dollars-per-effort, checked send-through like someone who knows where flows die, cleaned the list on purpose. That's not "doing email marketing." That's OPERATING: running retention on data instead of vibes. Most brands never make that switch.

Two things before I leave your inbox:

ONE: re-run your Retention Score (free, same place you got the first one: ${SITE_URL}/score). Whatever it says becomes your new baseline. In 60 days you can re-run it again and put a number on this week.

TWO, a question, not a pitch: now that the fixes are live, who checks the numbers NEXT Monday? And the one after? Flows drift. Triggers break in replatforms. Someone paused that $1M flow, remember. The leak you just fixed was somebody's unwatched dashboard. If the answer is "me, when I remember," hit reply and tell me. I'll show you the weekly scorecard system I run, and you can decide if it's worth $149/mo. If the answer is "we've got it handled," genuinely great. Keep the templates, re-run the score free anytime, and reply if a fix ever misbehaves.

Either way: you found money this week. That was you, not me.
${sign}` },
  };
  return emails[day] || null;
}

// ---- server-rendered report page (paid) — matches Editorial Oxblood
function renderReportHtml(inputs) {
  const r = computeReport(inputs);
  const fixes = r.fixes.map((f, i) => `
    <div style="border:1px solid #DED6C7;border-radius:12px;padding:18px 20px;margin-top:14px;background:#F4EFE4;">
      <h3 style="font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:19px;margin:0 0 4px;color:#17140F;">#${i + 1} · ${f.name}</h3>
      <div style="font-family:'Space Mono',monospace;font-size:12px;color:#7A736A;">≈ <b style="color:#8a6a26;">${fmt(f.dollars)}/mo</b> · ${f.when} · effort ${"▮".repeat(f.effort)}${"▯".repeat(3 - f.effort)}</div>
      <ol style="margin:12px 0 0 18px;padding:0;font-size:15px;color:#3f3a33;">${f.steps.map((s) => `<li style="margin-bottom:7px;">${s}</li>`).join("")}</ol>
    </div>`).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your Recovery Plan — MRGN Leak Report</title><meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;600&family=Space+Grotesk:wght@500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
</head><body style="margin:0;background:#F4EFE4;color:#17140F;font-family:'Inter',sans-serif;font-size:17px;line-height:1.6;">
<div style="max-width:760px;margin:0 auto;padding:40px 22px;">
<div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:19px;">Micah Jacobi<span style="color:#7C2A2A;">.</span></div>
<h1 style="font-family:'Playfair Display',serif;font-weight:500;font-size:42px;line-height:1.08;margin:26px 0 10px;">Your Recovery Plan</h1>
<p style="color:#7A736A;max-width:640px;">Score <b style="color:#17140F;">${r.score}/100</b>. <b style="color:#7C2A2A;">${fmt(r.leak)}/mo</b> leaking, <b style="color:#8a6a26;">${fmt(r.recoverable)}/mo</b> recoverable. Ordered by dollars ÷ effort, top to bottom, ~30 days. Your list isn't the problem: ${r.nLive}/6 money flows are live. <b style="color:#17140F;">Mechanical fixes, mechanical money.</b></p>
<div style="background:#fff;border:1px solid #DED6C7;border-radius:12px;padding:26px;margin-top:24px;">
<div style="font-family:'Space Mono',monospace;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#7A736A;margin-bottom:8px;">Ranked fix list</div>
${fixes}
</div>
<div style="background:#fff;border:1px solid #DED6C7;border-radius:12px;padding:26px;margin-top:20px;">
<div style="font-family:'Space Mono',monospace;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#7A736A;margin-bottom:8px;">Implementation Week</div>
<p style="font-size:15px;color:#3f3a33;margin:0;">One fix per day is heading to your inbox for the next 7 days. Quick wins first, templates included. Reply <b>DONE</b> to any of them and I'll sanity-check your build personally. Want your fixes sequenced on a free 20-minute call? <a href="${SITE_URL}/book" style="color:#7C2A2A;">Book the Implementation Plan</a>.</p>
</div>
<p style="font-family:'Space Mono',monospace;font-size:11px;color:#7A736A;margin-top:26px;text-align:center;">MRGN Leak Report — built by Micah Jacobi · a MAXMRGN product · re-run free in 60 days</p>
</div></body></html>`;
}

module.exports = { supabase, stripe, resend, SITE_URL, EMAIL_FROM, fmt, computeReport, sequenceEmail, renderReportHtml };
