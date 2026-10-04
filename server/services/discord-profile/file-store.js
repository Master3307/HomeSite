import fs from "node:fs/promises";
import path from "node:path";

export function csvEscape(value) {
  const stringValue = value == null ? "" : String(value);

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

export function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);

  return values;
}

export function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);

    return Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""]),
    );
  });
}

export async function ensureCsvFile(filePath, headers) {
  await fs.mkdir(path.dirname(filePath), {
    recursive: true,
  });

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `${headers.join(",")}\n`, "utf8");
  }
}

export async function readCsvRows(filePath, headers) {
  await ensureCsvFile(filePath, headers);

  const raw = await fs.readFile(filePath, "utf8");

  return parseCsv(raw);
}

export async function writeCsvRows(filePath, headers, rows) {
  await fs.mkdir(path.dirname(filePath), {
    recursive: true,
  });

  const body = rows
    .map((row) =>
      headers.map((header) => csvEscape(row[header] ?? "")).join(","),
    )
    .join("\n");

  await fs.writeFile(
    filePath,
    `${headers.join(",")}\n${body}${body ? "\n" : ""}`,
    "utf8",
  );
}

export async function appendCsvRow(filePath, headers, row) {
  await ensureCsvFile(filePath, headers);

  const line = headers.map((header) => csvEscape(row[header] ?? "")).join(",");

  await fs.appendFile(filePath, `${line}\n`, "utf8");
}

export async function ensureJsonFile(filePath, fallbackValue) {
  await fs.mkdir(path.dirname(filePath), {
    recursive: true,
  });

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(
      filePath,
      JSON.stringify(fallbackValue, null, 2),
      "utf8",
    );
  }
}

export async function readJsonFile(filePath, fallbackValue) {
  await ensureJsonFile(filePath, fallbackValue);

  try {
    const raw = await fs.readFile(filePath, "utf8");

    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

export async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), {
    recursive: true,
  });

  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
