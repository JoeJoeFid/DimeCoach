import test from 'node:test';
import assert from 'node:assert/strict';
import { Unfit, prepareVideo } from './mp4file.ts';

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chars = (s) => [...s].map((c) => c.charCodeAt(0));
const glue = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const box = (name, ...inside) => {
  const body = glue(...inside);
  return glue(be32(8 + body.length), chars(name), body);
};
const full = (name, ...inside) => box(name, [0, 0, 0, 0], ...inside);
const zeros = (n) => new Array(n).fill(0);
const source = (bytes) => ({ size: bytes.length, read: async (at, n) => bytes.slice(at, at + n) });
const u32 = (b, at) => new DataView(b.buffer, b.byteOffset).getUint32(at);
/** Where a box of this name starts in some bytes, looked for by its name alone. */
const at = (b, name, from = 0) => {
  const want = chars(name);
  for (let i = from; i + 4 <= b.length; i++) if (want.every((c, k) => b[i + k] === c)) return i - 4;
  return -1;
};

const picture = box('avc1', zeros(6), [0, 1], zeros(70), box('avcC', [1, 0x64, 0x00, 0x28, 0xff]), box('junk', [1, 2, 3, 4]));
// The sound said the long way a camera says it, with what a player needs tucked a level down.
const esds = full('esds', [3, 25, 0, 1, 0], [4, 17, 0x40, 0x15], zeros(11), [5, 2, 0x12, 0x10], [6, 1, 2]);
const sound = box('mp4a', zeros(6), [0, 1], [0, 1], zeros(6), [0, 2], [0, 16], zeros(4), [0xbb, 0x80, 0, 0], zeros(16), box('wave', esds));
const trak = (id, kind, ticks, entry, tables, edit = []) =>
  box(
    'trak',
    full('tkhd', zeros(8), be32(id), zeros(4), be32(999), zeros(60)),
    ...edit,
    box('mdia', full('mdhd', zeros(8), be32(ticks), be32(999), zeros(4)), full('hdlr', zeros(4), chars(kind), zeros(13)), box('minf', box('stbl', full('stsd', be32(1), entry), ...tables))),
  );

/** A plain video file: twelve one-second frames, every fourth one standing on its own, and sound in half seconds. */
function plainFile() {
  // Frame i is i+1 bytes of the number i. Each bit of sound is two bytes, 100 and up.
  const frames = Array.from({ length: 12 }, (_, i) => new Array(i + 1).fill(i));
  const sounds = Array.from({ length: 24 }, (_, i) => [100 + i, 100 + i]);
  const ftyp = box('ftyp', chars('qt  '), zeros(4));
  // All the picture, then all the sound, each as one run.
  const mdat = box('mdat', ...frames, ...sounds);
  const pictureAt = ftyp.length + 8;
  const soundAt = pictureAt + frames.flat().length;
  const moov = box(
    'moov',
    full('mvhd', zeros(96)),
    trak(1, 'vide', 10, picture, [
      full('stts', be32(1), be32(12), be32(10)),
      full('ctts', be32(1), be32(12), be32(20)),
      full('stss', be32(3), be32(1), be32(5), be32(9)),
      full('stsc', be32(1), be32(1), be32(12), be32(1)),
      full('stsz', be32(0), be32(12), ...frames.map((f) => be32(f.length))),
      full('stco', be32(1), be32(pictureAt)),
    ], [box('edts', full('elst', be32(1), be32(120), be32(20), be32(0x10000)))]),
    trak(2, 'soun', 10, sound, [full('stts', be32(1), be32(24), be32(5)), full('stsc', be32(1), be32(1), be32(24), be32(1)), full('stsz', be32(2), be32(24)), full('stco', be32(1), be32(soundAt))]),
  );
  return glue(ftyp, mdat, moov);
}

test('a plain video becomes an opening part and pieces that begin on whole frames', async () => {
  const v = await prepareVideo(source(plainFile()), 4);
  assert.equal(v.mime, 'video/mp4;codecs="avc1.640028,mp4a.40.2"');
  assert.equal(v.pieces, 3);
  assert.equal(v.seconds, 12);
  // The opening part says pieces follow, keeps what the player needs, and drops what it does not.
  assert.ok(at(v.init, 'mvex') > 0 && at(v.init, 'avcC') > 0 && at(v.init, 'esds') > 0);
  assert.equal(at(v.init, 'junk'), -1);
  assert.equal(at(v.init, 'wave'), -1);
  for (let n = 0; n < 3; n++) {
    const p = await v.piece(n);
    const moof = at(p, 'moof');
    assert.equal(moof, 0);
    assert.equal(at(p, 'mdat'), u32(p, 0));
    // The picture: four frames from this piece's first, said to begin when they did in the file.
    const tfdt = at(p, 'tfdt');
    assert.equal(u32(p, tfdt + 16), n * 40);
    const trun = at(p, 'trun');
    assert.equal(u32(p, trun + 12), 4);
    let data = u32(p, trun + 16);
    for (let i = 0; i < 4; i++) {
      const frame = n * 4 + i;
      const row = trun + 20 + i * 16;
      assert.equal(u32(p, row), 10);
      assert.equal(u32(p, row + 4), frame + 1);
      assert.equal(u32(p, row + 8), i === 0 ? 0x02000000 : 0x01010000);
      // Shown as late as the file said, less where the file said the picture begins.
      assert.equal(u32(p, row + 12), 0);
      assert.deepEqual([...p.subarray(data, data + frame + 1)], new Array(frame + 1).fill(frame));
      data += frame + 1;
    }
    // The sound that goes with it: eight half seconds.
    const second = at(p, 'trun', trun + 8);
    assert.equal(u32(p, second + 12), 8);
    const heard = u32(p, second + 16);
    assert.equal(heard, data);
    assert.deepEqual([...p.subarray(heard, heard + 4)], [100 + n * 8, 100 + n * 8, 101 + n * 8, 101 + n * 8]);
    assert.equal(heard + 16, p.length);
  }
});

test('a video already in pieces is cut where its own pieces begin', async () => {
  const moov = box('moov', full('mvhd', zeros(96)), trak(1, 'vide', 10, picture, []), box('mvex', full('trex', be32(1), zeros(16))));
  const part = (when, fill) => glue(box('moof', full('mfhd', be32(1)), box('traf', full('tfhd', be32(1)), full('tfdt', be32(when)))), box('mdat', new Array(5).fill(fill)));
  const ftyp = box('ftyp', chars('isom'), zeros(4));
  // Ten pieces of a second each, and the index a recorder leaves at the very end.
  const parts = Array.from({ length: 10 }, (_, i) => part(i * 10, i));
  const file = glue(ftyp, moov, ...parts, box('mfra', zeros(8)));
  const v = await prepareVideo(source(file), 4);
  assert.equal(v.mime, 'video/mp4;codecs="avc1.640028"');
  assert.equal(v.pieces, 3);
  assert.deepEqual([...v.init], [...glue(ftyp, moov)]);
  assert.deepEqual([...(await v.piece(0))], [...glue(...parts.slice(0, 4))]);
  assert.deepEqual([...(await v.piece(2))], [...glue(...parts.slice(8))]);
});

test('a file that is not a video, or is only half of one, is refused with a reason', async () => {
  await assert.rejects(prepareVideo(source(Uint8Array.from(chars('this is a text file, not a video'))), 4), Unfit);
  await assert.rejects(prepareVideo(source(glue(box('ftyp', chars('isom'), zeros(4)), box('mdat', zeros(40)))), 4), /incomplete/);
  const other = box('moov', trak(1, 'vide', 10, box('vp09', zeros(78)), [full('stsz', be32(0), be32(0))]));
  await assert.rejects(prepareVideo(source(other), 4), /vp09/);
});
