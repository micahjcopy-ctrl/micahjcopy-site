const { supabase, stripe, resend, sequenceEmail, EMAIL_FROM } = require("./_lib");

// checkout.session.completed → mark paid, send Email 1 of Implementation Week, log it.
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const s = stripe();
  const db = supabase();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !db || !secret) return res.status(200).json({ ok: true, demo: true });

  let event;
  try {
    const raw = await readRaw(req);
    event = s.webhooks.constructEvent(raw, req.headers["stripe-signature"], secret);
  } catch (e) {
    return res.status(400).json({ error: "Bad signature" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const reportId = session.metadata && session.metadata.report_id;
    if (reportId) {
      await db.from("reports").update({ paid: true, paid_at: new Date().toISOString(), templates: session.metadata && session.metadata.with_templates === "true" }).eq("id", reportId);
      const { data: rep } = await db.from("reports").select("email, inputs").eq("id", reportId).single();
      const r = resend();
      const to = session.customer_email || (rep && rep.email);
      if (r && rep && to) {
        const email1 = sequenceEmail(1, rep.inputs, reportId);
        if (email1) {
          const { error } = await r.emails.send({ from: EMAIL_FROM, to, subject: `Your Leak Report is unlocked — ${email1.subject}`, text: email1.text });
          if (!error) await db.from("sequence_sends").insert({ report_id: reportId, day: 1 });
        }
      }
    }
  }
  return res.status(200).json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
