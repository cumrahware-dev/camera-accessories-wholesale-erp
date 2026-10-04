import { NextRequest } from 'next/server';
import { eventsEmitter, SystemEventPayload } from '@/lib/events-emitter';
import { depotIdFilter, guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;
  const entityId = req.nextUrl.searchParams.get('id');
  // Events carry whole documents. A depot-bound user receives only events that belong to their own depot
  // (and only a trimmed copy); company-wide users receive everything, as before.
  const scopedDepot = depotIdFilter(auth.user);

  const encoder = new TextEncoder();

  let listener: ((event: SystemEventPayload) => void) | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // 1. Send initial connection confirmation
      const initMessage = `data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`;
      controller.enqueue(encoder.encode(initMessage));

      // 2. Define listener
      listener = (event: SystemEventPayload) => {
        try {
          if (scopedDepot && event.data?.depotId !== scopedDepot) return;
          if (!entityId || event.id === entityId || !event.id) {
            const dataStr = `data: ${JSON.stringify(scopedDepot ? { type: event.type, id: event.id, status: event.status, timestamp: event.timestamp } : event)}\n\n`;
            controller.enqueue(encoder.encode(dataStr));
          }
        } catch {
          // Stream might be closed
        }
      };

      eventsEmitter.on('system-event', listener);

      // 3. Heartbeat to keep connection alive across proxies
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }, 15000);
    },
    cancel() {
      if (listener) {
        eventsEmitter.off('system-event', listener);
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
