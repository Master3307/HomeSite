const {
  ApplicationCommandOptionType,
  ChannelType,
  Collection,
  InteractionType,
  MessageFlags,
  SnowflakeUtil,
} = require("discord.js");

/*
 * Runs the bot's slash and prefix commands from /hub (bot internal API).
 *
 * Commands expect a Discord interaction (or message). They get a stand-in
 * with the same shape: the hub user acts as the owner (DISCORD_USER_ID),
 * public replies are posted in the chosen channel, ephemeral replies are
 * only returned to the hub. Modals and button clicks can't be shown there.
 */

const OPTION_TYPES = {
  [ApplicationCommandOptionType.String]: "string",
  [ApplicationCommandOptionType.Integer]: "integer",
  [ApplicationCommandOptionType.Number]: "number",
  [ApplicationCommandOptionType.Boolean]: "boolean",
  [ApplicationCommandOptionType.User]: "user",
  [ApplicationCommandOptionType.Channel]: "channel",
  [ApplicationCommandOptionType.Role]: "role",
  [ApplicationCommandOptionType.Mentionable]: "mentionable",
  [ApplicationCommandOptionType.Attachment]: "attachment",
};

const SUB = ApplicationCommandOptionType.Subcommand;
const GROUP = ApplicationCommandOptionType.SubcommandGroup;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/* ---------- describing commands ---------- */

function describeOption(option) {
  return {
    name: option.name,
    description: option.description ?? "",
    type: OPTION_TYPES[option.type] ?? "string",
    required: Boolean(option.required),
    choices: option.choices?.map((choice) => ({ name: choice.name, value: choice.value })) ?? null,
    autocomplete: Boolean(option.autocomplete),
    channelTypes: option.channel_types ?? null,
    min: option.min_value ?? option.min_length ?? null,
    max: option.max_value ?? option.max_length ?? null,
  };
}

/** Every command with its subcommands and options, for the hub's command runner. */
function listCommands(client) {
  const slash = [...client.slashCommands.values()].map((command) => {
    const data = typeof command.data?.toJSON === "function" ? command.data.toJSON() : command.data;
    const variants = [];
    const options = data.options ?? [];
    if (options.some((option) => option.type === SUB || option.type === GROUP)) {
      for (const option of options) {
        if (option.type === SUB) {
          variants.push({ group: null, sub: option.name, description: option.description, options: (option.options ?? []).map(describeOption) });
        } else if (option.type === GROUP) {
          for (const sub of option.options ?? []) {
            variants.push({ group: option.name, sub: sub.name, description: sub.description, options: (sub.options ?? []).map(describeOption) });
          }
        }
      }
    } else {
      variants.push({ group: null, sub: null, description: data.description, options: options.map(describeOption) });
    }
    return {
      kind: "slash",
      name: data.name,
      description: data.description ?? "",
      variants,
      hasAutocomplete: client.autocompleteInteractions.has(data.name),
    };
  });

  const prefix = [...client.commands.values()].map((command) => ({
    kind: "prefix",
    name: command.name,
    description: command.description ?? "",
    usage: command.usage ?? "",
    aliases: command.aliases ?? [],
    args: Boolean(command.args),
  }));

  return {
    prefix: process.env.BOT_PREFIX || "!",
    commands: [...slash, ...prefix].sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind)),
  };
}

/* ---------- serialising replies for the hub ---------- */

function serialisePayload(payload) {
  if (payload == null) return { content: "" };
  if (typeof payload === "string") return { content: payload };
  const toJson = (item) => (typeof item?.toJSON === "function" ? item.toJSON() : item);
  return {
    content: payload.content ?? "",
    embeds: (payload.embeds ?? []).map(toJson),
    components: (payload.components ?? []).map(toJson),
    files: (payload.files ?? []).map((file) => file?.name ?? file?.attachment?.toString?.().split("/").pop() ?? "file"),
  };
}

function isEphemeral(payload, fallback = false) {
  if (!payload || typeof payload !== "object") return fallback;
  if (payload.ephemeral) return true;
  const flags = Number(typeof payload.flags === "object" ? payload.flags?.bitfield : payload.flags ?? 0);
  return Boolean(flags & MessageFlags.Ephemeral) || fallback;
}

function stripFlags(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const { ephemeral: _e, flags: _f, fetchReply: _r, withResponse: _w, ...rest } = payload;
  return rest;
}

/* ---------- option values ---------- */

async function resolveOptions(client, guild, definitions, raw) {
  const resolved = [];
  for (const definition of definitions) {
    const value = raw?.[definition.name];
    if (value === undefined || value === null || value === "") {
      if (definition.required) throw httpError(400, `"${definition.name}" is required.`);
      continue;
    }
    const option = { name: definition.name, type: Number(Object.keys(OPTION_TYPES).find((key) => OPTION_TYPES[key] === definition.type)) };
    const text = String(value).trim();
    switch (definition.type) {
      case "integer":
      case "number": {
        const number = Number(text);
        if (!Number.isFinite(number) || (definition.type === "integer" && !Number.isInteger(number))) {
          throw httpError(400, `"${definition.name}" must be a ${definition.type}.`);
        }
        option.value = number;
        break;
      }
      case "boolean":
        option.value = value === true || /^(true|on|yes|1)$/i.test(text);
        break;
      case "user": {
        const user = await client.users.fetch(text).catch(() => null);
        if (!user) throw httpError(400, `Unknown user for "${definition.name}".`);
        option.value = user.id;
        option.user = user;
        option.member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
        break;
      }
      case "channel": {
        const channel = await client.channels.fetch(text).catch(() => null);
        if (!channel) throw httpError(400, `Unknown channel for "${definition.name}".`);
        option.value = channel.id;
        option.channel = channel;
        break;
      }
      case "role": {
        const role = guild?.roles.cache.get(text) ?? (await guild?.roles.fetch(text).catch(() => null));
        if (!role) throw httpError(400, `Unknown role for "${definition.name}".`);
        option.value = role.id;
        option.role = role;
        break;
      }
      case "mentionable": {
        const role = guild?.roles.cache.get(text);
        if (role) {
          option.value = role.id;
          option.role = role;
        } else {
          const user = await client.users.fetch(text).catch(() => null);
          if (!user) throw httpError(400, `Unknown user or role for "${definition.name}".`);
          option.value = user.id;
          option.user = user;
          option.member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
        }
        break;
      }
      case "attachment": {
        // An attachment is given as a URL in the hub.
        let url;
        try {
          url = new URL(text);
        } catch {
          throw httpError(400, `"${definition.name}" needs a file URL (https://…).`);
        }
        const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) }).catch(() => null);
        option.value = SnowflakeUtil.generate().toString();
        option.attachment = {
          id: option.value,
          url: url.href,
          proxyURL: url.href,
          name: decodeURIComponent(url.pathname.split("/").pop() || "file"),
          size: Number(head?.headers.get("content-length") || 0),
          contentType: head?.headers.get("content-type") || null,
        };
        break;
      }
      default:
        option.value = text;
    }
    resolved.push(option);
  }
  return resolved;
}

function optionsResolver({ group, sub, options, focused = null }) {
  const find = (name, required) => {
    const option = options.find((entry) => entry.name === name);
    if (!option && required) throw new TypeError(`Option "${name}" is required.`);
    return option ?? null;
  };
  return {
    data: options,
    getSubcommand: (required = true) => {
      if (!sub && required) throw new TypeError("No subcommand.");
      return sub ?? null;
    },
    getSubcommandGroup: (required = false) => {
      if (!group && required) throw new TypeError("No subcommand group.");
      return group ?? null;
    },
    get: (name, required) => find(name, required),
    getString: (name, required) => find(name, required)?.value ?? null,
    getInteger: (name, required) => find(name, required)?.value ?? null,
    getNumber: (name, required) => find(name, required)?.value ?? null,
    getBoolean: (name, required) => find(name, required)?.value ?? null,
    getUser: (name, required) => find(name, required)?.user ?? null,
    getMember: (name) => find(name, false)?.member ?? null,
    getChannel: (name, required) => find(name, required)?.channel ?? null,
    getRole: (name, required) => find(name, required)?.role ?? null,
    getMentionable: (name, required) => {
      const option = find(name, required);
      return option?.member ?? option?.user ?? option?.role ?? null;
    },
    getAttachment: (name, required) => find(name, required)?.attachment ?? null,
    getFocused: (full = false) => (full ? focused : (focused?.value ?? "")),
  };
}

/* ---------- the stand-in interaction ---------- */

async function context(client, { channelId, ownerId }) {
  const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
  if (channelId && !channel) throw httpError(400, "Unknown channel.");
  if (channel && !channel.isTextBased?.()) throw httpError(400, "Pick a text channel or thread.");
  const guild = channel?.guild ?? null;
  const user = await client.users.fetch(ownerId).catch(() => null);
  if (!user) throw httpError(500, "DISCORD_USER_ID is missing or unknown; commands run as that user.");
  const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
  return { channel, guild, user, member };
}

function baseInteraction(client, { channel, guild, user, member, commandName }) {
  const id = SnowflakeUtil.generate().toString();
  return {
    id,
    applicationId: client.application?.id ?? client.user.id,
    client,
    commandName,
    commandId: id,
    channel,
    channelId: channel?.id ?? null,
    guild,
    guildId: guild?.id ?? null,
    user,
    member,
    memberPermissions: member?.permissions ?? null,
    appPermissions: guild?.members.me?.permissionsIn?.(channel) ?? null,
    locale: "en-US",
    guildLocale: guild?.preferredLocale ?? "en-US",
    createdTimestamp: Date.now(),
    createdAt: new Date(),
    token: null,
    version: 1,
    fromHub: true,
    inGuild: () => Boolean(guild),
    inCachedGuild: () => Boolean(guild),
    inRawGuild: () => false,
    isRepliable: () => true,
    isCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false,
    isMessageComponent: () => false,
    isContextMenuCommand: () => false,
    isUserContextMenuCommand: () => false,
    isMessageContextMenuCommand: () => false,
  };
}

/**
 * Runs a slash command. body: { name, group?, sub?, options: { name: value },
 * channelId }. Returns { output: [...], error? }.
 */
async function runSlash(client, body, ownerId) {
  const command = client.slashCommands.get(String(body.name ?? ""));
  if (!command) throw httpError(404, "Unknown command.");
  const described = listCommands(client).commands.find((entry) => entry.kind === "slash" && entry.name === body.name);
  const variant = described.variants.find((entry) => (entry.group ?? null) === (body.group || null) && (entry.sub ?? null) === (body.sub || null));
  if (!variant) throw httpError(400, "Unknown subcommand.");

  const ctx = await context(client, { channelId: body.channelId, ownerId });
  const options = await resolveOptions(client, ctx.guild, variant.options, body.options ?? {});
  const output = [];
  let message = null; // the public reply in the channel
  let ephemeral = false;

  const post = async (payload, { edit = false } = {}) => {
    if (ephemeral || isEphemeral(payload)) {
      if (edit && output.length && output.at(-1).ephemeral) output[output.length - 1] = { ephemeral: true, at: new Date().toISOString(), ...serialisePayload(payload) };
      else output.push({ ephemeral: true, at: new Date().toISOString(), ...serialisePayload(payload) });
      return { id: SnowflakeUtil.generate().toString(), ...serialisePayload(payload), edit: async () => {}, delete: async () => {} };
    }
    if (!ctx.channel) throw new Error("This reply is public: pick a channel to run the command in.");
    const clean = stripFlags(typeof payload === "string" ? { content: payload } : payload);
    if (edit && message) message = await message.edit(clean);
    else message = await ctx.channel.send(clean);
    output.push({ ephemeral: false, at: new Date().toISOString(), messageId: message.id, url: message.url, ...serialisePayload(payload) });
    return message;
  };

  const interaction = {
    ...baseInteraction(client, { ...ctx, commandName: command.data.name }),
    type: InteractionType.ApplicationCommand,
    commandType: 1,
    options: optionsResolver({ group: body.group || null, sub: body.sub || null, options }),
    replied: false,
    deferred: false,
    ephemeral: null,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    async deferReply(payload = {}) {
      this.deferred = true;
      ephemeral = isEphemeral(payload);
      this.ephemeral = ephemeral;
      output.push({ ephemeral, at: new Date().toISOString(), content: "", thinking: true });
    },
    async reply(payload) {
      if (this.replied || this.deferred) throw Object.assign(new Error("The reply to this interaction has already been sent or deferred."), { code: "InteractionAlreadyReplied" });
      this.replied = true;
      ephemeral = isEphemeral(payload);
      this.ephemeral = ephemeral;
      const result = await post(payload);
      return payload?.fetchReply || payload?.withResponse ? (payload.withResponse ? { resource: { message: result } } : result) : undefined;
    },
    async editReply(payload) {
      this.replied = true;
      // Replace the "thinking" placeholder of a deferred reply.
      if (output.length && output.at(-1).thinking) output.pop();
      return post(payload, { edit: true });
    },
    async followUp(payload) {
      const before = ephemeral;
      ephemeral = isEphemeral(payload);
      const result = await post(payload);
      ephemeral = before;
      return result;
    },
    async fetchReply() {
      return message ?? { id: null, content: output.at(-1)?.content ?? "" };
    },
    async deleteReply() {
      if (message) await message.delete().catch(() => {});
      message = null;
    },
    async showModal() {
      throw new Error("This command opens a Discord form (modal), which the hub can't show. Run it in Discord.");
    },
    async update(payload) {
      return post(payload, { edit: true });
    },
  };

  const started = Date.now();
  try {
    await command.execute(interaction);
    return { ok: true, ms: Date.now() - started, output: output.filter((entry) => !entry.thinking || output.length === 1) };
  } catch (error) {
    console.error(`[Hub] /${body.name} failed:`, error);
    return { ok: false, ms: Date.now() - started, error: error.message, output };
  }
}

/** Runs a prefix command as if the owner had typed it in the channel. body: { name, args, channelId }. */
async function runPrefix(client, body, ownerId) {
  const name = String(body.name ?? "").toLowerCase();
  const command = client.commands.get(name) ?? [...client.commands.values()].find((entry) => entry.aliases?.includes(name));
  if (!command) throw httpError(404, "Unknown command.");
  const ctx = await context(client, { channelId: body.channelId, ownerId });
  if (!ctx.channel) throw httpError(400, "Prefix commands need a channel.");
  const prefix = process.env.BOT_PREFIX || "!";
  const argsText = String(body.args ?? "").trim();
  const args = argsText ? argsText.split(/ +/) : [];
  const content = `${prefix}${command.name}${argsText ? ` ${argsText}` : ""}`;
  const output = [];

  const ids = (pattern) => [...content.matchAll(pattern)].map((match) => match[1]);
  const users = new Collection();
  const members = new Collection();
  for (const id of ids(/<@!?(\d{17,20})>/g)) {
    const user = await client.users.fetch(id).catch(() => null);
    if (user) users.set(id, user);
    const member = ctx.guild ? await ctx.guild.members.fetch(id).catch(() => null) : null;
    if (member) members.set(id, member);
  }
  const roles = new Collection(ids(/<@&(\d{17,20})>/g).map((id) => [id, ctx.guild?.roles.cache.get(id)]).filter(([, role]) => role));
  const channels = new Collection(ids(/<#(\d{17,20})>/g).map((id) => [id, client.channels.cache.get(id)]).filter(([, channel]) => channel));

  const send = async (payload) => {
    const sent = await ctx.channel.send(stripFlags(typeof payload === "string" ? { content: payload } : payload));
    output.push({ ephemeral: false, at: new Date().toISOString(), messageId: sent.id, url: sent.url, ...serialisePayload(payload) });
    return sent;
  };

  // The channel's own send() also reaches the output, for commands that use message.channel.send.
  const channel = Object.create(ctx.channel, { send: { value: send } });

  const message = {
    id: SnowflakeUtil.generate().toString(),
    client,
    content,
    author: ctx.user,
    member: ctx.member,
    guild: ctx.guild,
    guildId: ctx.guild?.id ?? null,
    channel,
    channelId: ctx.channel.id,
    createdTimestamp: Date.now(),
    createdAt: new Date(),
    attachments: new Collection(),
    embeds: [],
    mentions: { users, members, roles, channels, everyone: false, has: (target) => users.has(target?.id ?? target) },
    fromHub: true,
    reply: send,
    react: async () => {},
    delete: async () => {},
    inGuild: () => Boolean(ctx.guild),
  };

  const started = Date.now();
  try {
    await command.execute(message, args);
    return { ok: true, ms: Date.now() - started, output };
  } catch (error) {
    console.error(`[Hub] ${prefix}${command.name} failed:`, error);
    return { ok: false, ms: Date.now() - started, error: error.message, output };
  }
}

/** Command-specific suggestions (interactions/autocomplete). body: { name, group, sub, options, focused, channelId }. */
async function autocomplete(client, body, ownerId) {
  const handler = client.autocompleteInteractions.get(String(body.name ?? ""));
  if (!handler) return { choices: [] };
  const ctx = await context(client, { channelId: body.channelId, ownerId }).catch(() => ({ channel: null, guild: null, user: null, member: null }));
  const options = Object.entries(body.options ?? {}).map(([name, value]) => ({ name, value, type: ApplicationCommandOptionType.String }));
  const focused = { name: String(body.focused ?? ""), value: String(body.options?.[body.focused] ?? ""), focused: true };
  let choices = [];
  const interaction = {
    ...baseInteraction(client, { ...ctx, commandName: body.name }),
    type: InteractionType.ApplicationCommandAutocomplete,
    options: optionsResolver({ group: body.group || null, sub: body.sub || null, options, focused }),
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    responded: false,
    async respond(list) {
      this.responded = true;
      choices = (list ?? []).slice(0, 25).map((choice) => ({ name: String(choice.name), value: choice.value }));
    },
  };
  await handler.execute(interaction);
  return { choices };
}

const TEXT_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

module.exports = { listCommands, runSlash, runPrefix, autocomplete, TEXT_TYPES };
