import crypto from "node:crypto";

import {
  DISCORD_API,
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  FRONTEND_ORIGIN,
} from "../config.js";

import { avatarUrl } from "../discord-formatters.js";

export function registerAuthRoutes(app) {
  app.get("/auth/discord", (req, res) => {
    const state = crypto.randomBytes(32).toString("base64url");

    req.session.oauthState = state;

    const authorizeUrl = new URL("https://discord.com/oauth2/authorize");

    authorizeUrl.searchParams.set("client_id", DISCORD_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", DISCORD_REDIRECT_URI);

    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "identify");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("prompt", "consent");

    res.redirect(authorizeUrl.toString());
  });

  app.get("/auth/discord/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";

    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).send("Invalid or expired Discord login request.");
    }

    delete req.session.oauthState;

    try {
      const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: DISCORD_REDIRECT_URI,
        }),
      });

      if (!tokenResponse.ok) {
        console.error(
          "Discord OAuth token exchange failed:",
          await tokenResponse.text(),
        );

        return res.status(401).send("Discord login failed.");
      }

      const tokens = await tokenResponse.json();

      const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!userResponse.ok) {
        console.error(
          "Discord OAuth profile fetch failed:",
          await userResponse.text(),
        );

        return res.status(401).send("Could not retrieve Discord profile.");
      }

      const user = await userResponse.json();

      req.session.discordUser = {
        id: user.id,
        username: user.username,
        displayName: user.global_name ?? user.username,
        avatar: avatarUrl(user),
      };

      return res.redirect(FRONTEND_ORIGIN);
    } catch (error) {
      console.error("Discord OAuth callback error:", error);

      return res.status(500).send("Server error during Discord login.");
    }
  });

  app.get("/auth/me", (req, res) => {
    if (!req.session.discordUser) {
      return res.status(401).json({
        authenticated: false,
      });
    }

    return res.json({
      authenticated: true,
      user: req.session.discordUser,
    });
  });

  app.post("/auth/logout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        return next(error);
      }

      res.clearCookie("homesite_session");

      return res.status(204).end();
    });
  });
}
