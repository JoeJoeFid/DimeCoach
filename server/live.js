// A line held open to each signed-in browser, so it hears at once that something new has
// arrived for that person: a message from the app, a post or a share in one of their communities.
// Only "look again" is sent. The browser then asks for its messages the usual way.
const streams = new Map();

/** Tells these people's open browsers to look for new messages. */
export function poke(userIds) {
  for (const id of new Set([userIds].flat())) for (const res of streams.get(Number(id)) ?? []) res.write('event: news\ndata: {}\n\n');
}

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
