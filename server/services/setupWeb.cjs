const net = require("node:net");
const rateLimit = require("express-rate-limit");

/*
 * The /card setup's "Network" page (SetupShowcase.jsx): it shows visitors
 * their own connection as if it were the owner's. Only what Cloudflare
 * already adds to every request (CF-Connecting-IP and, with the visitor
 * location headers on, country / city / region / time zone) is echoed back
 * to that same visitor. Nothing goes to another service and nothing is
 * stored or logged.
 *
 *   GET /setup/network  { ip, version, country, city, region, timezone, continent }
 */

const clean = (value, max = 80) => {
  if (typeof value !== "string" || !value || value.length > max) return null;
  let text = value;
  try {
    text = decodeURIComponent(value);
  } catch {
    // Not encoded.
  }
  // oxlint-disable-next-line no-control-regex -- removing them is the point
  return text.replace(/[\u0000-\u001F\u007F<>]/g, "").trim() || null;
};

function registerSetup(app) {
  const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
  app.get("/setup/network", limiter, (req, res) => {
    const raw = String(req.get("cf-connecting-ip") || req.ip || "").replace(/^::ffff:/, "");
    const version = net.isIP(raw);
    res.set("Cache-Control", "no-store, private");
    res.json({
      ip: version ? raw : null,
      version: version || null,
      country: clean(req.get("cf-ipcountry"), 4),
      city: clean(req.get("cf-ipcity")),
      region: clean(req.get("cf-region")),
      timezone: clean(req.get("cf-timezone"), 60),
      continent: clean(req.get("cf-ipcontinent"), 4),
    });
  });
}

module.exports = { registerSetup };
