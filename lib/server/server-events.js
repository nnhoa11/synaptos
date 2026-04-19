const globalScope = globalThis;
const IO_INSTANCE_KEY = "__synaptosSocketIO";

function setIO(io) {
  globalScope[IO_INSTANCE_KEY] = io ?? null;
}

function getIO() {
  return globalScope[IO_INSTANCE_KEY] ?? null;
}

function emitPriceUpdate(storeId, payload) {
  const ioInstance = getIO();
  if (!ioInstance || !storeId) {
    return;
  }

  ioInstance.to(`store:${storeId}`).emit("price-update", payload);
}

function emitPipelineEvent(storeId, event) {
  const ioInstance = getIO();
  if (!ioInstance || !storeId) {
    return;
  }

  ioInstance.to(`store:${storeId}`).emit("pipeline", event);
}

async function broadcastRoomMeta(io, storeId) {
  if (!io || !storeId) {
    return;
  }

  try {
    const sockets = await io.in(`store:${storeId}`).fetchSockets();
    const meta = { storeId, clientCount: sockets.length, at: Date.now() };
    io.to(`store:${storeId}`).emit("room:meta", meta);
    io.to("admin:all").emit("room:meta", meta);
  } catch {
    // room may not exist yet
  }
}

exports.setIO = setIO;
exports.getIO = getIO;
exports.emitPriceUpdate = emitPriceUpdate;
exports.emitPipelineEvent = emitPipelineEvent;
exports.broadcastRoomMeta = broadcastRoomMeta;
