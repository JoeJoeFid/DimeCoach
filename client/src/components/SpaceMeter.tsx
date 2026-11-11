const MB = 1024 * 1024;

/** A size for reading: "0 MB", "3.4 MB", "120 MB", "1.5 GB". */
export function fmtSpace(bytes: number) {
  if (bytes >= 1024 * MB) return `${Math.round((bytes / (1024 * MB)) * 10) / 10} GB`;
  if (bytes >= 10 * MB || bytes === 0) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(0.1, Math.round((bytes / MB) * 10) / 10)} MB`;
}

/** Upload space used against its cap: a bar, the two figures, and a word when it is nearly or fully used. */
export function SpaceMeter({ used, cap, files }: { used: number; cap: number; files?: number }) {
  const share = cap > 0 ? Math.min(1, used / cap) : used > 0 ? 1 : 0;
  const state = cap === 0 ? 'off' : used >= cap ? 'full' : share >= 0.85 ? 'near' : '';
  return (
    <span className={`space ${state}`}>
      <span className="space-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Upload space used">
        {used > 0 && <span style={{ width: `${share * 100}%` }} />}
      </span>
      <span className="space-text">
        {cap === 0 ? `${fmtSpace(used)} used` : `${fmtSpace(used)} of ${fmtSpace(cap)}`}
        {files !== undefined && ` · ${files} file${files === 1 ? '' : 's'}`}
        {state === 'off' && <span className="space-flag"> · Uploads off</span>}
        {state === 'full' && <span className="space-flag"> · Full</span>}
        {state === 'near' && <span className="space-flag"> · Nearly full</span>}
      </span>
    </span>
  );
}
