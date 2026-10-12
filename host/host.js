// Host dashboard: runs the site from this PC and shows what it's using.
// Run with: npm run host   (or double-click "Host Dashboard.cmd")
//
// Opens http://localhost:3030 in your browser. Start / Stop there turns hosting on and off:
//   Start = build the site if needed, run the server, and open it to the internet with Tailscale Funnel.
//   Stop  = close the Tailscale Funnel and stop the server.
// The dashboard itself only listens on this PC (127.0.0.1), so nobody else can open it or press its buttons.
// Closing this window stops hosting too.

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { fork, spawn, execFile, spawnSync } = require("node:child_process");

const DASHBOARD_PORT = 3030;
const root = path.join(__dirname, "..");
const serverDir = path.join(root, "server");
const clientDir = path.join(root, "client");
const settingsFile = path.join(__dirname, "host.env");
const usageFile = path.join(__dirname, "usage.json");
const HISTORY_POINTS = 300; // 10 minutes at one sample every 2 seconds
const isWindows = process.platform === "win32";

// ---------- Settings (host/host.env, never uploaded to GitHub) ----------

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function readFileOr(file, fallback) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

function createSettingsFile() {
  const devEnv = parseEnv(readFileOr(path.join(serverDir, ".env"), ""));
  const googleId =
    devEnv.GOOGLE_CLIENT_ID || readFileOr(path.join(root, "render.yaml"), "").match(/GOOGLE_CLIENT_ID\s+value:\s*(\S+)/)?.[1] || "";
  fs.writeFileSync(
    settingsFile,
    [
      "# Settings for hosting the site from this PC. This file is never uploaded to GitHub.",
      "#",
      "# Paste your Neon connection string after DATABASE_URL= (Neon dashboard -> your project -> Connect).",
      "# It starts with postgresql://. Without it the site can't reach everyone's accounts and messages.",
      "DATABASE_URL=",
      "",
      "# Signs login tokens. Made for you; changing it logs everyone out.",
      `JWT_SECRET=${crypto.randomBytes(32).toString("hex")}`,
      "",
      `GOOGLE_CLIENT_ID=${googleId}`,
      "",
      "# The port the server uses on this PC (different from npm run dev's 3001, so both can run).",
      "PORT=3080",
      "",
    ].join("\n")
  );
}

if (!fs.existsSync(settingsFile)) createSettingsFile();
const readSettings = () => parseEnv(readFileOr(settingsFile, ""));

// ---------- Log ----------

const logs = [];
let logSeq = 0;
function log(level, text) {
  for (const line of String(text).replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    logs.push({ seq: ++logSeq, t: Date.now(), level, text: line });
  }
  if (logs.length > 2000) logs.splice(0, logs.length - 2000);
}
const pipeLines = (stream, level) => {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk;
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const p of parts) log(level, p);
  });
};

// ---------- Tailscale ----------

function findTailscale() {
  const candidates = isWindows
    ? [path.join(process.env.ProgramFiles || "C:\\Program Files", "Tailscale", "tailscale.exe")]
    : ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

const tailscale = { exe: null, running: false, dnsName: null, funnelOn: false, actionUrl: null, error: null };

function runTailscale(args, timeout = 10_000) {
  return new Promise((resolve) => {
    execFile(tailscale.exe, args, { timeout, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })
    );
  });
}

async function refreshTailscale() {
  tailscale.exe = findTailscale();
  if (!tailscale.exe) return Object.assign(tailscale, { running: false, dnsName: null, funnelOn: false });

  const status = await runTailscale(["status", "--json"], 5000);
  try {
    const json = JSON.parse(status.out);
    tailscale.running = json.BackendState === "Running";
    tailscale.dnsName = json.Self?.DNSName?.replace(/\.$/, "") || null;
    if (!tailscale.running && json.AuthURL) tailscale.actionUrl = json.AuthURL;
  } catch {
    tailscale.running = false;
  }
  if (tailscale.running) {
    const funnel = await runTailscale(["funnel", "status", "--json"], 5000);
    try {
      tailscale.funnelOn = Object.values(JSON.parse(funnel.out).AllowFunnel ?? {}).some(Boolean);
    } catch {
      tailscale.funnelOn = false;
    }
  }
}

// Opens the server to the internet. The first time, Tailscale asks you to allow Funnel in your
// account; it prints a link, which the dashboard shows as a button, and waits until you do.
function funnelOn(port) {
  return new Promise((resolve) => {
    log("system", "Opening the site to the internet with Tailscale Funnel...");
    const p = spawn(tailscale.exe, ["funnel", "--bg", String(port)], { windowsHide: true });
    const onData = (chunk) => {
      const text = chunk.toString();
      log("system", text);
      const url = text.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
      if (url) tailscale.actionUrl = url;
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    const timer = setTimeout(() => p.kill(), 5 * 60_000);
    p.on("close", async (code) => {
      clearTimeout(timer);
      tailscale.actionUrl = null;
      await refreshTailscale();
      if (code === 0) log("system", `The site is online at ${publicUrl()}`);
      else log("error", "Tailscale Funnel didn't turn on. The site only works on this PC for now.");
      resolve();
    });
  });
}

async function funnelOff() {
  if (!tailscale.exe || !tailscale.funnelOn) return;
  await runTailscale(["funnel", "--https=443", "off"]);
  await refreshTailscale();
  log("system", "Tailscale Funnel closed. The site is no longer reachable from the internet.");
}

const publicUrl = () => (tailscale.dnsName && tailscale.funnelOn ? `https://${tailscale.dnsName}` : null);

// ---------- The server ----------

let child = null;
let status = "stopped"; // stopped | building | starting | running | stopping | crashed
let wanted = false; // whether hosting should be on (so a crash restarts it, but Stop doesn't)
let startedAt = null;
let latest = null; // last stats message from the server
let port = 3080;

function build() {
  return new Promise((resolve) => {
    status = "building";
    log("system", "Building the site (takes about 20 seconds)...");
    const p = spawn("npm run build --prefix client", { cwd: root, shell: true, windowsHide: true });
    pipeLines(p.stdout, "info");
    pipeLines(p.stderr, "info");
    p.on("close", (code) => {
      if (code !== 0) log("error", "The build failed. See the lines above.");
      resolve(code === 0);
    });
  });
}

function startServer() {
  const settings = readSettings();
  // Neon's links say sslmode=require, which the database library treats as verify-full anyway
  // but warns about on every start. Saying verify-full keeps the same (strict) security without the warning.
  if (settings.DATABASE_URL) settings.DATABASE_URL = settings.DATABASE_URL.replace(/sslmode=require\b/, "sslmode=verify-full");
  port = Number(settings.PORT) || 3080;
  status = "starting";
  startedAt = Date.now();
  latest = null;
  prevStats = null;
  log("system", `Starting the server on port ${port}...`);

  child = fork(path.join(serverDir, "src", "index.js"), [], {
    cwd: serverDir,
    env: { ...process.env, ...settings, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port) },
    silent: true,
  });
  const thisChild = child;
  pipeLines(child.stdout, "info");
  pipeLines(child.stderr, "error");
  child.stdout.on("data", (chunk) => {
    if (status === "starting" && /Server running/.test(chunk)) {
      status = "running";
      if (!wanted || tailscale.funnelOn) return;
      if (tailscale.exe && tailscale.running) funnelOn(port);
      else {
        log("system", `Tailscale isn't ${tailscale.exe ? "signed in" : "installed"}, so the site only works on this PC for now (http://localhost:${port}).`);
      }
    }
  });
  child.on("message", (msg) => {
    if (msg?.type === "stats") onStats(msg);
    else if (msg?.type === "log") log(msg.level, msg.text);
  });
  child.on("exit", (code, signal) => {
    if (child !== thisChild) return;
    child = null;
    latest = null;
    if (!wanted) {
      status = "stopped";
      log("system", "Server stopped.");
      return;
    }
    const ranFor = Date.now() - startedAt;
    log("error", `The server stopped unexpectedly (${signal || `exit code ${code}`}).`);
    if (ranFor < 15_000) {
      wanted = false;
      status = "crashed";
      log("error", "It stopped right after starting, so it won't restart on its own. Check the errors above, then press Start.");
      funnelOff();
    } else {
      log("system", "Restarting in 3 seconds...");
      setTimeout(() => wanted && !child && startServer(), 3000);
    }
  });
}

function stopChild() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    child.once("exit", () => resolve());
    child.kill();
  });
}

const actions = {
  async start() {
    if (child || status === "building") return;
    // HOST_LOCAL_DB=1 hosts the local test database instead (server/data/app.db), for trying the dashboard out.
    if (!readSettings().DATABASE_URL && process.env.HOST_LOCAL_DB !== "1") {
      log("error", "DATABASE_URL is empty. Press \"Edit settings\", paste your Neon connection string, save, then press Start.");
      return;
    }
    wanted = true;
    await refreshTailscale();
    if (!fs.existsSync(path.join(clientDir, "dist", "index.html")) && !(await build())) {
      wanted = false;
      status = "crashed";
      return;
    }
    if (wanted) startServer();
  },
  async stop() {
    if (!wanted && !child) return;
    wanted = false;
    status = "stopping";
    log("system", "Stopping...");
    await funnelOff();
    await stopChild();
    status = "stopped";
  },
  // Rebuilds the site from the current code, then restarts the server if it was running.
  async rebuild() {
    if (status === "building") return;
    const wasOn = wanted;
    wanted = false;
    await stopChild();
    const ok = await build();
    status = "stopped";
    if (ok) log("system", "Build finished.");
    if (ok && wasOn) {
      wanted = true;
      startServer();
    }
  },
  async settings() {
    spawn(isWindows ? "notepad" : "xdg-open", [settingsFile], { detached: true, stdio: "ignore" }).unref();
  },
};

// ---------- Keep the PC awake while hosting ----------
// Asks Windows not to sleep while the server runs (the screen can still turn off), the same way
// video players do. It's not a settings change: it ends as soon as hosting stops or this window closes.

let awake = null;
function keepAwake(on) {
  if (!isWindows || on === Boolean(awake)) return;
  if (!on) {
    awake.kill();
    awake = null;
    return;
  }
  const ps =
    "Add-Type -Namespace W -Name P -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);';" +
    " [W.P]::SetThreadExecutionState(0x80000001) | Out-Null; while ($true) { Start-Sleep 3600 }"; // ES_CONTINUOUS | ES_SYSTEM_REQUIRED
  awake = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, stdio: "ignore" });
  awake.on("exit", () => (awake = null));
}

// ---------- Usage numbers ----------

const cores = os.cpus().length;
const cpuTimes = () => os.cpus().reduce((a, c) => {
  const t = c.times;
  a.idle += t.idle;
  a.total += t.user + t.nice + t.sys + t.idle + t.irq;
  return a;
}, { idle: 0, total: 0 });

let lastPc = cpuTimes();
let lastSampleAt = Date.now();
let lastSelfCpu = process.cpuUsage();
const history = [];
const now = { pcCpu: 0, pcRamUsed: 0, pcRamTotal: os.totalmem(), serverCpu: 0, serverRam: 0, up: 0, down: 0, selfCpu: 0 };

let usage = { days: {} };
try {
  usage = JSON.parse(fs.readFileSync(usageFile, "utf8"));
} catch {}
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const saveUsage = () => {
  try {
    fs.writeFileSync(usageFile, JSON.stringify(usage));
  } catch {}
};
const session = { in: 0, out: 0 };

// Each stats message from the server: turn its running totals into "per second" numbers.
let prevStats = null;
function onStats(msg) {
  msg.at = Date.now();
  latest = msg;
  const prev = prevStats;
  prevStats = msg;
  now.serverRam = msg.rss;
  if (!prev) return;
  const dt = (msg.at - prev.at) / 1000;
  const dCpu = msg.cpu.user + msg.cpu.system - (prev.cpu.user + prev.cpu.system);
  const dIn = Math.max(0, msg.bytesIn - prev.bytesIn);
  const dOut = Math.max(0, msg.bytesOut - prev.bytesOut);
  now.serverCpu = Math.max(0, (100 * dCpu) / (dt * 1e6 * cores));
  now.down = dIn / dt;
  now.up = dOut / dt;
  const day = (usage.days[today()] ??= { in: 0, out: 0 });
  day.in += dIn;
  day.out += dOut;
  session.in += dIn;
  session.out += dOut;
}

function sample() {
  const t = Date.now();
  const dt = (t - lastSampleAt) / 1000;
  lastSampleAt = t;

  const pc = cpuTimes();
  const total = pc.total - lastPc.total;
  now.pcCpu = total > 0 ? 100 * (1 - (pc.idle - lastPc.idle) / total) : 0;
  lastPc = pc;
  now.pcRamUsed = os.totalmem() - os.freemem();

  const self = process.cpuUsage(lastSelfCpu);
  lastSelfCpu = process.cpuUsage();
  now.selfCpu = (100 * (self.user + self.system)) / (dt * 1e6 * cores);

  keepAwake(Boolean(child && wanted));
  if (!child) {
    prevStats = null;
    Object.assign(now, { serverCpu: 0, serverRam: 0, up: 0, down: 0 });
  }

  history.push({ t, serverCpu: now.serverCpu, serverRam: now.serverRam, up: now.up, down: now.down, pcCpu: now.pcCpu });
  if (history.length > HISTORY_POINTS) history.shift();
}
setInterval(sample, 2000);
setInterval(saveUsage, 60_000);

function usageTotals() {
  const day = usage.days[today()] ?? { in: 0, out: 0 };
  const month = today().slice(0, 7);
  const m = { in: 0, out: 0 };
  for (const [d, v] of Object.entries(usage.days)) {
    if (d.startsWith(month)) {
      m.in += v.in;
      m.out += v.out;
    }
  }
  return { today: day, month: m, session };
}

// Other programs worth watching: Tailscale and the desktop app. Only checked while the dashboard is open.
const desktopName = (() => {
  try {
    return require(path.join(root, "desktop", "package.json")).productName;
  } catch {
    return null;
  }
})();
const watched = [
  { label: "Tailscale", names: ["tailscaled", "tailscale-ipn"] },
  ...(desktopName ? [{ label: "Desktop app", names: [desktopName] }] : []),
];
let processes = [];
let lastProcCpu = {};
let lastProcAt = Date.now();
let dashboardSeenAt = 0;

function sampleProcesses() {
  if (!isWindows || Date.now() - dashboardSeenAt > 15_000) return;
  const names = watched.flatMap((w) => w.names).map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  const cmd = `Get-Process -Name ${names} -ErrorAction SilentlyContinue | Select-Object ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress`;
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { timeout: 8000, windowsHide: true }, (err, stdout) => {
    let rows = [];
    try {
      rows = [].concat(JSON.parse(stdout || "[]"));
    } catch {}
    const t = Date.now();
    const dt = (t - lastProcAt) / 1000;
    const nextCpu = {};
    processes = watched.map((w) => {
      const mine = rows.filter((r) => w.names.some((n) => n.toLowerCase() === String(r.ProcessName).toLowerCase()));
      const ram = mine.reduce((s, r) => s + (r.WorkingSet64 || 0), 0);
      const cpuKnown = mine.some((r) => typeof r.CPU === "number");
      const cpuSec = mine.reduce((s, r) => s + (r.CPU || 0), 0);
      nextCpu[w.label] = cpuSec;
      const prev = lastProcCpu[w.label];
      const cpu = cpuKnown && prev !== undefined && cpuSec >= prev ? (100 * (cpuSec - prev)) / (dt * cores) : null;
      return { label: w.label, running: mine.length > 0, ram, cpu };
    });
    lastProcCpu = nextCpu;
    lastProcAt = t;
  });
}
setInterval(sampleProcesses, 10_000);

setInterval(refreshTailscale, 15_000);
refreshTailscale();

// ---------- Dashboard web page + API ----------

function state() {
  const settings = readSettings();
  return {
    status,
    wanted,
    startedAt: child ? startedAt : null,
    port,
    localUrl: `http://localhost:${port}`,
    keepingAwake: Boolean(awake),
    publicUrl: publicUrl(),
    cores,
    checks: {
      databaseUrl: Boolean(settings.DATABASE_URL),
      googleClientId: Boolean(settings.GOOGLE_CLIENT_ID),
      built: fs.existsSync(path.join(clientDir, "dist", "index.html")),
      tailscaleInstalled: Boolean(tailscale.exe),
      tailscaleRunning: tailscale.running,
      funnelOn: tailscale.funnelOn,
      actionUrl: tailscale.actionUrl,
    },
    now,
    history,
    processes: [
      { label: "Server (the site)", running: Boolean(child), ram: now.serverRam, cpu: child ? now.serverCpu : null },
      ...processes,
      { label: "This dashboard", running: true, ram: process.memoryUsage().rss, cpu: now.selfCpu },
    ],
    usage: usageTotals(),
    online: latest?.online ?? [],
    calls: latest?.calls ?? [],
    connections: latest?.connections ?? 0,
    messagesSent: latest?.messagesSent ?? 0,
    database: latest?.database ?? null,
    logSeq,
  };
}

const allowedHosts = new Set([`localhost:${DASHBOARD_PORT}`, `127.0.0.1:${DASHBOARD_PORT}`]);

const dashboard = http.createServer(async (req, res) => {
  // Blocks other websites from talking to the dashboard through your browser.
  if (!allowedHosts.has(req.headers.host)) return res.writeHead(403).end();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const json = (data) => {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  };

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(fs.readFileSync(path.join(__dirname, "dashboard.html")));
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    dashboardSeenAt = Date.now();
    return json(state());
  }
  if (req.method === "GET" && url.pathname === "/api/logs") {
    const after = Number(url.searchParams.get("after")) || 0;
    return json(logs.filter((l) => l.seq > after));
  }
  const action = req.method === "POST" && url.pathname.match(/^\/api\/(\w+)$/)?.[1];
  if (action && actions[action] && req.headers["x-host-dashboard"] === "1") {
    actions[action]().catch((err) => log("error", err.stack || err.message));
    return json({ ok: true });
  }
  res.writeHead(404).end();
});

function openBrowser(url) {
  const [cmd, args] = isWindows ? ["cmd", ["/c", "start", "", url]] : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

const dashboardUrl = `http://localhost:${DASHBOARD_PORT}`;
dashboard.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`The host dashboard is already running. Opening ${dashboardUrl}`);
    openBrowser(dashboardUrl);
    process.exit(0);
  }
  throw err;
});
dashboard.listen(DASHBOARD_PORT, "127.0.0.1", () => {
  console.log(`Host dashboard: ${dashboardUrl}`);
  console.log("Keep this window open while you're hosting. Closing it stops the site.");
  log("system", "Dashboard ready. Press Start to put the site online.");
  if (!process.env.HOST_NO_BROWSER) openBrowser(dashboardUrl);
});

// Closing the window or pressing Ctrl+C: close the funnel and stop the server so nothing is left running.
let exiting = false;
function shutdown() {
  if (exiting) return;
  exiting = true;
  saveUsage();
  if (tailscale.exe && tailscale.funnelOn) {
    spawnSync(tailscale.exe, ["funnel", "--https=443", "off"], { timeout: 5000, windowsHide: true });
  }
  wanted = false;
  child?.kill();
  awake?.kill();
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(sig, shutdown);
