// Small preview pictures for links. The server finds the picture a link offers (a video's own
// thumbnail, or the picture a page publishes for sharing). Here it is shrunk to a few kilobytes
// and sent back to be kept, so only the tiny copy is ever stored.

/** The size thumbnails are kept at. Enough for a card, and only a few kilobytes. */
const WIDTH = 240;
const HEIGHT = 135;
/** Aim for this or less. The server refuses anything over 12 KB. */
const TARGET_BYTES = 8 * 1024;

export const thumbUrl = (link: string) => `/api/resources/thumb?url=${encodeURIComponent(link)}`;

const bytesOf = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

/** Crops to the card's shape, scales down, and squeezes until it is small enough. */
async function shrink(blob: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const scale = Math.max(WIDTH / bitmap.width, HEIGHT / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
  bitmap.close();
  // WebP where the browser can write it, JPEG otherwise.
  const type = canvas.toDataURL('image/webp', 0.5).startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  let out = '';
  for (const quality of [0.5, 0.35, 0.2, 0.1]) {
    out = canvas.toDataURL(type, quality);
    if (bytesOf(out) <= TARGET_BYTES) break;
  }
  return out;
}

async function make(link: string): Promise<string | null> {
  const res = await fetch(`/api/resources/thumb-source?url=${encodeURIComponent(link)}`);
  if (!res.ok) return null;
  const data = await shrink(await res.blob());
  if (!data) return null;
  // Kept for next time. If that fails (no permission to add to this team, say) it is still shown now.
  fetch('/api/resources/thumb', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: link, data }) }).catch(() => {});
  return data;
}

// A few at a time, and each link only once.
const made = new Map<string, Promise<string | null>>();
const waiting: (() => void)[] = [];
let running = 0;
const MAX_AT_ONCE = 3;
const turn = () =>
  new Promise<void>((go) => {
    if (running < MAX_AT_ONCE) {
      running++;
      go();
    } else waiting.push(go);
  });
const done = () => {
  const next = waiting.shift();
  if (next) next();
  else running--;
};

/** Finds, shrinks and keeps a link's thumbnail. Gives the picture as a data address, or null when there is none. */
export function makeThumb(link: string): Promise<string | null> {
  if (!made.has(link))
    made.set(
      link,
      turn()
        .then(() => make(link))
        .catch(() => null)
        .finally(done),
    );
  return made.get(link)!;
}
