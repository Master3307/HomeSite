/*
 * Re-uploads an FDC poll's options message with the number + emoji badge
 * on every image (as new polls get automatically), keeping the order.
 *
 *   pnpm fdc:rebadge [date]            # preview only (default: latest poll)
 *   pnpm fdc:rebadge [date] --apply    # edit the Discord message
 *   pnpm fdc:rebadge --all [--apply]   # every poll in the archive
 *
 * (Same as `node scripts/fdc-rebadge.cjs …`.) Needs DISCORD_BOT_TOKEN.
 *
 * The images come from the archive (the raw, never-badged copies), so the
 * script can be run again without stacking badges; GIFs stay animated.
 * Previews are written to .logs/fdc-rebadge/<date>/.
 */
require("dotenv").config({ quiet: true });

const fs = require("node:fs/promises");
const path = require("node:path");
const { addBadge } = require("../server/services/fdcBadge.cjs");

const ARCHIVE = process.env.FDC_ARCHIVE_DIR
  ? path.resolve(process.env.FDC_ARCHIVE_DIR)
  : path.join(__dirname, "..", "server", "services", "db", "fdc-polls");
const API = "https://discord.com/api/v10";
const TOKEN = process.env.DISCORD_BOT_TOKEN;

async function discord(route, options = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${API}${route}`, {
      ...options,
      headers: { Authorization: `Bot ${TOKEN}`, ...(options.headers ?? {}) },
    });
    const body = await response.json().catch(() => null);

    // Rate limited: wait as long as Discord asks, then try again.
    if (response.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, (body?.retry_after ?? 1) * 1000 + 250));
      continue;
    }
    if (!response.ok) throw new Error(`Discord ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dates = (await fs.readdir(ARCHIVE)).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort();
  if (!TOKEN) throw new Error("DISCORD_BOT_TOKEN is missing.");

  const chosen = args.includes("--all")
    ? dates
    : [args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) ?? dates.at(-1)];

  let failed = 0;
  for (const date of chosen) {
    try {
      await rebadge(date, apply);
    } catch (error) {
      failed += 1;
      console.error(`FDC ${date}: skipped (${error.message})`);
    }
  }
  if (failed) process.exitCode = 1;
}

async function rebadge(date, apply) {
  const poll = JSON.parse(await fs.readFile(path.join(ARCHIVE, date, "data.json"), "utf8"));
  if (!poll.mediaMessageId) throw new Error(`The FDC of ${date} has no options message.`);

  const message = await discord(`/channels/${poll.channelId}/messages/${poll.mediaMessageId}`);
  const attachments = message.attachments ?? [];
  const outDir = path.join(__dirname, "..", ".logs", "fdc-rebadge", date);
  await fs.mkdir(outDir, { recursive: true });

  const files = [];
  for (const [index, option] of poll.options.entries()) {
    const attachment =
      attachments.find((item) => item.filename?.startsWith(`${option.number}-`)) ?? attachments[index];
    if (!attachment) throw new Error(`No image for option ${option.number} on Discord.`);

    const source = await fs.readFile(path.join(ARCHIVE, date, option.media?.localFile ?? `${option.number}.webp`));
    const badged = await addBadge(source, option);
    const stem = attachment.filename.replace(/^\d+-/, "").replace(/\.[a-z0-9]+$/i, "") || "media";
    const name = `${option.number}-${stem}.${badged.extension}`;

    await fs.writeFile(path.join(outDir, name), badged.buffer);
    files.push({ name, buffer: badged.buffer });
    console.log(`  ${option.number}. ${attachment.filename} -> ${name} (${Math.round(badged.buffer.length / 1024)} KiB)`);
  }

  console.log(`FDC ${date}: ${files.length} badged images in ${path.relative(process.cwd(), outDir)}`);

  if (!apply) {
    console.log("  preview only (add --apply to update the Discord message)");
    return;
  }

  // New attachment list = only the uploaded files (old ones are dropped), in option order.
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      content: message.content || "Options:",
      attachments: files.map((file, id) => ({ id, filename: file.name })),
    }),
  );
  files.forEach((file, id) => form.append(`files[${id}]`, new Blob([file.buffer]), file.name));

  const edited = await discord(`/channels/${poll.channelId}/messages/${poll.mediaMessageId}`, {
    method: "PATCH",
    body: form,
  });
  console.log(`  updated ${edited.attachments.length} images: https://discord.com/channels/${poll.guildId}/${poll.channelId}/${poll.mediaMessageId}`);
  // Stay well clear of Discord's rate limits between polls.
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
