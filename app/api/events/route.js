import { subscribeToEvents } from "@/lib/server/events";

export const runtime = "nodejs";

export async function GET() {
  const encoder = new TextEncoder();
  let cleanup = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event) => {
        controller.enqueue(
          encoder.encode(`event: ${event.type ?? "message"}\ndata: ${JSON.stringify(event)}\n\n`)
        );
      };

      send({
        id: crypto.randomUUID(),
        type: "session.ready",
        at: new Date().toISOString(),
      });

      const unsubscribe = subscribeToEvents((event) => {
        send(event);
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    },
    cancel() {
      if (cleanup) {
        cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
