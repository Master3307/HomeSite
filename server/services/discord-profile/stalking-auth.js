const ACCOUNTS_ME_URL = "https://accounts-api.master3307.org/auth/me";

const LOGIN_URL = "https://home.master3307.org/cult";

const AUTH_COOKIE_NAME = "__Secure-homesite_auth";

const ALLOWED_ACCOUNT_ID = "01a10281-3769-7734-9d0d-2ab50a9dda2f";

const AUTH_TIMEOUT_MS = 8000;

function readAuthToken(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader) {
    return null;
  }

  const values = [];

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) continue;

    const name = part.slice(0, separator).trim();

    if (name !== AUTH_COOKIE_NAME) continue;

    try {
      const value = decodeURIComponent(part.slice(separator + 1).trim());

      values.push(value);
    } catch {
      return null;
    }
  }

  // Reject duplicate auth cookies rather than guessing which scope wins.
  if (values.length !== 1) {
    return null;
  }

  const token = values[0];

  // Matches your accounts service's randomBytes(32).toString("base64url").
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }

  return token;
}

function deny(res, status, error) {
  return res.status(status).json({
    error,
    login_url: LOGIN_URL,
  });
}

export function registerStalkingAuthentication(app) {
  app.use(async (req, res, next) => {
    // Covers existing routes and future stalking-prefixed routes:
    // /stalking
    // /stalking-history
    // /stalking-ui
    // /stalking-users
    // /stalking/...
    //
    // Case-insensitive to match Express's default route behavior.
    const isStalkingRoute = /^\/stalking(?:$|[-/])/i.test(req.path);

    if (!isStalkingRoute) {
      return next();
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie");

    const token = readAuthToken(req.headers.cookie);

    if (!token) {
      return deny(
        res,
        401,
        "Authentication required. Log in with your accounts user.",
      );
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

    try {
      const response = await fetch(ACCOUNTS_ME_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Cookie: `${AUTH_COOKIE_NAME}=${token}`,
          "Cache-Control": "no-cache",
        },
        signal: controller.signal,

        // Do not follow redirects with authentication credentials.
        redirect: "error",
      });

      if (response.status === 401 || response.status === 403) {
        return deny(
          res,
          401,
          "Your accounts session is invalid or expired. Log in again.",
        );
      }

      if (!response.ok) {
        return deny(
          res,
          503,
          "Account verification is temporarily unavailable.",
        );
      }

      const account = await response.json();

      if (
        account?.authenticated !== true ||
        typeof account?.user?.id !== "string"
      ) {
        return deny(
          res,
          401,
          "Your accounts session could not be authenticated.",
        );
      }

      if (account.user.id !== ALLOWED_ACCOUNT_ID) {
        return deny(
          res,
          403,
          "This account is not allowed to access presence tracking.",
        );
      }

      // Only retain the verified identity needed by downstream handlers.
      req.stalkingAccount = {
        id: account.user.id,
        username: account.user.username ?? null,
        displayName: account.user.displayName ?? null,
      };

      return next();
    } catch (error) {
      // Do not log the cookie or authentication token.
      console.warn(
        "[Stalking auth] Account verification failed:",
        error instanceof Error ? error.message : String(error),
      );

      return deny(res, 503, "Account verification is temporarily unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  });
}
