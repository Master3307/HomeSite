/*
 * Creates missing locale JSON files so Weblate can discover them from the
 * repository file mask, stages those files with Git, and can optionally create
 * missing Weblate components.
 *
 * Run once to create and stage files, then commit and push them:
 *   pnpm weblate:components --apply
 *   git commit -m "Add missing locale files"
 *   git push
 *
 * After Weblate has updated its repository:
 *   pnpm weblate:components --apply --components
 *
 * Dry run:
 *   pnpm weblate:components
 *
 * Needs WEBLATE_API_URL and WEBLATE_API_TOKEN only with --components.
 * Optional: WEBLATE_PROJECT (default "homesite").
 *
 * Existing locale files are never overwritten or staged. Newly created files
 * contain an empty JSON object; they contain no translations.
 */
import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

const API = (process.env.WEBLATE_API_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.WEBLATE_API_TOKEN ?? "";
const PROJECT = process.env.WEBLATE_PROJECT || "homesite";
const APPLY = process.argv.includes("--apply");
const CREATE_COMPONENTS = process.argv.includes("--components");
const LOCALES_DIR = "src/locales";
const REQUEST_TIMEOUT_MS = 60_000;

if (CREATE_COMPONENTS && !APPLY) {
  console.error("--components requires --apply.");
  process.exit(1);
}

if (CREATE_COMPONENTS && (!API || !TOKEN)) {
  console.error(
    "Set WEBLATE_API_URL and WEBLATE_API_TOKEN to create components.",
  );
  process.exit(1);
}

async function api(pathname, options = {}) {
  const url = pathname.startsWith("http") ? pathname : `${API}${pathname}`;
  const method = options.method ?? "GET";
  let response;

  try {
    response = await fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Token ${TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error(
        `${method} ${pathname}: request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
      );
    }
    throw new Error(`${method} ${pathname}: ${error.message}`);
  }

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(
      `${method} ${pathname}: ${response.status} ${detail.slice(0, 500)}`,
    );
  }

  return data;
}

async function all(pathname) {
  const items = [];

  for (let next = `${pathname}?page_size=100`; next; ) {
    const page = await api(next);
    items.push(...(page.results ?? []));
    next = page.next;
  }

  return items;
}

const titleOf = (namespace) =>
  namespace
    .split(/[-_]/)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

const localeEntries = await readdir(LOCALES_DIR, { withFileTypes: true });
const localeDirectories = localeEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const namespaces = (await readdir(path.join(LOCALES_DIR, "en")))
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.slice(0, -5))
  .sort();

const sourceLanguage = "en";
const targetLanguages = localeDirectories.filter(
  (language) => language !== sourceLanguage,
);

console.log(`Locales: ${localeDirectories.join(", ") || "(none)"}`);
console.log(`Source namespaces: ${namespaces.join(", ") || "(none)"}`);
console.log(`Target languages: ${targetLanguages.join(", ") || "(none)"}`);

const createdFiles = [];

// Create missing locale files for Weblate to discover via
// src/locales/*/<namespace>.json.
for (const language of targetLanguages) {
  for (const namespace of namespaces) {
    const file = path.join(LOCALES_DIR, language, `${namespace}.json`);
    let existing;

    try {
      existing = await stat(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    if (existing) {
      if (!existing.isFile()) {
        throw new Error(`Expected a file, but found a non-file path: ${file}`);
      }
      continue;
    }

    if (!APPLY) {
      console.log(`would create locale file ${file}`);
      continue;
    }

    await mkdir(path.dirname(file), { recursive: true });

    try {
      await writeFile(file, "{}\n", { flag: "wx" });
      createdFiles.push(file);
      console.log(`created locale file     ${file}`);
    } catch (error) {
      // Another process may have created the file after the stat check.
      if (error.code === "EEXIST") {
        console.log(`already exists          ${file}`);
        continue;
      }
      throw error;
    }
  }
}

if (!APPLY) {
  console.log(
    "\nDry run only. Run with --apply to create and stage missing locale files.",
  );
  process.exit(0);
}

// Stage only files created by this run; existing files and other changes remain
// untouched. Passing arguments directly avoids shell interpolation.
if (createdFiles.length > 0) {
  try {
    await execFileAsync("git", ["add", "--", ...createdFiles]);
    console.log(
      `\nStaged ${createdFiles.length} newly created locale file(s).`,
    );
  } catch (error) {
    console.error(`Failed to stage locale files: ${error.message}`);
    process.exitCode = 1;
  }
} else {
  console.log("\nNo new locale files to stage.");
}

if (!CREATE_COMPONENTS) {
  console.log(
    "\nCommit and push the staged files, let Weblate update its repository, " +
      "then run with --apply --components to create missing components.",
  );
  process.exit(0);
}

const projectPath = `/projects/${encodeURIComponent(PROJECT)}/components/`;
const components = (await all(projectPath)).filter(
  (component) => !component.is_glossary,
);

if (!components.length) {
  throw new Error(
    `Project "${PROJECT}" has no components to copy settings from (or the token can't see them).`,
  );
}

// Find namespaces already covered by existing component templates or file masks.
const covered = new Set();

for (const component of components) {
  const match = /src\/locales\/(?:en|\*)\/([^/]+)\.json$/.exec(
    component.template || component.filemask || "",
  );
  if (match) covered.add(match[1]);
}

const base =
  components.find(
    (component) => component.repo && !component.repo.startsWith("weblate://"),
  ) ?? components[0];

const linkRepo = `weblate://${PROJECT}/${base.slug}`;
const taken = new Set(components.map((component) => component.slug));
const missingNamespaces = namespaces.filter(
  (namespace) => !covered.has(namespace),
);

const COPIED = [
  "file_format",
  "source_language",
  "language_code_style",
  "language_regex",
  "license",
  "agreement",
  "check_flags",
  "enforced_checks",
  "edit_template",
  "manage_units",
  "new_lang",
  "new_base",
  "intermediate",
  "allow_translation_propagation",
  "enable_suggestions",
  "suggestion_voting",
  "suggestion_autoaccept",
  "priority",
  "restricted",
  "push_on_commit",
  "commit_pending_age",
  "auto_lock_error",
  "merge_style",
  "commit_message",
  "add_message",
  "delete_message",
  "merge_message",
  "addon_message",
  "pull_message",
  "variant_regex",
  "secondary_language",
  "key_filter",
];

for (const namespace of missingNamespaces) {
  const slug = taken.has(namespace) ? `${namespace}-strings` : namespace;
  const filemask = `src/locales/*/${namespace}.json`;

  const body = {
    name: titleOf(namespace),
    slug,
    repo: linkRepo,
    filemask,
    template: `src/locales/en/${namespace}.json`,
  };

  for (const key of COPIED) {
    if (base[key] !== undefined && base[key] !== null && base[key] !== "") {
      body[key] = base[key];
    }
  }

  if (body.source_language && typeof body.source_language === "object") {
    body.source_language = body.source_language.code;
  }

  try {
    await api(projectPath, {
      method: "POST",
      body: JSON.stringify(body),
    });
    taken.add(slug);
    console.log(`created component      ${body.name} (${filemask})`);
  } catch (error) {
    console.error(`failed component       ${body.name}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (missingNamespaces.length === 0) {
  console.log("No missing Weblate components.");
}
