require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const cookieParser = require("cookie-parser");

const { registerDiscordOAuth } = require("./services/discordOAuth.cjs");

const PORT = Number(process.env.ACCOUNT_API_PORT || 3002);

const FRONTEND_ORIGIN = String(process.env.FRONTEND_ORIGIN || "").replace(
  /\/$/,
  "",
);

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!FRONTEND_ORIGIN) {
  throw new Error("Missing FRONTEND_ORIGIN");
}

if (!SESSION_SECRET) {
  throw new Error("Missing SESSION_SECRET");
}

const allowedOrigins = new Set([
  FRONTEND_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

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
  allowedHeaders: ["Content-Type"],
  optionsSuccessStatus: 204,
};

const app = express();

app.set("trust proxy", 1);

app.use(cors(corsOptions));

app.options(/.*/, cors(corsOptions));

app.use(express.json());

app.use(cookieParser());

app.use(
  session({
    name: "homesite_oauth",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    },
  }),
);

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
