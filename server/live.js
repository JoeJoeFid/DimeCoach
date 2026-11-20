// A line held open to each signed-in browser, so it hears at once that something new has
// arrived for that person: a message from the app, a post or a share in one of their communities.
// Only "look again" is sent. The browser then asks for its messages the usual way.
const streams = new Map();

/** Tells these people's open browsers to look for new messages. */
export function poke(userIds) {
  for (const id of new Set([userIds].flat())) for (const res of streams.get(Number(id)) ?? []) res.write('event: news\ndata: {}\n\n');
}

/** Sends these people's open browsers something of another kind, with what it is about: a chat line, someone typing. */
export function tell(userIds, event, data = {}) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const id of new Set([userIds].flat())) for (const res of streams.get(Number(id)) ?? []) res.write(line);
}

// --- Who is using the app right now ---
// When each person last did something: saved, posted, or clicked or typed in an open page.
// Kept in memory only, so it costs nothing to keep and starts again empty when the server does.
const lastDid = new Map();
/** After this long with nothing done, a signed-in person counts as inactive. */
const ACTIVE_MS = 5 * 60_000;
export const markActive = (userId) => lastDid.set(Number(userId), Date.now());
export const isActive = (userId) => Date.now() - (lastDid.get(Number(userId)) ?? 0) < ACTIVE_MS;

export function mountLive(app) {
  app.get('/api/live', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 5000\n\n');
    const id = req.user.id;
    if (!streams.has(id)) streams.set(id, new Set());
    streams.get(id).add(res);
    // A comment line now and then keeps proxies from closing a quiet connection.
    const beat = setInterval(() => res.write(': still here\n\n'), 25000);
    req.on('close', () => {
      clearInterval(beat);
      streams.get(id)?.delete(res);
      if (streams.get(id)?.size === 0) streams.delete(id);
    });
  });
}
