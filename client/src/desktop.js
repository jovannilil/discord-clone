// The Windows installer is published as a GitHub Release (see scripts/release-desktop.js).
// "latest/download" always points at the newest release, so this link never needs to change.
export const DESKTOP_DOWNLOAD_URL =
  "https://github.com/jovannilil/discord-clone/releases/latest/download/Voxoria-Chat-Setup.exe";

// The desktop app adds "VoxoriaChatDesktop" to its user agent (see desktop/main.js).
// (Versions before 1.1.0 said "DiscordCloneDesktop".)
export const isDesktopApp = /VoxoriaChatDesktop|DiscordCloneDesktop/.test(navigator.userAgent);

export const isWindows = /Windows/i.test(navigator.userAgent);
export const isLinux = /Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);
const RELEASE = "https://github.com/jovannilil/discord-clone/releases/latest/download/";
export const LINUX_DEB_URL = RELEASE + "Voxoria-Chat-linux.deb";
export const LINUX_APPIMAGE_URL = RELEASE + "Voxoria-Chat.AppImage";
// The right installer for this computer (Linux gets the .deb, which installs with a double-click on Ubuntu/Mint).
export const DOWNLOAD_URL = isLinux ? LINUX_DEB_URL : DESKTOP_DOWNLOAD_URL;

// Everyone on the website sees the download button; only the desktop app itself hides it.
export const showDesktopDownload = !isDesktopApp;
