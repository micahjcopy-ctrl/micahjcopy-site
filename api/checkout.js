const { supabase, stripe, computeReport, SITE_URL } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { inputs, withTemplates } = req.body || {};
  const db = supabase();
  const s = stripe();
  if (!db || !s || !process.env.STRIPE_PRICE_REPORT) {
    return res.status(503).json({ error: "Checkout is being switched on — email micahjcopy@gmail.com with 'LEAK REPORT' and I'll unlock your report manually today." });
  }
  const report = computeReport(inputs);
  const { data, error } = await db
    .from("reports")
    .insert({ email: inputs.email, inputs, score: report.score, leak: Math.round(report.leak), is_icp: report.isICP, paid: false })
    .select("id")
    .single();
  if (error || !data) return res.status(500).json({ error: "Could not create report." });

  const line_items = [{ price: process.env.STRIPE_PRICE_REPORT, quantity: 1 }];
  if (withTemplates && process.env.STRIPE_PRICE_TEMPLATES) line_items.push({ price: process.env.STRIPE_PRICE_TEMPLATES, quantity: 1 });

  const session = await s.checkout.sessions.create({
    mode: "payment",
    customer_email: inputs.email,
    line_items,
    metadata: { report_id: data.id, with_templates: String(!!withTemplates) },
    success_url: `${SITE_URL}/thanks?rid=${data.id}`,
    cancel_url: `${SITE_URL}/score`,
  });
  return res.status(200).json({ url: session.url });
};
