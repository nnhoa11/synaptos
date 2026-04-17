const { createServer } = require("http");
const { spawnSync } = require("child_process");
const { existsSync } = require("fs");
const { parse } = require("url");
const path = require("path");
const { loadEnvConfig } = require("@next/env");
const next = require("next");
const { Server } = require("socket.io");
const { setIO } = require("./lib/server/server-events.js");
const { startCampaignScheduler } = require("./lib/server/campaign-scheduler.js");

loadEnvConfig(process.cwd());

const port = Number(process.env.PORT ?? 3000);
const forceNextDev = process.env.SYNAPTOS_USE_NEXT_DEV === "1";
const shouldBuildBeforeStart = process.env.NODE_ENV !== "production" && !forceNextDev;
const buildIdPath = path.join(process.cwd(), ".next", "BUILD_ID");

function ensureBuild() {
  if (!shouldBuildBeforeStart && existsSync(buildIdPath)) {
    return;
  }

  if (existsSync(buildIdPath) && !shouldBuildBeforeStart) {
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

const dev = forceNextDev;

if (!dev) {
  ensureBuild();
}

const app = next({ dev, hostname: "localhost", port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
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
      if (typeof storeId === "string" && storeId) {
        socket.join(`store:${storeId}`);
      }
    });

    setIO(io);
    startCampaignScheduler();

    httpServer.listen(port, () => {
      console.log(`> Ready on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("> Failed to start SynaptOS server", error);
    process.exit(1);
  });
