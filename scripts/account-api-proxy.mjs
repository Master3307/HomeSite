import { request } from "node:http";
/*
 * Same-origin proxy for the account API in `vite dev` and `vite preview`.
 *
 * The production API sets its session cookie for master3307.org with the
 * Secure flag, so a site running on localhost or a LAN address never keeps
 * it and an admin-key login (needed to create FDC polls) does not stick.
 * Serving the API under /account-api on the site's own origin fixes that:
 * cookies are rewritten to be host-only (and non-Secure on plain http, see
 * rewriteSetCookie).
 *
 * Targets are tried in order and the first healthy one is used, so a local
 * account API (`pnpm accounts`, with `pnpm bot` for Discord) wins and the
 * production API is the fallback. Override with ACCOUNT_API_PROXY_TARGETS
 * (comma-separated).
 */

export const ACCOUNT_API_PROXY_PREFIX = "/account-api";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const HEALTH_TTL_MS = 15_000;
const HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "host",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

/*
 * On plain http the cookie can't be Secure, and browsers only accept
 * __Secure-/__Host- cookies with Secure set. So on http those prefixes are
 * swapped for markers on the way out and restored on the way back in.
 */
const COOKIE_PREFIXES = [
  ["__Secure-", "proxy-secure--"],
  ["__Host-", "proxy-host--"],
];

function rewriteSetCookie(cookie, secure) {
  const [pair, ...attributes] = cookie.split(";").map((part) => part.trim());
  let name = pair;

  if (!secure) {
    for (const [prefix, marker] of COOKIE_PREFIXES) {
      if (name.startsWith(prefix)) name = marker + name.slice(prefix.length);
    }
  }

  return [
    name,
    ...attributes.filter((attribute) => {
      const key = attribute.split("=")[0].toLowerCase();
      return key !== "domain" && (secure || key !== "secure");
    }),
  ].join("; ");
}

function restoreCookieHeader(header) {
  return header
    .split(";")
    .map((part) => {
      const cookie = part.trim();
      for (const [prefix, marker] of COOKIE_PREFIXES) {
        if (cookie.startsWith(marker)) return prefix + cookie.slice(marker.length);
      }
      return cookie;
    })
    .join("; ");
}

export function accountApiProxy({ targets, frontendOrigin }) {
  const candidates = targets.map((target) => target.replace(/\/$/, ""));
  let active = null;
  let checkedAt = 0;

  async function pickTarget() {
    if (Date.now() - checkedAt < HEALTH_TTL_MS) return active;

    let next = null;

    for (const target of candidates) {
      try {
        const response = await fetch(`${target}/health`, {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) {
          next = target;
          break;
        }
      } catch {
        // Try the next target.
      }
    }

    if (next !== active || !checkedAt) {
      console.log(
        next
          ? `[account-api proxy] ${ACCOUNT_API_PROXY_PREFIX} -> ${next}`
          : `[account-api proxy] no reachable target (${candidates.join(", ")})`,
      );
    }

    active = next;
    checkedAt = Date.now();
    return active;
  }

  async function middleware(req, res, next) {
    const url = req.url ?? "";
    if (url !== ACCOUNT_API_PROXY_PREFIX && !url.startsWith(`${ACCOUNT_API_PROXY_PREFIX}/`)) {
      return next();
    }

    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };

    const secure = Boolean(req.socket.encrypted);
    const method = req.method ?? "GET";

    // Keep the API's CSRF guarantee: mutations must come from this site.
    if (!SAFE_METHODS.has(method)) {
      const selfOrigin = `${secure ? "https" : "http"}://${req.headers.host}`;
      if (req.headers.origin !== selfOrigin) {
        return send(403, { error: "Invalid request origin." });
      }
    }

    const target = await pickTarget();
    if (!target) return send(502, { error: "The account API is unreachable." });

    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_HEADERS.has(name) && value !== undefined) headers[name] = value;
    }

    if (headers.cookie) headers.cookie = restoreCookieHeader(headers.cookie);

    // The API only accepts its own frontend origin.
    if (headers.origin) headers.origin = frontendOrigin;

    try {
      const upstream = await fetch(
        `${target}${url.slice(ACCOUNT_API_PROXY_PREFIX.length) || "/"}`,
        {
          method,
          headers,
          body: SAFE_METHODS.has(method) ? undefined : req,
          duplex: "half",
          redirect: "manual",
        },
      );

      res.statusCode = upstream.status;

      upstream.headers.forEach((value, name) => {
        if (!HOP_HEADERS.has(name) && name !== "set-cookie") res.setHeader(name, value);
      });

      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) {
        res.setHeader("Set-Cookie", cookies.map((cookie) => rewriteSetCookie(cookie, secure)));
      }

      // Streamed, so server-sent events (/hub live feed, logs, terminal) work too.
      if (!upstream.body) return res.end();
      res.flushHeaders?.();
      req.on("close", () => upstream.body.cancel().catch(() => {}));
      for await (const chunk of upstream.body) res.write(chunk);
      res.end();
    } catch (error) {
      // A stream that was already running just ends (closed tab, API restart).
      if (res.headersSent) {
        res.destroy();
        return;
      }
      checkedAt = 0; // re-check targets on the next request
      send(502, { error: `The account API is unreachable (${error.name}).` });
    }
  }

  /* WebSocket upgrades (the /hub terminal) are passed through as raw sockets. */
  function upgrade(req, socket, head) {
    const url = req.url ?? "";
    if (!url.startsWith(`${ACCOUNT_API_PROXY_PREFIX}/hub/terminal/ws`)) return;
    pickTarget().then((target) => {
      if (!target) return socket.destroy();
      const headers = { ...req.headers, origin: frontendOrigin };
      if (headers.cookie) headers.cookie = restoreCookieHeader(headers.cookie);
      const upstream = request(`${target}${url.slice(ACCOUNT_API_PROXY_PREFIX.length)}`, { method: "GET", headers });
      upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
            .map(([name, value]) => `${name}: ${value}`)
            .join("\r\n")}\r\n\r\n`,
        );
        if (upstreamHead?.length) socket.write(upstreamHead);
        if (head?.length) upstreamSocket.write(head);
        upstreamSocket.pipe(socket).pipe(upstreamSocket);
        upstreamSocket.on("error", () => socket.destroy());
        socket.on("error", () => upstreamSocket.destroy());
      });
      upstream.on("response", (response) => {
        socket.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);
      });
      upstream.on("error", () => socket.destroy());
      upstream.end();
    });
  }

  return {
    name: "account-api-proxy",
    configureServer(server) {
      server.middlewares.use(middleware);
      server.httpServer?.on("upgrade", upgrade);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
      server.httpServer?.on("upgrade", upgrade);
    },
  };
}
