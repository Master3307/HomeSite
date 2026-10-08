const ACCOUNT_ME_URL = "https://accounts-api.master3307.org/auth/me";
const COOKIE_NAME = "__Secure-homesite_auth";
const ALLOWED_ACCOUNT_ID = "01a10281-3769-7734-9d0d-2ab50a9dda2f";

function readSessionCookie(req) {
  const pairs = String(req.headers.cookie ?? "").split(";");
  const matches = pairs
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${COOKIE_NAME}=`));
  // Reject ambiguous duplicate cookies instead of selecting an arbitrary one.
  if (matches.length !== 1) return null;
  try {
    const token = decodeURIComponent(matches[0].slice(COOKIE_NAME.length + 1));
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

export async function requireStalkingDirectoryOwner(req, res, next) {
  res.setHeader("Cache-Control", "no-store, private");
  res.vary("Cookie");
  const token = readSessionCookie(req);
  if (!token)
    return res
      .status(401)
      .json({ error: "Account login required.", authenticated: false });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(ACCOUNT_ME_URL, {
      headers: {
        Cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return res
        .status(401)
        .json({ error: "Account login required.", authenticated: false });
    }
    if (!response.ok)
      return res
        .status(503)
        .json({ error: "Account authentication is temporarily unavailable." });
    const account = await response.json();
    if (account?.authenticated !== true || !account.user?.id) {
      return res
        .status(401)
        .json({ error: "Account login required.", authenticated: false });
    }
    if (account.user.id !== ALLOWED_ACCOUNT_ID) {
      return res.status(403).json({
        error: "This account cannot access the tracked-user directory.",
      });
    }
    return next();
  } catch (error) {
    console.warn("[Stalking] Account verification failed:", error.name);
    return res
      .status(503)
      .json({ error: "Account authentication is temporarily unavailable." });
  } finally {
    clearTimeout(timer);
  }
}
