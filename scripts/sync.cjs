const { execSync } = require("node:child_process");

let currentStep = "initialization";

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function output(cmd) {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commandSucceeds(cmd) {
  try {
    execSync(cmd, { stdio: "inherit" });
    return true;
  } catch (err) {
    // Git diff returns 1 when differences exist.
    // Other failures should not be treated as ordinary changes.
    if (err.status === 1) {
      return false;
    }

    throw err;
  }
}

function hasStagedChanges() {
  return !commandSucceeds("git diff --cached --quiet");
}

function ensureCleanWorkingTree() {
  if (output("git status --porcelain")) {
    throw new Error(
      "Working tree is not clean. Resolve remaining changes before continuing.",
    );
  }
}

function step(name, action) {
  currentStep = name;
  console.log(`\n--- ${name} ---`);
  action();
}

try {
  step("Switch to dev and save local changes", () => {
    run("git checkout dev");
    run("git add .");

    if (hasStagedChanges()) {
      run('git commit -m "chore: save local changes before sync"');
    }

    ensureCleanWorkingTree();
  });

  step("Fetch remote branches", () => {
    run("git fetch --prune origin");
  });

  // Record the exact remote state used by this synchronization.
  const remoteDev = output("git rev-parse refs/remotes/origin/dev");
  const remoteMaster = output("git rev-parse refs/remotes/origin/master");

  step("Rebase dev onto fetched origin/dev", () => {
    run(`git rebase ${remoteDev}`);
  });

  step("Rebase master onto fetched origin/master", () => {
    run("git checkout master");
    run(`git rebase ${remoteMaster}`);
  });

  step("Rebase dev onto updated master", () => {
    run("git checkout dev");
    run("git rebase master");
    ensureCleanWorkingTree();
  });

  step("Push synchronized dev", () => {
    run(
      `git push --force-with-lease=refs/heads/dev:${remoteDev} origin dev:dev`,
    );
  });

  step("Fast-forward master to synchronized dev", () => {
    run("git checkout master");

    // dev now contains master, so this advances master without
    // creating a merge commit or rewriting its existing history.
    run("git merge --ff-only dev");
  });

  step("Push master", () => {
    run("git push origin master:master");
  });

  step("Return to dev", () => {
    run("git checkout dev");
  });

  console.log("\n--------------------------------------");
  console.log("Synchronization completed successfully.");
  run("git status");
} catch (err) {
  console.error(`\nFailed during: ${currentStep}`);
  console.error(err.message);

  console.error(`
If a rebase stopped because of conflicts:
  1. Resolve the conflicting files.
  2. Stage each resolved file:
       git add <resolved-files>
  3. Continue:
       git rebase --continue
  4. Repeat until the rebase finishes.

To cancel an in-progress rebase:
  git rebase --abort

Do not rerun this script while a rebase is still in progress.
After completing or aborting the rebase, rerun the script.

If a push was rejected, inspect the rejection before retrying.
Do not replace the lease-protected push with --force.
`);

  process.exitCode = 1;
}
