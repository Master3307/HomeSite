const nodemailer = require("nodemailer");

const { setting, number, enabled } = require("../config.cjs");

/*
 * Outgoing email (verification and login codes) through the SMTP server
 * the admin set up (SMTP_* settings, Settings → Email or pnpm setup).
 * Without SMTP_HOST nothing is sent and email logins stay off.
 */

let transport = null;
let transportKey = "";

const available = () => Boolean(setting("SMTP_HOST") && setting("SMTP_FROM"));

function getTransport() {
  const key = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_SECURE"].map(setting).join("|");
  if (!transport || key !== transportKey) {
    transportKey = key;
    transport = nodemailer.createTransport({
      host: setting("SMTP_HOST"),
      port: number("SMTP_PORT") || 587,
      secure: enabled("SMTP_SECURE"),
      auth: setting("SMTP_USER") ? { user: setting("SMTP_USER"), pass: setting("SMTP_PASSWORD") } : undefined,
      requireTLS: !enabled("SMTP_SECURE"),
    });
  }
  return transport;
}

const template = require("./mailTemplate.cjs");

function from() {
  return setting("SMTP_FROM");
}

async function deliver(to, message) {
  await getTransport().sendMail({ from: from(), to, subject: message.subject, text: message.text, html: message.html, headers: message.headers, attachments: message.attachments });
}

const CODE_PURPOSES = new Set(["verify", "login", "password", "reset", "test"]);

/**
 * An email with a one-time code. `purpose` (verify | login | password |
 * reset | test) picks the texts in the member's language; `user` (a users
 * row) gives name, language, theme, accent and custom CSS.
 */
async function sendCode({ to, user = null, purpose = "test", code, language, theme }) {
  if (!available()) throw Object.assign(new Error("Email isn't set up on this site."), { status: 503 });
  const kind = CODE_PURPOSES.has(purpose) ? purpose : "test";
  const t = template.translator(language ?? template.prefsOf(user).language);
  const message = template.render({
    user,
    language,
    theme,
    subject: t(`${kind}.subject`),
    title: t(`${kind}.title`),
    security: kind !== "test",
    blocks: [{ text: t(`${kind}.intro`) }, { code }, { note: t("code.validity") }],
  });
  await deliver(to, message);
}

/** A notification (moderation, reports, …): `category` decides the unsubscribe link. */
async function sendNotice({ to, user = null, subject, text, link = null, category = "all" }) {
  if (!available()) return false;
  const t = template.translator(template.prefsOf(user).language);
  const site = template.siteOrigin();
  const url = link && site ? `${site}${link}` : null;
  const message = template.render({
    user,
    subject,
    title: subject,
    category: user ? category : null,
    blocks: [{ text }, ...(url ? [{ button: { label: t("open"), url } }] : [])],
  });
  await deliver(to, message);
  return true;
}

/*
 * Security emails (always sent, can't be unsubscribed): something changed
 * about logging in. Each has a "Wasn't you?" with a link to reset the
 * password. `kind`: passwordChanged | passwordReset | passwordRemoved | twoFactor | newBrowser.
 */
async function sendSecurity({ user, kind, values = {} }) {
  if (!available() || !user?.email || !user.email_verified_at) return false;
  const t = template.translator(template.prefsOf(user).language);
  const site = template.siteOrigin();
  const resetUrl = site ? `${site}/cult?login=reset&email=${encodeURIComponent(user.email)}` : null;
  const message = template.render({
    user,
    subject: t(`securityNotice.${kind}.subject`),
    title: t(`securityNotice.${kind}.title`),
    security: true,
    blocks: [
      { text: t(`securityNotice.${kind}.text`, values) },
      { note: new Date().toUTCString() },
      { text: t("securityNotice.notYou") },
      ...(resetUrl ? [{ button: { label: t("securityNotice.resetButton"), url: resetUrl } }] : []),
    ],
  });
  await deliver(user.email, message).catch((error) => console.warn("[Mail] Security email failed:", error.message));
  return true;
}

/** For previews and tests: renders (and sends, with `to`) any email in a given language / theme. */
async function sendPreview({ to, user = null, language = "en", theme = "system", code = "123456" }) {
  const t = template.translator(language);
  const message = template.render({
    user,
    language,
    theme,
    subject: `${t("test.subject")} (${language}, ${theme})`,
    title: t("test.title"),
    category: user ? "all" : null,
    blocks: [{ text: t("test.intro") }, { code }, { note: t("code.validity") }, { button: { label: t("open"), url: `${template.siteOrigin()}/cult` } }],
  });
  if (to) await deliver(to, message);
  return message;
}

module.exports = { available, sendCode, sendNotice, sendSecurity, sendPreview };
