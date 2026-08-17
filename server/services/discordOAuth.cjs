const crypto = require("node:crypto");

function registerDiscordOAuth(app) {
  app.get("/auth/discord", (req, res) => {
    const state = crypto.randomBytes(32).toString("base64url");

    req.session.oauthState = state;

    const query = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
      response_type: "code",
      scope: "identify",
      state,
      prompt: "consent",
    });

    res.redirect(`https://discord.com/oauth2/authorize?${query}`);
  });

  app.get("/auth/discord/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).send("Invalid or expired Discord login request.");
    }

    delete req.session.oauthState;

    try {
      const tokenResponse = await fetch(
        "https://discord.com/api/v10/oauth2/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI,
          }),
        },
      );

      if (!tokenResponse.ok) {
        console.error(
          "Discord token exchange error:",
          await tokenResponse.text(),
        );
        return res.status(401).send("Discord login failed.");
      }

      const tokens = await tokenResponse.json();

      const userResponse = await fetch(
        "https://discord.com/api/v10/users/@me",
        {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
          },
        },
      );

      if (!userResponse.ok) {
        console.error("Discord user fetch error:", await userResponse.text());
        return res.status(401).send("Could not load Discord user.");
      }

      const discordUser = await userResponse.json();

      // Later: upsert this into your database.
      req.session.discordUser = {
        id: discordUser.id,
        username: discordUser.username,
        displayName: discordUser.global_name || discordUser.username,
      };

      return res.redirect(process.env.FRONTEND_ORIGIN);
    } catch (error) {
      console.error("Discord OAuth error:", error);
      return res.status(500).send("An internal server error occurred.");
    }
  });

  app.get("/api/me", (req, res) => {
    if (!req.session.discordUser) {
      return res.status(401).json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      user: req.session.discordUser,
    });
  });
}

module.exports = { registerDiscordOAuth };
