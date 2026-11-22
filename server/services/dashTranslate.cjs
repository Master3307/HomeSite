const rateLimit = require("express-rate-limit");

const { setting } = require("../config.cjs");
const { httpError } = require("./http.cjs");

/*
 * Translation for /dash ("house in German", text read from a picture), with
 * the site's own LibreTranslate (offline, on the server: `pnpm translate`).
 *
 *   GET  /dash/translate/languages   [{ code, name, targets }]
 *   POST /dash/translate             { q, source = "auto", target } -> { text, detected }
 *
 * Logged-in people only, rate-limited, 5000 characters at most. The text goes
 * from here to LIBRETRANSLATE_URL (set by the site owner, so a local address
 * is fine) and nowhere else; nothing is stored or logged.
 */

const MAX_TEXT = 5000;
const LANGUAGES_MS = 60 * 60_000;

function registerTranslate(app, { getRequestSession }) {
  let languages = null; // { at, list }
  const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req) => `t:${getRequestSession(req)?.id ?? rateLimit.ipKeyGenerator(req.ip ?? "")}` });
  const base = () => String(setting("LIBRETRANSLATE_URL") ?? "").trim().replace(/\/+$/, "");

  async function call(path, body = null) {
    const root = base();
    if (!root) throw httpError(404, "Translation is switched off on this site.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const key = setting("LIBRETRANSLATE_API_KEY");
      const answer = await fetch(`${root}${path}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
        body: body ? JSON.stringify(key ? { ...body, api_key: key } : body) : undefined,
        signal: controller.signal,
      });
      const data = await answer.json().catch(() => null);
      if (!answer.ok) throw httpError(answer.status === 400 ? 400 : 502, data?.error ? `Translation: ${data.error}` : `The translation service answered ${answer.status}.`);
      return data;
    } catch (error) {
      if (error.status) throw error;
      throw httpError(503, "The translation service isn't running (start it with pnpm translate).");
    } finally {
      clearTimeout(timer);
    }
  }

  const route = (handler) => async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      if (!getRequestSession(req)) throw httpError(401, "Log in to translate.");
      res.json(await handler(req));
    } catch (error) {
      if (!error.status) console.error("[Dash] translate:", error.message);
      res.status(error.status ?? 500).json({ error: error.status ? error.message : "Something went wrong." });
    }
  };

  app.get(
    "/dash/translate/languages",
    limiter,
    route(async () => {
      if (languages && Date.now() - languages.at < LANGUAGES_MS) return languages.list;
      const list = await call("/languages");
      const clean = (Array.isArray(list) ? list : []).map((entry) => ({ code: String(entry.code).slice(0, 12), name: String(entry.name).slice(0, 60), targets: Array.isArray(entry.targets) ? entry.targets.map((code) => String(code).slice(0, 12)) : [] }));
      languages = { at: Date.now(), list: clean };
      return clean;
    }),
  );

  app.post(
    "/dash/translate",
    limiter,
    route(async (req) => {
      const text = String(req.body?.q ?? "").trim();
      const target = String(req.body?.target ?? "").trim();
      const source = String(req.body?.source ?? "auto").trim() || "auto";
      if (!text) throw httpError(400, "Nothing to translate.");
      if (text.length > MAX_TEXT) throw httpError(400, `That's too long (${MAX_TEXT} characters at most).`);
      if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(target) || !/^(?:auto|[a-z]{2,3}(?:-[A-Za-z]{2,4})?)$/.test(source)) throw httpError(400, "Unknown language.");
      const data = await call("/translate", { q: text, source, target, format: "text" });
      return { text: String(data?.translatedText ?? ""), detected: data?.detectedLanguage ? { code: String(data.detectedLanguage.language ?? ""), confidence: Number(data.detectedLanguage.confidence) || null } : null };
    }),
  );
}

module.exports = { registerTranslate };
