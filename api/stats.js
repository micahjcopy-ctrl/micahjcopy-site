const { supabase } = require("./_lib");

// Aggregate funnel stats for /dashboard. Aggregates only — no emails or PII returned.
module.exports = async (req, res) => {
  const db = supabase();
  res.setHeader("Cache-Control", "no-store");
  if (!db) return res.status(200).json({ demo: true });

  const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();

  const [leadsAll, leads30, leads7, leadsIcp, repAll, repPaid, repPaid30, seq, leadRows] = await Promise.all([
    db.from("leads").select("*", { count: "exact", head: true }),
    db.from("leads").select("*", { count: "exact", head: true }).gte("created_at", since30),
    db.from("leads").select("*", { count: "exact", head: true }).gte("created_at", since7),
    db.from("leads").select("*", { count: "exact", head: true }).eq("is_icp", true),
    db.from("reports").select("*", { count: "exact", head: true }),
    db.from("reports").select("*", { count: "exact", head: true }).eq("paid", true),
    db.from("reports").select("*", { count: "exact", head: true }).eq("paid", true).gte("paid_at", since30),
    db.from("sequence_sends").select("*", { count: "exact", head: true }),
    db.from("leads").select("score, leak").order("created_at", { ascending: false }).limit(500),
  ]);

  const rows = leadRows.data || [];
  const avg = (k) => (rows.length ? Math.round(rows.reduce((s, r) => s + (r[k] || 0), 0) / rows.length) : 0);

  const leads = leadsAll.count || 0;
  const buyers = repPaid.count || 0;

  return res.status(200).json({
    demo: false,
    updated: new Date().toISOString(),
    leads: { total: leads, last30: leads30.count || 0, last7: leads7.count || 0, icp: leadsIcp.count || 0 },
    buyers: { total: buyers, last30: repPaid30.count || 0, checkoutsStarted: repAll.count || 0 },
    revenue: { reportsMin: buyers * 47 },
    rates: {
      leadToBuyer: leads ? +((buyers / leads) * 100).toFixed(1) : 0,
      checkoutCompletion: repAll.count ? +(((repPaid.count || 0) / repAll.count) * 100).toFixed(1) : 0,
      icpShare: leads ? +(((leadsIcp.count || 0) / leads) * 100).toFixed(1) : 0,
    },
    avgScore: avg("score"),
    avgLeak: avg("leak"),
    sequenceEmailsSent: seq.count || 0,
  });
};
