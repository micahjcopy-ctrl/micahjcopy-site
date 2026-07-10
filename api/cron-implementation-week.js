const { supabase, resend, sequenceEmail, EMAIL_FROM } = require("./_lib");

const MAX_SENDS_PER_RUN = 50;

// Daily cron (vercel.json). Email 1 = day 0 (webhook). Emails 2–7 = days 1–6 after purchase.
module.exports = async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const db = supabase();
  const r = resend();
  if (!db || !r) return res.status(200).json({ ok: true, demo: true });

  const { data: reports } = await db
    .from("reports")
    .select("id, email, inputs, paid_at")
    .eq("paid", true)
    .not("paid_at", "is", null)
    .gte("paid_at", new Date(Date.now() - 10 * 864e5).toISOString());

  let sent = 0;
  const results = [];
  for (const rep of reports || []) {
    if (sent >= MAX_SENDS_PER_RUN) break;
    const daysElapsed = Math.floor((Date.now() - new Date(rep.paid_at).getTime()) / 864e5);
    const maxEmail = Math.min(daysElapsed + 1, 7);
    const { data: log } = await db.from("sequence_sends").select("day").eq("report_id", rep.id);
    const already = new Set((log || []).map((x) => x.day));
    let next = 0;
    for (let n = 1; n <= maxEmail; n++) if (!already.has(n)) { next = n; break; }
    if (!next) continue;
    const email = sequenceEmail(next, rep.inputs, rep.id);
    if (!email) continue;
    const { error } = await r.emails.send({ from: EMAIL_FROM, to: rep.email, subject: email.subject, text: email.text });
    if (error) continue;
    await db.from("sequence_sends").insert({ report_id: rep.id, day: next });
    sent++;
    results.push({ report: rep.id, day: next });
  }
  return res.status(200).json({ ok: true, sent, results });
};
