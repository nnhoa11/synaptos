let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

function getIO() {
  return ioInstance;
}

function emitPriceUpdate(storeId, payload) {
  if (!ioInstance || !storeId) {
    return;
  }

  ioInstance.to(`store:${storeId}`).emit("price-update", payload);
}

function emitPipelineEvent(storeId, event) {
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
