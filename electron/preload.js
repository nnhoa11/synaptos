const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("synaptos", {
  storeId: process.env.STORE_ID || "Q7",
});
