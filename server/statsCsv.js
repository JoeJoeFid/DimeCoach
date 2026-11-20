// Reads a team's stats out of the spreadsheet another scorekeeping app exports: one line for each
// player, with a block of averages and then a block of totals. Only the totals are used.
//
// Shooting is written "made-attempted", as "4-10". A spreadsheet program that has opened the file
// may have turned that into a date ("10-Apr", or "4/10/2026"): the month is then the makes and the
// day the attempts, and it is read back that way.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (word) => MONTHS.indexOf(String(word).slice(0, 3).toLowerCase()) + 1;

/** The cells of a CSV file, row by row. Handles quotes, commas inside them, and either kind of line end. */
function cells(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t' || ch === ';') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/** "4-10" as { made: 4, tried: 10 }, also when a spreadsheet has made a date of it. */
export function madeTried(value) {
  const v = String(value ?? '').trim();
  let m = /^(\d+)\s*[-–\/]\s*(\d+)$/.exec(v);
  if (m) return { made: Number(m[1]), tried: Number(m[2]) };
  // "10-Apr": the day is the attempts and the month the makes.
  m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?$/.exec(v);
  if (m && monthOf(m[2])) return { made: monthOf(m[2]), tried: Number(m[1]) };
  // "Apr-40": more attempts than a month has days, so the spreadsheet took them for a year.
  m = /^([A-Za-z]{3,9})\.?[-\s](\d{1,4})$/.exec(v);
  if (m && monthOf(m[1])) return { made: monthOf(m[1]), tried: Number(m[2]) % 100 };
  // "4/10/2026" or "2026-04-10".
  m = /^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/.exec(v);
  if (m) return { made: Number(m[1]), tried: Number(m[2]) };
  m = /^\d{4}-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return { made: Number(m[1]), tried: Number(m[2]) };
  return { made: 0, tried: 0 };
}
const whole = (v) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0));

/**
 * The players in the file with their totals. Throws, with words for the coach, when the file is
 * not one of these. `games` is how many games the totals cover, which should be one.
 */
export function statsFromCsv(text) {
  const all = cells(text);
  const at = all.findIndex((r) => r.some((c) => /^(number|#|no\.?)$/i.test(c)) && r.some((c) => /^pts$/i.test(c)));
  if (at < 0) throw new Error('This does not look like a stats file. It needs a row of headings with "Number" and "PTS", as the season stats exported from a scorekeeping app have.');
  const head = all[at].map((c) => c.toLowerCase());
  // A heading can come twice, once under the averages and once under the totals. The totals are the later one.
  const col = (...names) => Math.max(...names.map((n) => head.lastIndexOf(n)));
  const c = {
    number: head.findIndex((h) => /^(number|#|no\.?)$/.test(h)), last: head.indexOf('last'), first: head.indexOf('first'), name: col('name', 'player'),
    gp: col('gp'), pts: col('pts'), pf: col('pf'), fg: col('fg'), tp: col('3pt', '3fg', '3p'), ft: col('ft'), to: col('to'), reb: col('reb'), ast: col('ast'), stl: col('stl'), blk: col('blk'),
  };
  if (c.fg < 0 || c.ft < 0) throw new Error('This file has no "FG" and "FT" columns of makes and attempts, so there is nothing to bring in.');
  const rows = [];
  let games = 1;
  for (const r of all.slice(at + 1)) {
    const number = String(r[c.number] ?? '').trim();
    if (/^glossary$/i.test(number) || r.every((x) => !x)) break;
    if (/^totals?$/i.test(number)) {
      games = Math.max(games, whole(r[c.gp]));
      continue;
    }
    const fg = madeTried(r[c.fg]);
    const tp = c.tp >= 0 ? madeTried(r[c.tp]) : { made: 0, tried: 0 };
    const ft = madeTried(r[c.ft]);
    // Makes can never be more than attempts, nor threes more than shots: a line that says so was misread.
    const fga = Math.max(fg.tried, fg.made);
    const tpa = Math.min(Math.max(tp.tried, tp.made), fga);
    const stats = {
      fgm: fg.made, fga, tpm: Math.min(tp.made, fg.made, tpa), tpa, ftm: ft.made, fta: Math.max(ft.tried, ft.made),
      reb: whole(r[c.reb]), ast: whole(r[c.ast]), stl: whole(r[c.stl]), blk: whole(r[c.blk]), to: whole(r[c.to]), pf: whole(r[c.pf]),
    };
    stats.pts = (stats.fgm - stats.tpm) * 2 + stats.tpm * 3 + stats.ftm;
    const unassigned = /^unassigned$/i.test(number);
    // A line with nothing in it (the usual "Unassigned" one) is left out.
    if (Object.values(stats).every((v) => v === 0)) continue;
    const named = c.name >= 0 ? String(r[c.name] ?? '') : '';
    rows.push({
      number: unassigned ? '' : number.replace(/^#/, ''), first: c.first >= 0 ? String(r[c.first] ?? '') : named.split(/\s+/)[0] || '', last: c.last >= 0 ? String(r[c.last] ?? '') : named.split(/\s+/).slice(1).join(' '),
      unassigned, stats,
      // What the file itself says the points are, to show beside what the shots add up to.
      file_pts: c.pts >= 0 ? whole(r[c.pts]) : stats.pts,
    });
    games = Math.max(games, whole(r[c.gp]));
  }
  if (rows.length === 0) throw new Error('No players with stats were found in this file.');
  return { rows, games, team: '' };
}
