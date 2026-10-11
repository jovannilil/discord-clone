// Uploads your latest commits to GitHub, then tells Render to redeploy.
// Run with: npm run ship
//
// Render reads the code from the public GitHub repo but isn't linked to it,
// so it can't see pushes on its own. The deploy hook (kept in .deploy-hook,
// which is never uploaded) is a private link that starts a new deploy.

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const hookFile = path.join(root, ".deploy-hook");

if (execSync("git status --porcelain", { cwd: root }).toString().trim()) {
  console.log("You have changes that aren't committed yet. Commit them first, then run this again.");
  process.exit(1);
}

console.log("Uploading to GitHub...");
execSync("git push", { cwd: root, stdio: "inherit" });

if (!fs.existsSync(hookFile)) {
  console.log("No .deploy-hook file found, so Render was not told to redeploy.");
  process.exit(1);
}

const hook = fs.readFileSync(hookFile, "utf8").trim();
fetch(hook, { method: "POST" })
  .then((res) => {
    if (!res.ok) throw new Error(`Render answered ${res.status}`);
    console.log("Render is redeploying. The new version will be live in about 3-5 minutes.");
  })
  .catch((err) => {
    console.error("Couldn't reach Render:", err.message);
    process.exit(1);
  });
