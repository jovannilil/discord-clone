// The Windows installer is published as a GitHub Release (see scripts/release-desktop.js).
// "latest/download" always points at the newest release, so this link never needs to change.
export const DESKTOP_DOWNLOAD_URL =
  "https://github.com/jovannilil/discord-clone/releases/latest/download/Discord-Clone-Setup.exe";

// The desktop app adds "DiscordCloneDesktop" to its user agent (see desktop/main.js).
export const isDesktopApp = navigator.userAgent.includes("DiscordCloneDesktop");

export const isWindows = /Windows/i.test(navigator.userAgent);

// Everyone on the website sees the download button; only the desktop app itself hides it.
export const showDesktopDownload = !isDesktopApp;
