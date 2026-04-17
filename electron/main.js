const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const isDev = process.env.NODE_ENV !== "production";
const storeId = process.env.STORE_ID || "Q7";
const port = process.env.PORT || "3000";
let serverProcess = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    menuBarVisible: false,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  win.loadURL(`http://localhost:${port}/pos?storeId=${encodeURIComponent(storeId)}`);
}

function launchStandaloneServer() {
  if (serverProcess) {
    return;
  }

  serverProcess = spawn("node", [path.join(process.cwd(), "server.js")], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: port,
    },
  });

  serverProcess.stdout.on("data", (data) => {
    if (data.toString().includes("Ready")) {
      app.whenReady().then(createWindow);
    }
  });

  serverProcess.stderr.on("data", (data) => {
    console.error(`[electron-server] ${data}`);
  });
}

if (isDev) {
  app.whenReady().then(createWindow);
} else {
  app.whenReady().then(launchStandaloneServer);
}

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  app.quit();
});
