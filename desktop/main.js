// Desktop app: a window that loads the online server.
// Because the whole interface comes from the server, every deploy updates the app for everyone
// the next time it opens (or when they press Ctrl+R). No reinstall needed.

const { app, BrowserWindow, shell, session, desktopCapturer, Menu } = require("electron");
const path = require("node:path");
const config = require("./config.json");

const SERVER_URL = process.env.SERVER_URL || config.serverUrl;
const serverOrigin = new URL(SERVER_URL).origin;

// Google blocks sign-in from user agents that say "Electron", so present as plain Chrome.
// "VoxoriaChatDesktop" lets the website know it's inside the app (to hide the "Download app" button).
app.userAgentFallback =
  app.userAgentFallback.replace(/ Electron\/\S+/, "").replace(/ voxoria-chat-desktop\/\S+/, "") + " VoxoriaChatDesktop";

// Many Linux setups (e.g. Ubuntu 24.04+) block Chromium's sandbox helper, which makes the app silently
// fail to open. This app only shows our own website, so running without that sandbox is fine.
if (process.platform === "linux") app.commandLine.appendSwitch("no-sandbox");

// Only one copy of the app at a time; a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) app.quit();

let win;

function loadServer() {
  // Show the spinner first. It stays on screen until the server's page arrives
  // (the free server sleeps when unused and can take up to a minute to wake up).
  win
    .loadFile(path.join(__dirname, "loading.html"))
    .then(() => win.loadURL(SERVER_URL))
    .catch(() => {}); // failures are handled by "did-fail-load"
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: "#313338",
    title: "Voxoria Chat",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  // Google's sign-in popup opens inside the app; every other link opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://accounts.google.com/")) {
      return { action: "allow", overrideBrowserWindowOptions: { width: 500, height: 650, autoHideMenuBar: true } };
    }
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("did-fail-load", (_event, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted by a newer navigation */ || !url.startsWith(serverOrigin)) return;
    win.loadFile(path.join(__dirname, "offline.html"));
  });

  loadServer();
}

// Mic and camera are allowed for our server only.
function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const fromServer = (details.requestingUrl || webContents.getURL()).startsWith(serverOrigin);
    callback(fromServer && ["media", "display-capture", "clipboard-sanitized-write", "notifications"].includes(permission));
  });

  // Screen sharing: Electron needs us to pick the source. We share the main screen with its audio off.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const [screen] = await desktopCapturer.getSources({ types: ["screen"] });
      callback(screen ? { video: screen } : {});
    },
    { useSystemPicker: true } // On macOS this shows the system picker instead.
  );
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "App",
        submenu: [
          { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => loadServer() },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
    ])
  );
  setupPermissions();
  createWindow();
});

app.on("window-all-closed", () => app.quit());

// Lets offline.html ask to retry.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (url === "app://retry") {
      event.preventDefault();
      loadServer();
    }
  });
});
