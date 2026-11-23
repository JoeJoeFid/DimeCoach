// Helpers for pictures. The attach-and-edit interface lives in Attachments.tsx.

const MAX_EDGE = 1800;
export const imageUrl = (id: number) => `/api/images/${id}`;

/** Shrinks a picture to a sensible size and flattens it onto white, so drawings with transparency print cleanly. */
export async function prepareImage(file: File): Promise<{ data: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`${file.name || 'That file'} is not a picture this browser can open. Use a JPEG or PNG.`);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  return { data: dataUrl.split(',')[1] || '', width: canvas.width, height: canvas.height };
}

const LOGO_EDGE = 160;
/** Shrinks a picture to logo size, keeping any see-through background, and gives it back as a data address. */
export async function prepareLogo(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`${file.name || 'That file'} is not a picture this browser can open. Use a JPEG or PNG.`);
  const scale = Math.min(1, LOGO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // WebP where the browser can write it, which is far smaller. Others give back a PNG by themselves.
  return canvas.toDataURL('image/webp', 0.9);
}
