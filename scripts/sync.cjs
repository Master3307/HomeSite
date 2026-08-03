const { execSync } = require("child_process");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

try {
  // git add .
  run("git add .");

  // (git diff --cached --quiet || git commit)
  try {
    execSync("git diff --cached --quiet");
    console.log("No changes to commit.");
  } catch {
    run("git commit");
  }

  // git pull --rebase
  run("git pull --rebase");

  // git push
  run("git push");

  // git checkout master
  run("git checkout master");

  // git merge dev
  run("git merge dev");

  // git pull --rebase
  run("git pull --rebase");

  // git push
  run("git push");

  // git checkout dev
  run("git checkout dev");

  // echo lines
  console.log("");
  console.log("--------------------------------------");

  // git status
  run("git status");
} catch (err) {
  console.error("Error occurred:", err.message);
  process.exit(1);
}
