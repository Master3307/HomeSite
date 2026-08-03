const { execSync } = require("child_process");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

try {
  run("git add .");
  run("git fetch");

  try {
    execSync("git diff --cached --quiet", { stdio: "inherit" });
  } catch {
    run("git commit");
  }

  run("git pull --rebase");
  run("git push");
  run("git checkout master");
  run("git merge dev");
  run("git pull --rebase");
  run("git push");
  run("git checkout dev");

  console.log("");
  console.log("--------------------------------------");
  run("git status");
} catch (err) {
  console.error("Command failed:", err.message);
  process.exit(1);
}
