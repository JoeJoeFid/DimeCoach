import { sportKind } from '../sports';

/** The ball for each sport, drawn as lines. A sport without its own picture gets a pennant. */
// The same drawings are used beside page titles: see the page-title rules in styles.css.
const PATHS = {
  basketball: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 3v18M3 12h18', 'M5.600 5.600c3.400 3.500 3.400 9.300 0 12.800M18.400 5.600c-3.400 3.500-3.400 9.300 0 12.800'],
  baseball: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  football: ['M3.500 20.500C3 14 5 9 8.500 6 12 3 17 3 20.500 3.500 21 10 19 15 15.500 18 12 21 7 21 3.500 20.500Z', 'M9.500 14.500l5-5M10.800 11.200l2 2M12.800 9.200l2 2'],
  volleyball: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 12c.500-3.300-.500-6.300-2.800-8.600M12 12c-3.100 1.200-5.300 3.600-6.100 6.800M12 12c2.600 2.100 5.700 2.800 8.900 1.800', 'M17.600 5c-2.900.400-5.300 1.900-6.900 4.300M3.300 10.400c1.800 2.300 4.300 3.600 7.200 3.800M15.300 20.400c1.100-2.700 1-5.500-.300-8.100'],
  other: ['M6 3v18', 'M6 4.500h12l-3 3.500 3 3.500H6'],
};
/** A baseball's two rows of stitches. */
const STITCHES = 'M6.300 5.100c2.700 4 2.700 9.800 0 13.800M17.700 5.100c-2.700 4-2.700 9.800 0 13.800';

/** Each ball in its own colors: what it is filled with, the line round it, and its seams, laces or panels. */
const COLORS: Record<keyof typeof PATHS | 'softball', { fill: string; edge: string; lines: string }> = {
  basketball: { fill: '#e8792b', edge: '#7a3a10', lines: '#2a1608' },
  baseball: { fill: '#f6f3ea', edge: '#b9b4a6', lines: '#d0312d' },
  softball: { fill: '#dfe94a', edge: '#a3ac2a', lines: '#d0312d' },
  football: { fill: '#8a4b2a', edge: '#4f2912', lines: '#f6f3ea' },
  volleyball: { fill: '#f6f3ea', edge: '#b9b4a6', lines: '#2f5fbf' },
  other: { fill: '#d2f24b', edge: '#8fa82a', lines: '#8fa82a' },
};

export default function SportIcon({ sport, size = 28, colored = false }: { sport: string | undefined; size?: number; /** Drawn in the ball's own colors, not as plain lines in the color of the words around it. */ colored?: boolean }) {
  const kind = sportKind(sport) ?? 'other';
  if (colored) {
    const col = COLORS[kind === 'baseball' && /softball/i.test(sport || '') ? 'softball' : kind];
    const [shape, ...marks] = PATHS[kind];
    return (
      <svg className="sport-icon colored" viewBox="0 0 24 24" width={size} height={size} fill="none" strokeWidth="1.500" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* A pennant is a pole and a flag: the flag is what is filled. */}
        {kind === 'other' ? (
          <>
            <path d={PATHS.other[0]} stroke={col.edge} />
            <path d={PATHS.other[1]} fill={col.fill} stroke={col.edge} />
          </>
        ) : (
          <>
            <path d={shape} fill={col.fill} stroke={col.edge} />
            {marks.map((d) => (
              <path key={d} d={d} stroke={col.lines} />
            ))}
            {kind === 'baseball' && <path d={STITCHES} stroke={col.lines} strokeDasharray="0.900 1.900" />}
          </>
        )}
      </svg>
    );
  }
  return (
    <svg className="sport-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.500" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
      {kind === 'baseball' && <path d={STITCHES} strokeDasharray="0.900 1.900" />}
    </svg>
  );
}
