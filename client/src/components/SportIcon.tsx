import { sportKind } from '../sports';

/** The ball for each sport, drawn as lines. A sport without its own picture gets a pennant. */
const PATHS = {
  basketball: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 3v18M3 12h18', 'M5.600 5.600c3.400 3.500 3.400 9.300 0 12.800M18.400 5.600c-3.400 3.500-3.400 9.300 0 12.800'],
  baseball: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  football: ['M3.500 20.500C3 14 5 9 8.500 6 12 3 17 3 20.500 3.500 21 10 19 15 15.500 18 12 21 7 21 3.500 20.500Z', 'M9.500 14.500l5-5M10.800 11.200l2 2M12.800 9.200l2 2'],
  other: ['M6 3v18', 'M6 4.500h12l-3 3.500 3 3.500H6'],
};
/** A baseball's two rows of stitches. */
const STITCHES = 'M6.300 5.100c2.700 4 2.700 9.800 0 13.800M17.700 5.100c-2.700 4-2.700 9.800 0 13.800';

export default function SportIcon({ sport, size = 28 }: { sport: string | undefined; size?: number }) {
  const kind = sportKind(sport) ?? 'other';
  return (
    <svg className="sport-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.500" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
      {kind === 'baseball' && <path d={STITCHES} strokeDasharray="0.900 1.900" />}
    </svg>
  );
}
