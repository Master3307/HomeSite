const { execSync } = require("node:child_process");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function commandSucceeds(cmd) {
  try {
    execSync(cmd, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function hasStagedChanges() {
  return !commandSucceeds("git diff --cached --quiet");
}

function ensureCleanWorkingTree() {
  if (!commandSucceeds("git diff --quiet")) {
    throw new Error(
      "Working tree still has unstaged changes after git add. Resolve them before continuing.",
    );
  }

  if (!commandSucceeds("git diff --cached --quiet")) {
    throw new Error(
      "Index still has staged changes after commit attempt. Resolve them before continuing.",
    );
  }
}

try {
  // Start on dev and save local work.
  run("git checkout dev");
  run("git fetch --prune");
  run("git add .");

  if (hasStagedChanges()) {
    run('git commit -m "chore: save local changes before sync"');
  }

  ensureCleanWorkingTree();

  // Bring dev up to date first.
  run("git pull --rebase origin dev");

  // Update master locally without merging it into dev yet.
  run("git checkout master");
  run("git pull --rebase origin master");

  // Merge the latest master into dev.
  run("git checkout dev");

  console.log("\nTrying fast-forward merge: master -> dev");

  if (!commandSucceeds("git merge --ff-only master")) {
    console.log(
      "\nFast-forward merge was not possible; attempting a regular non-interactive merge.",
    );

    run("git merge --no-edit master");
  }

  // Only reached if the master -> dev merge succeeded without conflicts.
  run("git push origin dev");

  // Merge the tested/synchronised dev branch back into master.
  run("git checkout master");
  run("git merge --no-edit dev");
  run("git push origin master");

  // Leave the repository in the usual development branch.
  run("git checkout dev");

  console.log("\n--------------------------------------");
  run("git status");
} catch (err) {
  console.error("\nCommand failed:", err.message);
  console.error(
    "\nIf this stopped during a merge conflict, resolve the conflict manually, then run:",
  );
  console.error("  git add <resolved-files>");
  console.error("  git commit");
  console.error("  git push");
  process.exit(1);
}
