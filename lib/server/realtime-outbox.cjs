const { Pool } = require("pg");
const { emitPriceUpdate } = require("./server-events.js");

const globalScope = globalThis;
const REALTIME_OUTBOX_SETTINGS_KEY = "realtimeOutbox";
const DEFAULT_POSTGRES_CONFIG = {
  host: "localhost",
  port: "5432",
  database: "synaptos_v2",
  user: "synaptos",
  password: "synaptos",
};

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.POSTGRES_HOST ?? DEFAULT_POSTGRES_CONFIG.host;
  const port = process.env.POSTGRES_PORT ?? DEFAULT_POSTGRES_CONFIG.port;
  const database = process.env.POSTGRES_DB ?? DEFAULT_POSTGRES_CONFIG.database;
  const user = process.env.POSTGRES_USER ?? DEFAULT_POSTGRES_CONFIG.user;
  const password = process.env.POSTGRES_PASSWORD ?? DEFAULT_POSTGRES_CONFIG.password;

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function getPool() {
  if (!globalScope.__synaptosRealtimeOutboxPool) {
    globalScope.__synaptosRealtimeOutboxPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 4,
    });
  }

  return globalScope.__synaptosRealtimeOutboxPool;
}

async function drainRealtimeOutbox(limit = 500) {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT value FROM settings WHERE key = $1 LIMIT 1`, [
      REALTIME_OUTBOX_SETTINGS_KEY,
    ]);
    const currentValue = result.rows[0]?.value ?? { version: 1, events: [] };
    const events = Array.isArray(currentValue?.events) ? currentValue.events : [];
    const drained = events.slice(0, limit);
    const remaining = events.slice(limit);

    if (result.rows.length) {
      await client.query(
        `
          UPDATE settings
          SET value = $2, updated_at = NOW()
          WHERE key = $1
        `,
        [REALTIME_OUTBOX_SETTINGS_KEY, JSON.stringify({ version: 1, events: remaining })]
      );
    } else if (drained.length) {
      await client.query(
        `
          INSERT INTO settings (key, value, updated_at)
          VALUES ($1, $2, NOW())
        `,
        [REALTIME_OUTBOX_SETTINGS_KEY, JSON.stringify({ version: 1, events: [] })]
      );
    }

    await client.query("COMMIT");
    return drained;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function startRealtimeOutboxBridge() {
  if (globalScope.__synaptosRealtimeOutboxInterval) {
    return globalScope.__synaptosRealtimeOutboxInterval;
  }

  globalScope.__synaptosRealtimeOutboxInterval = setInterval(async () => {
    try {
      const events = await drainRealtimeOutbox();
      for (const event of events) {
        if (event?.channel === "price-update" && event.storeId && event.payload) {
          emitPriceUpdate(event.storeId, event.payload);
        }
      }
    } catch (error) {
      console.error("[realtime-outbox]", error);
    }
  }, 500);

  return globalScope.__synaptosRealtimeOutboxInterval;
}

module.exports = {
  drainRealtimeOutbox,
  startRealtimeOutboxBridge,
};
