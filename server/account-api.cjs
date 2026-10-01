require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const cookieParser = require("cookie-parser");

const { registerDiscordOAuth } = require("./services/discordOAuth.cjs");

const PORT = Number(process.env.ACCOUNT_API_PORT || 3002);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
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

const app = express();

app.set("trust proxy", 1);

app.use(express.json());

app.use(cookieParser());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  }),
);

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
  });
});

app.use((error, _req, res, _next) => {
  console.error("[Account API] Unhandled error:", error);

  res.status(500).json({
    error: "Internal server error.",
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Account API] Listening on http://127.0.0.1:${PORT}`);
});
