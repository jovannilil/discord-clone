// Keeps every open copy of the app (website tab or desktop app) on the newest deploy.
//
// The server reports a version fingerprint (/api/version, and "app:version" on every socket connect).
// We remember the first one we see; when it changes, a new version was deployed, so we refresh,
// unless you're in a call, in which case we wait until you hang up.

let loadedVersion = null;
let updatePending = false;
let inCall = false;
let reloading = false;
const listeners = new Set();

function maybeReload() {
  if (!updatePending || inCall || reloading) return;
  reloading = true;
  listeners.forEach((fn) => fn({ pending: true, reloading: true }));
  setTimeout(() => window.location.reload(), 1500); // long enough to read "Updating…"
}

export function reportVersion(version) {
  if (!version || version === "dev") return;
  if (!loadedVersion) {
    loadedVersion = version;
    return;
  }
  if (version !== loadedVersion && !updatePending) {
    updatePending = true;
    listeners.forEach((fn) => fn({ pending: true, reloading: false }));
    maybeReload();
  }
}

export async function checkVersion() {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (res.ok) reportVersion((await res.json()).version);
  } catch {
    // Offline or server waking up; we'll check again soon.
  }
}

/** Main tells us whether you're in a call, so we never refresh in the middle of one. */
export function setInCall(value) {
  inCall = value;
  maybeReload();
}

export function onUpdateStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reloadNow() {
  window.location.reload();
}
