// Helpers for videos and web links. The attach-and-edit interface lives in Attachments.tsx.
import type { ItemLink } from '../types';

export const MAX_VIDEO_MB = 250;
export const videoUrl = (id: number) => `/api/videos/${id}`;

/** Makes a typed address usable: "youtube.com/..." becomes "https://youtube.com/...". Returns '' if it is not a web address. */
export function normalizeUrl(input: string) {
  const raw = input.trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.') ? url.href : '';
  } catch {
    return '';
  }
}

/** How links and videos appear on a printed sheet: links are written out, videos can only be mentioned. */
export function SheetLinks({ links, videos }: { links: ItemLink[]; videos: number }) {
  if (links.length === 0 && videos === 0) return null;
  return (
    <div className="sheet-links" style={{ margin: '6px 0', fontSize: '9.5pt' }}>
      {links.map((l, i) => (
        <p key={i} style={{ margin: '2px 0', wordBreak: 'break-all' }}>
          <strong>{l.label || 'Link'}:</strong> <a href={l.url}>{l.url}</a>
        </p>
      ))}
      {videos > 0 && (
        <p style={{ margin: '2px 0', color: '#555' }}>
          {videos} video{videos === 1 ? '' : 's'} attached. Watch in PracticePlan.
        </p>
      )}
    </div>
  );
}
