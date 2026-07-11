const { supabase, renderReportHtml } = require("./_lib");

// Serves the paid Recovery Plan: /api/report?id=<uuid>
module.exports = async (req, res) => {
  const id = req.query.id;
  const db = supabase();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!db || !id) return res.status(200).send(page("Almost there", "Report system is being switched on. Your unlock link will arrive by email."));
  const { data } = await db.from("reports").select("*").eq("id", id).single();
  if (!data) return res.status(404).send(page("Report not found", "Check the link in your email, or re-run your free score at micahjacobi.me/score."));
  if (!data.paid) return res.status(200).send(page("Payment processing…", "If you just checked out, refresh in a few seconds. Otherwise your unlock link is in your email."));
  return res.status(200).send(renderReportHtml(data.inputs, !!data.templates));
};

function page(h, p) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h}</title></head>
<body style="margin:0;background:#F4EFE4;color:#17140F;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="max-width:480px;padding:40px;text-align:center;"><h1 style="font-family:Georgia,serif;font-weight:500;">${h}</h1><p style="color:#7A736A;">${p}</p></div></body></html>`;
}
