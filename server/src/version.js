import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist");

// A fingerprint of the built app. The built index.html names every JS/CSS file by its content hash,
// so this changes whenever the app's code changes. Open apps compare it to the version they loaded
// and refresh themselves when it differs (see client/src/autoUpdate.js).
function computeVersion() {
  try {
    const html = fs.readFileSync(path.join(clientDist, "index.html"));
    return createHash("sha256").update(html).digest("hex").slice(0, 12);
  } catch {
    return "dev"; // no build (local development): never ask clients to refresh
  }
}

export const APP_VERSION = computeVersion();
