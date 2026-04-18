const { createServer } = require("http");
const { spawnSync } = require("child_process");
const { existsSync } = require("fs");
const { parse } = require("url");
const path = require("path");
const { loadEnvConfig } = require("@next/env");
const next = require("next");
const { Server } = require("socket.io");
const { setIO, broadcastRoomMeta } = require("./lib/server/server-events.js");
const { startCampaignScheduler } = require("./lib/server/campaign-scheduler.js");
const { startRealtimeOutboxBridge } = require("./lib/server/realtime-outbox.cjs");

loadEnvConfig(process.cwd());

function logStartup(message) {
  console.log(`[server] ${new Date().toISOString()} ${message}`);
}

const port = Number(process.env.PORT ?? 3000);
const forceNextDev = process.env.SYNAPTOS_USE_NEXT_DEV === "1";
const dev = process.env.NODE_ENV !== "production" || forceNextDev;
const shouldBuildBeforeStart = !dev;
const buildIdPath = path.join(process.cwd(), ".next", "BUILD_ID");

function ensureBuild() {
  if (existsSync(buildIdPath)) {
    return;
  }

  console.log("> Building SynaptOS bundle...");
  const nextBin = require.resolve("next/dist/bin/next");
  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED ?? "1",
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Next build failed with status ${result.status ?? 1}`);
  }
}

if (!dev) {
  ensureBuild();
}

logStartup(`boot dev=${dev} forceNextDev=${forceNextDev} port=${port}`);

const app = next({ dev, hostname: "localhost", port });
const handle = app.getRequestHandler();

logStartup("starting app.prepare()");

const startupWatchdog = setInterval(() => {
  logStartup("still waiting for app.prepare()");
}, 15_000);

app
  .prepare()
  .then(() => {
    clearInterval(startupWatchdog);
    logStartup("app.prepare() resolved");
    const httpServer = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true);
        await handle(req, res, parsedUrl);
      } catch (error) {
        console.error("[server] request failure", error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Internal Server Error");
          return;
        }

        res.end();
      }
    });

    const io = new Server(httpServer, {
      cors: { origin: "*" },
    });

    io.on("connection", (socket) => {
      const storeId = socket.handshake.query.storeId;
      const isAdmin = socket.handshake.query.admin === "1";

      if (isAdmin) {
        socket.join("admin:all");
      }

      if (typeof storeId === "string" && storeId) {
        socket.join(`store:${storeId}`);
        broadcastRoomMeta(io, storeId);
        socket.on("disconnect", () => {
          setTimeout(() => broadcastRoomMeta(io, storeId), 50);
        });
      }
    });

    setIO(io);
    startCampaignScheduler();
    startRealtimeOutboxBridge();

    httpServer.listen(port, () => {
      logStartup(`Ready on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    clearInterval(startupWatchdog);
    console.error("> Failed to start SynaptOS server", error);
    process.exit(1);
  });
