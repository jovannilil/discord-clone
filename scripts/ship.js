// Uploads your latest commits to GitHub, then updates the site you host from this PC.
// Run with: npm run ship
//
// The site runs from the Host Dashboard (Host Dashboard.bat). If it's open, this asks it to rebuild
// the site from the new code and restart it ("Update site" button). If it isn't, nothing is restarted.
// Pushing changes in desktop/ also makes GitHub build and publish a new desktop app (see .github/workflows/desktop.yml).

const { execSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");

if (execSync("git status --porcelain", { cwd: root }).toString().trim()) {
  console.log("You have changes that aren't committed yet. Commit them first, then run this again.");
  process.exit(1);
}

console.log("Uploading to GitHub...");
execSync("git push", { cwd: root, stdio: "inherit" });

fetch("http://localhost:3030/api/rebuild", { method: "POST", headers: { "X-Host-Dashboard": "1" } })
  .then((res) => {
    if (!res.ok) throw new Error(`the dashboard answered ${res.status}`);
    console.log("The Host Dashboard is rebuilding the site. Watch its logs; it's back up in about 30 seconds.");
  })
  .catch(() => {
    console.log("The Host Dashboard isn't open, so the site wasn't updated. Open it and press \"Update site\".");
  });
