import test from 'node:test';
import assert from 'node:assert/strict';
import { cutter, holds } from './mp4boxes.ts';

/** A box: its length, its name, and what is in it. */
const box = (name, ...inside) => {
  const body = inside.map((x) => (typeof x === 'number' ? new Uint8Array(x).fill(7) : x));
  const size = 8 + body.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i);
  let at = 8;
  for (const b of body) {
    out.set(b, at);
    at += b.length;
  }
  return out;
};
const glue = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const moov = box('moov', box('mvhd', 100), box('trak', 300), box('trak', 200), box('mvex', 40));
const opening = glue(box('ftyp', 28), moov);
const frag = (n) => glue(box('moof', 100 + n), box('mdat', 5000 + n * 10));
const recording = glue(opening, frag(1), frag(2), frag(3));
/** Feeds a recording in lumps of the given sizes and gathers what comes out. */
const feed = (bytes, sizes) => {
  const cut = cutter();
  const out = [];
  for (let at = 0, i = 0; at < bytes.length; i++) {
    const n = sizes[i % sizes.length];
    out.push(...cut(bytes.slice(at, at + n)));
    at += n;
  }
  return out;
};

test('holds: finds a box directly inside another, and not one that is absent', () => {
  assert.equal(holds(moov, 'mvex'), true);
  assert.equal(holds(moov, 'trak'), true);
  assert.equal(holds(moov, 'mfra'), false);
  assert.equal(holds(box('moov', box('mvhd', 100)), 'mvex'), false);
});

test('a recording is cut into its opening part and its fragments, whole', () => {
  const out = feed(recording, [recording.length]);
  assert.deepEqual(out.map((c) => c.kind), ['init', 'fragment', 'fragment', 'fragment']);
  assert.deepEqual(out[0].bytes, opening);
  assert.deepEqual(out[1].bytes, frag(1));
  assert.deepEqual(out[3].bytes, frag(3));
});

test('where the lumps fall makes no difference: a byte at a time, or split inside a box\'s own length', () => {
  for (const sizes of [[1], [3], [7, 1, 900], [5000], [opening.length - 2, 6, 4]]) {
    const out = feed(recording, sizes);
    assert.deepEqual(out.map((c) => c.kind), ['init', 'fragment', 'fragment', 'fragment'], `lumps of ${sizes}`);
    assert.deepEqual(glue(...out.map((c) => c.bytes)), recording, `lumps of ${sizes}`);
  }
});

test('the opening part is handed over as soon as it is whole, before any fragment has come', () => {
  const cut = cutter();
  assert.deepEqual(cut(opening.slice(0, 50)), []);
  const out = cut(opening.slice(50));
  assert.deepEqual(out.map((c) => c.kind), ['init']);
  assert.deepEqual(cut(frag(1).slice(0, 200)), [], 'half a fragment is nothing yet');
});

test('a fragment keeps the small boxes that come with it, and the closing index is left out', () => {
  const extra = glue(opening, box('styp', 16), frag(1), box('prft', 24), frag(2), box('mfra', 60));
  const out = feed(extra, [64]);
  assert.deepEqual(out.map((c) => c.kind), ['init', 'fragment', 'fragment']);
  assert.deepEqual(out[1].bytes, glue(box('styp', 16), frag(1)));
  assert.deepEqual(out[2].bytes, glue(box('prft', 24), frag(2)));
});

test('a recording that cannot be cut is said to be unfit, once, and then nothing', () => {
  // An ordinary MP4: the video first, its index at the end.
  const plain = glue(box('ftyp', 28), box('mdat', 9000), box('moov', box('mvhd', 100), box('trak', 300)));
  const cut = cutter();
  // It is known from the first lump, long before the video box has all arrived.
  assert.deepEqual(cut(plain.slice(0, 5000)).map((c) => c.kind), ['unfit']);
  assert.deepEqual(cut(plain.slice(5000)), []);
  assert.deepEqual(cut(frag(1)), []);
  // An index that says nothing of fragments.
  assert.deepEqual(feed(glue(box('ftyp', 28), box('moov', box('mvhd', 100), box('trak', 300)), frag(1)), [4096]).map((c) => c.kind), ['unfit']);
  // Not an MP4 at all (WebM starts this way).
  assert.deepEqual(feed(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), [16]).map((c) => c.kind), ['unfit']);
  // A box that runs to the end of the file.
  const endless = glue(box('ftyp', 28), new Uint8Array([0, 0, 0, 0, 0x6d, 0x6f, 0x6f, 0x76, 1, 2, 3]));
  assert.deepEqual(feed(endless, [200]).map((c) => c.kind), ['unfit']);
});
