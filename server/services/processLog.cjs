const fs = require("node:fs");
const path = require("node:path");

/*
 * Copies everything a service prints (console.log, warnings, crashes) into
 * .logs/services/<name>.log, so /hub can show the logs of the bot and the
 * APIs no matter how they are started (systemd, pm2, a terminal).
 *
 * The file is rotated at MAX_BYTES (one old copy, <name>.log.1). .logs/ is
 * gitignored and part of backups (category "logs").
 *
 * Usage, first line of a service: require("./services/processLog.cjs").capture("bot");
 */

const LOG_DIR = path.resolve(__dirname, "..", "..", ".logs", "services");
const MAX_BYTES = 5 * 1024 * 1024;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

let captured = false;

function capture(name) {
  if (captured || !/^[a-z0-9-]+$/.test(name)) return;
  captured = true;

  const file = path.join(LOG_DIR, `${name}.log`);
  let size = 0;
  let stream = null;
  let lineStart = true;

  function open() {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      stream = fs.createWriteStream(file, { flags: "a", mode: 0o600 });
      stream.on("error", () => {
        stream = null;
      });
    } catch {
      stream = null;
    }
  }

  function rotate() {
    try {
      stream?.end();
      fs.renameSync(file, `${file}.1`);
    } catch {
      // Keep writing to the same file if renaming fails.
    }
    open();
  }

  function write(level, chunk, encoding) {
    if (!stream) return;
    let text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(typeof encoding === "string" ? encoding : "utf8");
    text = text.replace(ANSI, "");
    if (!text) return;
    // Every line gets a timestamp and the stream it came from.
    let out = "";
    for (const part of text.split(/(?<=\n)/)) {
      if (lineStart) out += `${new Date().toISOString()} ${level} `;
      out += part;
      lineStart = part.endsWith("\n");
    }
    size += Buffer.byteLength(out);
    stream.write(out);
    if (size > MAX_BYTES) rotate();
  }

  open();
  write("INFO", `--- ${name} started (pid ${process.pid}, node ${process.version}) ---\n`);

  for (const [target, level] of [
    [process.stdout, "INFO"],
    [process.stderr, "ERROR"],
  ]) {
    const original = target.write.bind(target);
    target.write = (chunk, encoding, callback) => {
      try {
        write(level, chunk, encoding);
      } catch {
        // Logging must never break the service.
      }
      return original(chunk, encoding, callback);
    };
  }

  process.on("exit", (code) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} INFO --- ${name} stopped (exit code ${code}) ---\n`);
    } catch {
      // ignore
    }
  });
}

module.exports = { capture, LOG_DIR };
