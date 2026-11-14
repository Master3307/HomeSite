const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { setting } = require("../config.cjs");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  escapeMarkdown,
} = require("discord.js");

const {
  hasPrivilegedRole,
  postLobbyCode,
  TARGET_CHANNEL_ID,
  REVIEW_CHANNEL_ID,
  REVIEW_ROLE_ID,
} = require("../interactions/slash/utility/lobby-code.cjs");

/*
 * Lobby codes submitted on the website.
 *
 *   admin  (admin-code session)        -> posted right away
 *   user   (Discord login)             -> posted right away when the member
 *                                         has a privileged role (or is the
 *                                         cult leader), otherwise
 *                                         sent for approval under their name
 *   guest  (not logged in, gives name) -> always sent for approval
 *
 * Approval uses the same review channel and Approve/Deny buttons as codes
 * posted in the lobby-code channel by unprivileged members. A web request
 * can carry a description and a guest name, which don't fit in a button's
 * custom ID, so pending requests are kept in db/lobby-requests.json and the
 * buttons reference them as `lobbyapprove:web:<requestId>`.
 */

const STORE_FILE = path.join(__dirname, "db", "lobby-requests.json");
const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LIMITS = { code: 100, description: 1000, name: 32 };

// The cult leader (RottedFox13) can always post directly, roles or not.
const LEADER_DISCORD_ID = setting("COMMUNITY_LEADER_ID");

let storeQueue = Promise.resolve();

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readStore() {
  try {
    const data = JSON.parse(await fs.readFile(STORE_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

/* Serialised read-modify-write of the request store. */
function updateStore(change) {
  const run = storeQueue.then(async () => {
    const store = await readStore();
    const now = Date.now();

    for (const [id, request] of Object.entries(store)) {
      if (now - request.createdAt > REQUEST_TTL_MS) delete store[id];
    }

    const result = await change(store);

    await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
    const temporaryFile = `${STORE_FILE}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, STORE_FILE);

    return result;
  });

  storeQueue = run.catch(() => undefined);
  return run;
}

async function getWebRequest(id) {
  return (await readStore())[id] ?? null;
}

function deleteWebRequest(id) {
  return updateStore((store) => {
    delete store[id];
  });
}

function cleanText(value, max, { multiline = false } = {}) {
  if (typeof value !== "string") return "";

  // Drop control characters (keep newlines in multi-line text).
  const cleaned = value.replace(
    // oxlint-disable-next-line no-control-regex -- removing them is the point
    multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g,
    "",
  );

  return cleaned.trim().slice(0, max);
}

async function sendApprovalRequest(client, request) {
  const reviewChannel = await client.channels
    .fetch(REVIEW_CHANNEL_ID)
    .catch(() => null);

  if (
    !reviewChannel ||
    !reviewChannel.isTextBased() ||
    reviewChannel.type !== ChannelType.GuildText
  ) {
    throw httpError(503, "The review channel is unavailable.");
  }

  const user = request.userId
    ? await client.users.fetch(request.userId).catch(() => null)
    : null;

  const fromChannel = request.source === "channel";

  const embed = new EmbedBuilder()
    .setColor("#2F1A80")
    .setTitle("Lobby Code Approval Request")
    .setDescription(
      (fromChannel
        ? "A non-privileged user submitted a lobby code that requires approval.\n\n"
        : "A lobby code was submitted on the website and requires approval.\n\n") +
        (REVIEW_ROLE_ID ? `<@&${REVIEW_ROLE_ID}>` : ""),
    )
    .addFields(
      {
        name: "Submitted by",
        value: user
          ? `${user} (${user.tag ?? user.username})`
          : `${escapeMarkdown(request.guestName)} (not logged in)`,
        inline: false,
      },
      ...(user ? [{ name: "User ID", value: user.id, inline: false }] : []),
      { name: "Requested Code", value: request.code, inline: false },
      ...(request.description
        ? [{ name: "Description", value: request.description, inline: false }]
        : []),
    )
    .setFooter({
      text: fromChannel ? "Submitted in the lobby-code channel" : "Submitted via the website",
    })
    .setTimestamp(request.createdAt);

  if (user) {
    embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobbyapprove:web:${request.id}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`lobbydeny:web:${request.id}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),
  );

  await reviewChannel.send({ embeds: [embed], components: [row] });

  if (user) {
    await user
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor("#2F1A80")
            .setTitle("Lobby Code Pending Approval")
            .setDescription(
              "You do not currently have permission to post lobby codes " +
                `directly in <#${TARGET_CHANNEL_ID}>. Your ` +
                (fromChannel ? "submitted code" : "code from the website") +
                " has been forwarded for review. Please wait for " +
                "approval or denial from the staff team.",
            )
            .addFields({ name: "Submitted Code", value: request.code, inline: false }),
        ],
      })
      .catch(() => null);
  }
}

/**
 * Handles a website submission (validated input from the account API).
 * Returns `{ status: "posted" }` or `{ status: "pending" }`.
 */
async function submitFromWeb(client, guild, input) {
  const code = cleanText(input?.code, LIMITS.code);
  const description =
    cleanText(input?.description, LIMITS.description, { multiline: true }) || null;
  const mode = input?.mode;

  if (!code) throw httpError(400, "Enter a lobby code.");
  if (/\s/.test(code)) throw httpError(400, "A lobby code can't contain spaces.");

  let userId = null;
  let guestName = null;

  if (mode === "admin" || mode === "user") {
    if (!/^\d{17,20}$/.test(String(input.userId))) {
      throw httpError(400, "Invalid user.");
    }
    userId = String(input.userId);
  } else if (mode === "guest") {
    guestName = cleanText(input?.guestName, LIMITS.name);
    if (!guestName) throw httpError(400, "Enter your name.");
  } else {
    throw httpError(400, "Invalid submission.");
  }

  let direct = mode === "admin";

  if (mode === "user") {
    const member = await guild.members.fetch(userId).catch(() => null);
    direct = !REVIEW_CHANNEL_ID || (LEADER_DISCORD_ID && userId === LEADER_DISCORD_ID) || hasPrivilegedRole(member);
  }

  if (direct) {
    await postLobbyCode(client, code, description, userId);
    return { status: "posted" };
  }

  await requestApproval(client, { code, description, userId, guestName, source: "web" });
  return { status: "pending" };
}

/* Stores a pending request and posts it to the review channel. */
async function requestApproval(client, fields) {
  const request = {
    id: crypto.randomBytes(9).toString("base64url"),
    ...fields,
    createdAt: Date.now(),
  };

  await updateStore((store) => {
    store[request.id] = request;
  });

  try {
    await sendApprovalRequest(client, request);
  } catch (error) {
    await deleteWebRequest(request.id).catch(() => null);
    throw error;
  }

  return request;
}

/**
 * Splits a message from the lobby-code channel into code and description:
 * the first line is the code, everything after it the description (#27).
 *
 *   new-code
 *   this is a description
 */
function parseLobbyMessage(content) {
  const text = String(content ?? "").replace(/\r\n?/g, "\n").trim();
  const newline = text.indexOf("\n");
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const rest = newline === -1 ? "" : text.slice(newline + 1);

  return {
    code: cleanText(firstLine, LIMITS.code),
    description: cleanText(rest, LIMITS.description, { multiline: true }) || null,
  };
}

/**
 * A code posted in the lobby-code channel by a member without a privileged
 * role. Goes through the same stored approval as website submissions, so
 * the description survives (it doesn't fit in a button's custom ID).
 */
function submitFromChannel(client, { code, description, userId }) {
  return requestApproval(client, {
    code,
    description: description || null,
    userId,
    guestName: null,
    source: "channel",
  });
}

module.exports = {
  submitFromWeb,
  submitFromChannel,
  parseLobbyMessage,
  getWebRequest,
  deleteWebRequest,
  LOBBY_SUBMISSION_LIMITS: LIMITS,
};
