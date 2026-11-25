import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Modal } from './bits';

/** How wide and tall the frame is on the screen, and the saved picture. */
const FRAME = 280;
const SAVED = 240;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;

/**
 * Placing a picture before it becomes a team's logo: it is dragged about inside a square frame and
 * made larger or smaller, and what the frame shows is what is saved. At a zoom of 1 the whole
 * picture just fits the frame.
 */
export default function LogoPlacer({ file, onCancel, onSave }: { file: File; onCancel: () => void; /** Given the placed picture as a small data address. */ onSave: (logo: string) => Promise<void> | void }) {
  const [src, setSrc] = useState('');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The picture's size on the screen at a zoom of 1: all of it inside the frame.
  const fit = size ? FRAME / Math.max(size.w, size.h) : 1;
  const shown = size ? { w: size.w * fit * zoom, h: size.h * fit * zoom } : { w: 0, h: 0 };
  /** Keeps some of the picture inside the frame, so it cannot be dragged out of sight. */
  const held = (p: { x: number; y: number }, z = zoom) => {
    if (!size) return p;
    const mx = (size.w * fit * z) / 2 + FRAME / 2 - 24;
    const my = (size.h * fit * z) / 2 + FRAME / 2 - 24;
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  };
  const zoomTo = (z: number) => {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    setZoom(next);
    setAt((p) => held(p, next));
  };
  /** The zoom at which the picture covers the whole frame, with nothing empty at its sides. */
  const fill = size ? Math.max(size.w, size.h) / Math.min(size.w, size.h) : 1;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: at };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setAt(held({ x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y }));
  };
  const up = () => (drag.current = null);

  const save = async () => {
    if (!img.current || !size) return;
    setBusy(true);
    try {
      const k = SAVED / FRAME;
      const canvas = document.createElement('canvas');
      canvas.width = SAVED;
      canvas.height = SAVED;
      // Nothing is painted behind it, so a logo with a clear background keeps it.
      canvas.getContext('2d')!.drawImage(img.current, (FRAME / 2 - shown.w / 2 + at.x) * k, (FRAME / 2 - shown.h / 2 + at.y) * k, shown.w * k, shown.h * k);
      // WebP where the browser can write it, which is far smaller. Others give back a PNG by themselves.
      await onSave(canvas.toDataURL('image/webp', 0.9));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Place the logo" onClose={onCancel}>
      <p className="muted small logo-place-lead">Drag the picture to move it, and use the slider to make it larger or smaller. What is inside the square is what is saved.</p>
      <div
        className="logo-frame"
        style={{ width: FRAME, height: FRAME }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        // The arrow keys move it, for someone not using a mouse or a finger.
        tabIndex={0}
        role="group"
        aria-label="The picture in its frame. Arrow keys move it."
        onKeyDown={(e) => {
          const step = e.shiftKey ? 20 : 5;
          const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
          if (!by) return;
          e.preventDefault();
          setAt((p) => held({ x: p.x + by[0], y: p.y + by[1] }));
        }}
      >
        {src && (
          <img
            ref={img}
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setError(`${file.name || 'That file'} is not a picture this browser can open. Use a JPEG or PNG.`)}
            style={{ width: shown.w, height: shown.h, left: FRAME / 2 - shown.w / 2 + at.x, top: FRAME / 2 - shown.h / 2 + at.y, visibility: size ? 'visible' : 'hidden' }}
          />
        )}
      </div>
      <div className="logo-zoom">
        <span className="field-label">Zoom</span>
        <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom} aria-label="Zoom" onChange={(e) => zoomTo(Number(e.target.value))} />
        <button type="button" className="btn small" onClick={() => (setZoom(1), setAt({ x: 0, y: 0 }))} title="Show the whole picture, in the middle">
          Fit
        </button>
        <button type="button" className="btn small" onClick={() => (setZoom(fill), setAt({ x: 0, y: 0 }))} title="Cover the whole square, in the middle">
          Fill
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={busy || !size} onClick={save}>
          {busy ? 'Saving…' : 'Save logo'}
        </button>
      </div>
    </Modal>
  );
}
