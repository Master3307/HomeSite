require("./services/processLog.cjs").capture("accounts");
require("dotenv").config();
const { origin } = require("./config.cjs");

const path = require("node:path");

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const { registerDiscordOAuth } = require("./services/discordOAuth.cjs");
const { registerFdcWeb, LARGE_BODY_PATHS } = require("./services/fdcWeb.cjs");
const { registerLobbyCat } = require("./services/lobbyCat.cjs");
const { createActivityLog } = require("./services/activityLog.cjs");
const { registerAdminBackup } = require("./services/adminBackup.cjs");
const { registerHub } = require("./services/hub.cjs");

const PORT = Number(process.env.ACCOUNT_API_PORT || 3002);

// Default http://localhost:5173 (config/settings.cjs); set it with pnpm setup:gui.
const FRONTEND_ORIGIN = origin("FRONTEND_ORIGIN");

const allowedOrigins = new Set(
  [
    FRONTEND_ORIGIN,
    // The profile API's /<id>-ui pages log in to the hub from there.
    origin("PROFILE_API_ORIGIN"),
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].filter(Boolean),
);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function corsOrigin(origin, callback) {
  if (!origin || allowedOrigins.has(origin)) {
    return callback(null, true);
  }

  console.warn(`[Account API] Blocked CORS origin: ${origin}`);

  return callback(new Error(`CORS origin not allowed: ${origin}`));
}

const corsOptions = {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Requested-With", "X-Admin-Key", "X-Backup-Key", "X-Admin-Unlock"],
  exposedHeaders: ["Content-Disposition", "X-Backup-Files", "X-Backup-Time-Differences"],
  optionsSuccessStatus: 204,
};

function requireTrustedMutation(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const origin = req.get("Origin");

  if (!origin || !allowedOrigins.has(origin)) {
    return res.status(403).json({
      error: "Invalid request origin.",
    });
  }

  if (req.get("X-Requested-With") !== "homesite-web") {
    return res.status(403).json({
      error: "Missing or invalid CSRF request header.",
    });
  }

  return next();
}

const app = express();

app.set("trust proxy", 1);

app.use(cors(corsOptions));

app.options(/.*/, cors(corsOptions));

// Routes with uploads (LARGE_BODY_PATHS) parse their own, larger bodies.
const jsonParser = express.json();
app.use((req, res, next) =>
  LARGE_BODY_PATHS.has(req.path) ? next() : jsonParser(req, res, next),
);

app.use(cookieParser());

app.use(requireTrustedMutation);

// Append-only activity log (server/services/db/activity-log.jsonl).
const activity = createActivityLog(path.join(__dirname, "services", "db"));

const accounts = registerDiscordOAuth(app, { activity });

registerFdcWeb(app, { ...accounts, activity });
registerAdminBackup(app, { ...accounts, activity });
registerLobbyCat(app, accounts);
const hub = registerHub(app, { ...accounts, activity, allowedOrigins });

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "accounts",
    allowedOrigins: [...allowedOrigins],
  });
});

app.use((error, _req, res, _next) => {
  if (error?.message?.startsWith("CORS origin not allowed:")) {
    return res.status(403).json({
      error: error.message,
    });
  }

  // Client errors from middleware, e.g. body-parser's 413 "entity.too.large".
  const status = Number(error?.status || error?.statusCode);

  if (status >= 400 && status < 500) {
    return res.status(status).json({
      error: error.expose && error.message ? error.message : "Bad request.",
    });
  }

  console.error("[Account API] Unhandled error:", error);

  return res.status(500).json({
    error: "Internal server error.",
  });
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Account API] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[Account API] Allowed frontend origin: ${FRONTEND_ORIGIN}`);
});

// WebSockets for the /hub terminal.
hub.attach(server);
