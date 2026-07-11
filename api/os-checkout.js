const { stripe, SITE_URL } = require("./_lib");

// Retention OS subscription checkout ($149/mo). Requires STRIPE_PRICE_OS (recurring price).
module.exports = async (req, res) => {
  const s = stripe();
  const price = process.env.STRIPE_PRICE_OS;
  if (!s || !price) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<!DOCTYPE html><html><body style="margin:0;background:#F4EFE4;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#17140F;"><div style="max-width:460px;padding:40px;text-align:center;"><h1 style="font-family:Georgia,serif;font-weight:500;">Founding cohort opens soon</h1><p style="color:#7A736A;">Email <a href="mailto:micahjcopy@gmail.com" style="color:#7C2A2A;">micahjcopy@gmail.com</a> with "OS" and you're on the founders list at the locked price.</p></div></body></html>`);
  }
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url: `${SITE_URL}/members?joined=1`,
    cancel_url: `${SITE_URL}/os`,
  });
  res.statusCode = 303;
  res.setHeader("Location", session.url);
  res.end();
};
