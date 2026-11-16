/*
 * pnpm bongo:import <folder>
 *
 * Imports the Bongo Cat assets from an AssetRipper "Export Unity Project"
 * folder (or its ExportedProject / Assets folder) into
 * server/services/db/bongo-cat. Run it again after a game update: only
 * changed textures are replaced and new items are added.
 * The same import is in the admin settings (folder upload) and in pnpm setup.
 */
const assets = require("../server/services/bongoAssets.cjs");

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.log("Usage: pnpm bongo:import <AssetRipper export folder>");
    console.log("Example: pnpm bongo:import ~/BongoCatUnity");
    process.exit(1);
  }
  const before = assets.status();
  console.log(`${before.imported ? "Updating" : "Importing"} Bongo Cat assets from ${folder} …`);
  const report = await assets.importFromFolder(folder, {
    label: "pnpm bongo:import",
    onProgress: (done, total, step = "Checking textures") => process.stdout.isTTY && process.stdout.write(`\r  ${step} ${done}/${total}\x1b[K`),
  });
  process.stdout.write("\n");
  console.log(
    `Done: ${Object.entries(report.counts)
      .map(([kind, count]) => `${count} ${{ skin: "skins", hat: "accessories", bongos: "bongos", themes: "UI themes", fonts: "fonts" }[kind] ?? `${kind} items`}`)
      .join(", ")}. ` +
      `${report.added} new item(s), ${report.updated} updated, ${report.changedFiles} file(s) written` +
      (report.kept ? `, ${report.kept} older item(s) kept` : "") +
      (report.skipped ? `. Skipped ${report.skipped} item(s) without all their textures (${report.skippedItems.join(", ")}).` : "."),
  );
  console.log("Restart nothing: the site picks the new assets up right away.");
}

main().catch((error) => {
  console.error(`Import failed: ${error.message}`);
  process.exit(1);
});
