// The Windows installer is published as a GitHub Release (see scripts/release-desktop.js).
// "latest/download" always points at the newest release, so this link never needs to change.
export const DESKTOP_DOWNLOAD_URL =
  "https://github.com/jovannilil/discord-clone/releases/latest/download/Discord-Clone-Setup.exe";

// The desktop app adds "DiscordCloneDesktop" to its user agent (see desktop/main.js).
export const isDesktopApp = navigator.userAgent.includes("DiscordCloneDesktop");

// Only offer the download on Windows websites (that's the only installer we build).
export const showDesktopDownload = !isDesktopApp && /Windows/i.test(navigator.userAgent);
