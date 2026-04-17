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

exports.setIO = setIO;
exports.getIO = getIO;
exports.emitPriceUpdate = emitPriceUpdate;
exports.emitPipelineEvent = emitPipelineEvent;
