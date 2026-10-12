// Uploads desktop/dist/Voxoria-Chat-Setup.exe to a GitHub Release, so the website's
// "Download" button (which points at .../releases/latest/download/Voxoria-Chat-Setup.exe) serves it.
//
// Run with: npm run release:desktop   (after: npm run desktop:installer)
// It uses the GitHub login Git already has saved on this PC (Git Credential Manager).

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPO = "jovannilil/discord-clone";
const ASSET = "Voxoria-Chat-Setup.exe";
const root = path.join(__dirname, "..");
const installer = path.join(root, "desktop", "dist", ASSET);
const { version } = require(path.join(root, "desktop", "package.json"));
const tag = `desktop-v${version}`;

function githubToken() {
  const res = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
  });
  const token = /^password=(.+)$/m.exec(res.stdout ?? "")?.[1];
  if (!token) throw new Error("No saved GitHub login found. Run `git push` once to sign in, then try again.");
  return token;
}

async function gh(url, token, options = {}) {
  const res = await fetch(url.startsWith("http") ? url : `https://api.github.com${url}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (res.status === 404 && options.allow404) return null;
  if (!res.ok) throw new Error(`GitHub ${options.method ?? "GET"} ${url} -> ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  if (!fs.existsSync(installer)) throw new Error(`Build the installer first: npm run desktop:installer`);
  const token = githubToken();

  let release = await gh(`/repos/${REPO}/releases/tags/${tag}`, token, { allow404: true });
  if (!release) {
    console.log(`Creating release ${tag}...`);
    release = await gh(`/repos/${REPO}/releases`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        name: `Desktop app ${version}`,
        body: "Windows installer for the Voxoria Chat desktop app. Download Voxoria-Chat-Setup.exe and run it.",
        make_latest: "true",
      }),
    });
  }

  for (const asset of release.assets ?? []) {
    if (asset.name === ASSET) await gh(`/repos/${REPO}/releases/assets/${asset.id}`, token, { method: "DELETE" });
  }

  const data = fs.readFileSync(installer);
  console.log(`Uploading ${ASSET} (${(data.length / 1e6).toFixed(1)} MB)...`);
  await gh(`https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${ASSET}`, token, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(data.length) },
    body: data,
  });
  console.log(`Done: https://github.com/${REPO}/releases/latest/download/${ASSET}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
