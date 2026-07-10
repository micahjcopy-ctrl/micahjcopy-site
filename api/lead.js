const { supabase } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { inputs, report } = req.body || {};
  const db = supabase();
  if (!db || !inputs || !inputs.email) return res.status(200).json({ ok: true, demo: !db });
  await db.from("leads").upsert(
    {
      email: inputs.email,
      monthly_revenue: inputs.monthlyRevenue,
      platform: inputs.platform,
      score: report ? report.score : null,
      leak: report ? Math.round(report.leak) : null,
      is_icp: report ? !!report.isICP : false,
      inputs,
    },
    { onConflict: "email" }
  );
  return res.status(200).json({ ok: true });
};
