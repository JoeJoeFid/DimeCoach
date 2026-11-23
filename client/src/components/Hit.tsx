// Text with the words searched for marked wherever they are found in it.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default function Hit({ text, terms }: { text: string; /** The words searched for, in small letters. */ terms: string[] }) {
  if (terms.length === 0 || !text) return <>{text}</>;
  // Longer words first, so "pass" does not stop "passing" from being marked whole.
  const re = new RegExp(`(${[...terms].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="hit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
