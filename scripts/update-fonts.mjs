import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { extname, resolve } from "node:path";

const publicFontsDirectory = resolve("public/fonts");
const googleSansDirectory = resolve("public/fonts/google-sans-flex");
const generatedGoogleSansCssFile = resolve("src/styles/google-sans-flex.css");
const materialSymbolsExtraIconsFile = resolve(
  "scripts/material-symbols.extra.json",
);

const sourceRoots = [resolve("src"), resolve("index.html")];

const sourceExtensions = new Set([".html", ".js", ".jsx", ".ts", ".tsx"]);

const browserHeaders = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

const googleSansFlex = {
  cssUrl:
    "https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,1..1000&display=swap",
};

const materialSymbols = {
  name: "MaterialSymbolsOutlined.woff2",
  cssUrl:
    "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=block",
};

function formatSize(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function isValidWoff2(contents) {
  return contents.subarray(0, 4).toString("ascii") === "wOF2";
}

function getWoff2Urls(css) {
  return [
    ...new Set(
      [
        ...css.matchAll(
          /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s+format\(['"]woff2['"]\)/g,
        ),
      ].map((match) => match[1]),
    ),
  ];
}

function isValidMaterialSymbolName(name) {
  return /^[a-z0-9_]+$/.test(name);
}

async function fetchCss(url) {
  const response = await fetch(url, {
    headers: browserHeaders,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while requesting ${url}`);
  }

  return response.text();
}

async function downloadWoff2(url, destination) {
  const response = await fetch(url, {
    headers: browserHeaders,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while downloading ${url}`);
  }

  const contents = Buffer.from(await response.arrayBuffer());

  if (contents.byteLength === 0) {
    throw new Error(`Downloaded an empty file from ${url}`);
  }

  if (!isValidWoff2(contents)) {
    throw new Error(
      `Expected WOFF2 data from ${url}, but received a different response.`,
    );
  }

  const temporaryFile = `${destination}.tmp`;

  await writeFile(temporaryFile, contents);
  await rename(temporaryFile, destination);

  return contents.byteLength;
}

async function clearDirectory(directory) {
  await rm(directory, {
    recursive: true,
    force: true,
  });

  await mkdir(directory, {
    recursive: true,
  });
}

async function updateGoogleSansFlex() {
  console.log("Fetching Google Sans Flex stylesheet...");

  const remoteCss = await fetchCss(googleSansFlex.cssUrl);
  const urls = getWoff2Urls(remoteCss);

  if (urls.length === 0) {
    throw new Error("Google Fonts returned no Google Sans Flex WOFF2 URLs.");
  }

  await clearDirectory(googleSansDirectory);
  await mkdir(resolve("src/styles"), {
    recursive: true,
  });

  console.log(`Downloading ${urls.length} Google Sans Flex subset file(s)...`);

  let localCss = remoteCss;

  for (const [index, url] of urls.entries()) {
    const filename = `GoogleSansFlex-${String(index).padStart(2, "0")}.woff2`;
    const destination = resolve(googleSansDirectory, filename);
    const size = await downloadWoff2(url, destination);

    localCss = localCss.replaceAll(
      `url(${url})`,
      `url("/fonts/google-sans-flex/${filename}")`,
    );

    console.log(`✓ ${filename} (${formatSize(size)})`);
  }

  await writeFile(generatedGoogleSansCssFile, `${localCss.trim()}\n`);

  console.log("✓ Generated src/styles/google-sans-flex.css");
}

async function getSourceFiles(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const files = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".git"
      ) {
        continue;
      }

      files.push(...(await getSourceFiles(entryPath)));
      continue;
    }

    if (sourceExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

async function findMaterialSymbolSourceFiles() {
  const files = [];

  for (const root of sourceRoots) {
    try {
      const fileStats = await stat(root);

      if (fileStats.isDirectory()) {
        files.push(...(await getSourceFiles(root)));
      } else if (sourceExtensions.has(extname(root))) {
        files.push(root);
      }
    } catch {
      // Missing optional source roots are harmless.
    }
  }

  return [...new Set(files)];
}

function findIconsInSource(source) {
  const icons = new Set();

  const materialSymbolElementPattern =
    /<([A-Za-z][A-Za-z0-9._-]*)\b[^>]*\bclassName\s*=\s*(?:"[^"]*\bmaterial-symbols-outlined\b[^"]*"|'[^']*\bmaterial-symbols-outlined\b[^']*'|`[^`]*\bmaterial-symbols-outlined\b[^`]*`)[^>]*>\s*([a-z0-9_]+)\s*<\/\1\s*>/g;

  const materialIconComponentPattern =
    /<MaterialIcon\b[^>]*>\s*([a-z0-9_]+)\s*<\/MaterialIcon\s*>/g;

  for (const match of source.matchAll(materialSymbolElementPattern)) {
    icons.add(match[2]);
  }

  for (const match of source.matchAll(materialIconComponentPattern)) {
    icons.add(match[1]);
  }

  return icons;
}

async function readExtraMaterialSymbols() {
  try {
    const contents = await readFile(materialSymbolsExtraIconsFile, "utf8");
    const extraIcons = JSON.parse(contents);

    if (!Array.isArray(extraIcons)) {
      throw new Error("must contain a JSON array");
    }

    const invalidIcons = extraIcons.filter(
      (name) =>
        typeof name !== "string" || !isValidMaterialSymbolName(name.trim()),
    );

    if (invalidIcons.length > 0) {
      throw new Error(
        "contains invalid icon names. Use lowercase names with letters, numbers, and underscores only.",
      );
    }

    return extraIcons.map((name) => name.trim());
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw new Error(`scripts/material-symbols.extra.json ${error.message}`);
  }
}

async function findMaterialSymbolNames() {
  const files = await findMaterialSymbolSourceFiles();
  const icons = new Set();

  for (const file of files) {
    const source = await readFile(file, "utf8");

    for (const iconName of findIconsInSource(source)) {
      icons.add(iconName);
    }
  }

  for (const iconName of await readExtraMaterialSymbols()) {
    icons.add(iconName);
  }

  const names = [...icons].filter(isValidMaterialSymbolName).sort();

  if (names.length === 0) {
    throw new Error(
      [
        "No Material Symbols were found.",
        'Use className="material-symbols-outlined">icon_name</...',
        "or add dynamic names to scripts/material-symbols.extra.json.",
      ].join(" "),
    );
  }

  return {
    filesScanned: files.length,
    iconNames: names,
  };
}

async function updateMaterialSymbols() {
  const { filesScanned, iconNames } = await findMaterialSymbolNames();

  console.log(
    `Found ${iconNames.length} Material Symbol icon(s) across ${filesScanned} source file(s):`,
  );
  console.log(`  ${iconNames.join(", ")}`);

  /*
   * Google Fonts' text= query is the supported font-subsetting interface.
   * Spaces make the requested strings separate icon ligatures:
   *
   * arrow_left_alt bolt home ...
   */
  const cssUrl = new URL(materialSymbols.cssUrl);
  cssUrl.searchParams.set("text", iconNames.join(" "));

  console.log("Fetching Material Symbols subset stylesheet...");

  const css = await fetchCss(cssUrl.toString());
  const urls = getWoff2Urls(css);

  if (urls.length !== 1) {
    throw new Error(
      [
        "Expected one Material Symbols WOFF2 response,",
        `got ${urls.length}.`,
        "Google Fonts response:",
        css.slice(0, 500),
      ].join(" "),
    );
  }

  const destination = resolve(publicFontsDirectory, materialSymbols.name);

  console.log("Downloading Material Symbols subset...");

  const size = await downloadWoff2(urls[0], destination);

  if (size < 512) {
    throw new Error(
      "Material Symbols subset is unexpectedly small; refusing to keep it.",
    );
  }

  console.log(`✓ Updated ${materialSymbols.name} (${formatSize(size)})`);
}

async function cleanupTemporaryFiles() {
  await Promise.all([
    rm(resolve(publicFontsDirectory, `${materialSymbols.name}.tmp`), {
      force: true,
    }),
    rm(`${generatedGoogleSansCssFile}.tmp`, {
      force: true,
    }),
  ]);
}

async function main() {
  await mkdir(publicFontsDirectory, {
    recursive: true,
  });

  await updateGoogleSansFlex();
  await updateMaterialSymbols();
}

main().catch(async (error) => {
  await cleanupTemporaryFiles();
  console.error(`\nFont update failed: ${error.message}`);
  process.exitCode = 1;
});
