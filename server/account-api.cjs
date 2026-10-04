require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const { registerDiscordOAuth } = require("./services/discordOAuth.cjs");

const PORT = Number(process.env.ACCOUNT_API_PORT || 3002);

const FRONTEND_ORIGIN = String(process.env.FRONTEND_ORIGIN || "").replace(
  /\/$/,
  "",
);

if (!FRONTEND_ORIGIN) {
  throw new Error("Missing FRONTEND_ORIGIN");
}

const allowedOrigins = new Set([
  FRONTEND_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

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
  allowedHeaders: ["Content-Type", "X-Requested-With"],
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

app.use(express.json());

app.use(cookieParser());

app.use(requireTrustedMutation);

registerDiscordOAuth(app);

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

  console.error("[Account API] Unhandled error:", error);

  return res.status(500).json({
    error: "Internal server error.",
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Account API] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[Account API] Allowed frontend origin: ${FRONTEND_ORIGIN}`);
});
