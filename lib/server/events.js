import { EventEmitter } from "node:events";

const globalScope = globalThis;

if (!globalScope.__synaptosEventBus) {
  globalScope.__synaptosEventBus = new EventEmitter();
  globalScope.__synaptosEventBus.setMaxListeners(100);
}

const eventBus = globalScope.__synaptosEventBus;

export function publishEvent(type, payload = {}) {
  const event = {
    id: crypto.randomUUID(),
    type,
    at: new Date().toISOString(),
    ...payload,
  };

  eventBus.emit("event", event);
  return event;
}

export function subscribeToEvents(listener) {
  eventBus.on("event", listener);
  return () => eventBus.off("event", listener);
}
