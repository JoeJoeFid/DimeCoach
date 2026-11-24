// How live video leaves this device, and how its pieces are fetched to be watched.
//
// The pages that show video know nothing of where it is kept. The server says how a broadcast is
// to be sent (`send`) and how a stream is to be watched (`watch`), and what is here does it:
//
//   'server'  each piece goes to, and comes from, the site itself.
//   'links'   the site hands out short-lived links, and each piece goes straight to, and comes
//             straight from, where the video is kept.
//
// A broadcast is always the same three things to the page: start it, stop it, and hear how it
// is getting on. Another way of broadcasting later would be another `Broadcaster`.
import { api, type GameStream } from './api';

/** How a broadcast is getting on: pieces that have gone out, and pieces still waiting to. */
export interface Signal {
  sent: number;
  behind: number;
  /** Set when the broadcast cannot go on: it was ended elsewhere, or has run as long as it may. */
  error?: string;
}
export interface Broadcaster {
  start: () => void;
  /** Stops the camera's recording. Waits for what is still waiting to go out, unless told not to. */
  stop: (wait?: boolean) => Promise<void>;
}
/** How the server said to send a broadcast's pieces. */
export type SendHow = 'server' | 'links';

class Refused extends Error {}
/** Sends piece `n`. Throws `Refused` when the broadcast cannot go on, anything else when it is worth trying again. Returns how many pieces the server now has. */
type Sender = (n: number, piece: Blob) => Promise<number>;

const refusals = /ended|longest|room/;
const toServer = (id: number): Sender => async (n, piece) => {
  try {
    await api.sendSegment(id, piece);
  } catch (e) {
    throw refusals.test((e as Error).message) ? new Refused((e as Error).message) : e;
  }
  return n + 1;
};
const byLinks = (id: number, type: string): Sender => {
  // Links are asked for a few at a time, ahead of the pieces they are for.
  let links = new Map<number, string>();
  return async (n, piece) => {
    if (!links.has(n)) {
      const r = await api.sendLinks(id);
      if (r.status === 400 || r.status === 404) throw new Refused(r.error || 'This broadcast has ended.');
      if (!r.links?.length) throw new Error(r.error || 'No links');
      links = new Map(r.links.map((l) => [l.n, l.url]));
      // The server counts the pieces. Where this device has lost count, it carries on from the server's.
      if (!links.has(n)) n = r.links[0].n;
    }
    const put = await fetch(links.get(n)!, { method: 'PUT', headers: { 'Content-Type': type }, body: piece });
    if (!put.ok) {
      // A link that has run out, or been refused: the next try asks for fresh ones.
      links.clear();
      throw new Error(`The video store answered ${put.status}`);
    }
    const said = await api.sentPiece(id, n);
    if (said.status === 404 || (said.status === 400 && refusals.test(said.error || ''))) throw new Refused(said.error || 'This broadcast has ended.');
    // Too large to keep: this piece is let go and the broadcast carries on.
    if (said.status === 413) return n;
    if (said.status !== 200 || typeof said.segments !== 'number') {
      links.clear();
      throw new Error(said.error || 'Not counted');
    }
    return said.segments;
  };
};

/**
 * Broadcasts a camera a few seconds at a time, each piece a small video file of its own. The
 * camera is asked for afresh for every piece, so it can be turned around between them.
 */
export function pieceBroadcaster(camera: () => MediaStream | null, stream: GameStream, how: SendHow, type: string, onSignal: (s: Signal) => void): Broadcaster {
  const send = how === 'links' ? byLinks(stream.id, type.split(';')[0]) : toServer(stream.id);
  const st = { on: false, queue: [] as Blob[], sending: false, timer: 0, recorder: null as MediaRecorder | null, sent: 0, next: 0 };
  const tell = (error?: string) => onSignal({ sent: st.sent, behind: st.queue.length, error });
  /** Sends what is waiting, oldest first, one at a time. */
  const pump = async () => {
    if (st.sending) return;
    st.sending = true;
    while (st.queue.length > 0) {
      try {
        const now = await send(st.next, st.queue[0]);
        st.queue.shift();
        st.next = now;
        st.sent += 1;
      } catch (e) {
        if (e instanceof Refused) {
          st.on = false;
          st.queue = [];
          tell(e.message);
          break;
        }
        // Anything else is the connection: try again shortly.
        await new Promise((r) => setTimeout(r, 1500));
      }
      // Too far behind means the connection cannot keep up: the oldest pieces are dropped so the viewers stay near live.
      while (st.queue.length > 8) st.queue.shift();
      tell();
    }
    st.sending = false;
  };
  /** Records one piece, and starts the next as this one ends, for as long as the broadcast is on. */
  const record = () => {
    const m = camera();
    if (!st.on || !m) return;
    const rec = new MediaRecorder(m, { mimeType: type, videoBitsPerSecond: 700_000, audioBitsPerSecond: 48_000 });
    st.recorder = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) {
        st.queue.push(e.data);
        tell();
        pump();
      }
    };
    rec.start();
    st.timer = window.setTimeout(() => {
      // The next piece starts before this one stops, so nothing falls between them.
      record();
      if (rec.state !== 'inactive') rec.stop();
    }, stream.segment_seconds * 1000);
  };
  return {
    start: () => {
      st.on = true;
      record();
    },
    stop: async (wait = true) => {
      st.on = false;
      window.clearTimeout(st.timer);
      if (st.recorder && st.recorder.state !== 'inactive') st.recorder.stop();
      if (!wait) return void (st.queue = []);
      // The last piece is given a moment to arrive, and what is waiting a few seconds to go out.
      await new Promise((r) => setTimeout(r, 400));
      for (let i = 0; i < 20 && (st.queue.length > 0 || st.sending); i++) await new Promise((r) => setTimeout(r, 300));
      st.queue = [];
    },
  };
}

/**
 * Fetches a stream's pieces to be played, each whole. Returns null for a piece that cannot be
 * had, which the player steps over.
 */
export function pieceFetcher(stream: GameStream): (n: number) => Promise<Blob | null> {
  if (stream.watch !== 'links') return (n) => fetch(`/api/streams/${stream.id}/segments/${n}`).then((r) => (r.ok ? r.blob() : null));
  // Links are asked for a few at a time, and again once they are near running out.
  const links = new Map<number, { url: string; until: number }>();
  let type = stream.mime.split(';')[0];
  return async (n) => {
    let link = links.get(n);
    if (!link || link.until < Date.now()) {
      const r = await api.watchLinks(stream.id, n);
      type = r.type || type;
      for (const l of r.links) links.set(l.n, { url: l.url, until: Date.now() + (r.good_for - 30) * 1000 });
      link = links.get(n);
      if (!link) return null;
    }
    const res = await fetch(link.url);
    if (!res.ok) {
      links.delete(n);
      return null;
    }
    // The kind of video is the stream's, whatever the store says it is.
    return new Blob([await res.arrayBuffer()], { type });
  };
}
