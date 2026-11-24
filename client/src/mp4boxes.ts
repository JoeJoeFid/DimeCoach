// Cutting an MP4 recording into pieces as it is being made, without stopping the recorder.
//
// A recorder that never stops puts out one long file, a little at a time, and where one lot of
// bytes ends and the next begins means nothing. An MP4 made for this ("fragmented") is a row of
// boxes, each saying its own length:
//
//   ftyp, moov        the opening part: what the video is. Needed before anything else plays.
//   moof, mdat        a fragment: a second or two of picture and sound. Repeats to the end.
//
// A fragment can be played after any other, so the recording can be cut between fragments and
// nowhere else. What is here finds those places. It knows nothing of cameras or networks.

/** One thing found in a recording as it comes in. */
export type Cut =
  | { kind: 'init'; bytes: Uint8Array }
  | { kind: 'fragment'; bytes: Uint8Array }
  /** Not a recording that can be cut: said once, and nothing more comes after it. */
  | { kind: 'unfit'; why: string };

const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const nameAt = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const sizeAt = (b: Uint8Array, at: number) => b[at] * 0x1000000 + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];

/** Whether a box holds a box of this name directly inside it. */
export function holds(box: Uint8Array, name: string): boolean {
  for (let at = 8; at + 8 <= box.length; ) {
    const size = sizeAt(box, at);
    if (nameAt(box, at + 4) === name) return true;
    if (size < 8) return false;
    at += size;
  }
  return false;
}

/**
 * Takes a recording in whatever lumps it arrives and gives back what each lump completed: the
 * opening part once, then each whole fragment.
 */
export function cutter(): (chunk: Uint8Array) => Cut[] {
  let held: Uint8Array = new Uint8Array(0);
  /** Whole boxes not yet handed on: the opening part until it is complete, then the fragment being gathered. */
  let pending: Uint8Array[] = [];
  let opened = false;
  let unfit = false;
  return (chunk) => {
    if (unfit) return [];
    const out: Cut[] = [];
    const stop = (why: string): Cut[] => {
      unfit = true;
      return [...out, { kind: 'unfit', why }];
    };
    held = held.length ? join([held, chunk]) : chunk;
    let at = 0;
    while (held.length - at >= 8) {
      const size = sizeAt(held, at);
      const name = nameAt(held, at + 4);
      // A box that runs "to the end of the file", or one too long to count this way, is not something a recorder still running puts out.
      if (size < 8) return stop(`a ${name} box of no fixed length`);
      // What a box is shows before all of it has come, which matters: the video of a recording that cannot be cut is one box that never ends.
      if (!opened && pending.length === 0 && name !== 'ftyp') return stop('does not start as an MP4');
      if (!opened && (name === 'moof' || name === 'mdat')) return stop('video before its opening part');
      if (held.length - at < size) break;
      const box = held.subarray(at, at + size);
      at += size;
      if (!opened) {
        pending.push(box);
        if (name === 'moov') {
          // Only a recording laid out in fragments says so here. One that is not keeps its index for the very end.
          if (!holds(box, 'mvex')) return stop('not laid out in fragments');
          out.push({ kind: 'init', bytes: join(pending) });
          pending = [];
          opened = true;
        }
        continue;
      }
      // The index some recorders add when they stop is no part of any fragment.
      if (name === 'mfra') continue;
      pending.push(box);
      if (name === 'mdat') {
        out.push({ kind: 'fragment', bytes: join(pending) });
        pending = [];
      }
    }
    held = held.slice(at);
    return out;
  };
}
