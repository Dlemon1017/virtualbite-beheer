/**
 * Controle en opschonen van invoer. Eén bestand voor server (Apps Script) en straks de publieke pagina's.
 * Alleen gewone JavaScript, geen Apps Script-services. Getest in Node (test/validatie.test.js).
 */

var EMAIL_PATROON = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normaliseerEmail(email) {
  var s = String(email || '').trim().toLowerCase();
  return EMAIL_PATROON.test(s) ? s : '';
}

/** BSN 11-proef: 9 cijfers, 9×d1 + 8×d2 + … + 2×d8 − 1×d9 deelbaar door 11. */
function bsnGeldig(bsn) {
  var s = String(bsn || '').replace(/\D/g, '');
  if (s.length === 8) s = '0' + s;
  if (!/^\d{9}$/.test(s) || /^0+$/.test(s)) return false;
  var som = 0;
  for (var i = 0; i < 8; i++) som += Number(s[i]) * (9 - i);
  som -= Number(s[8]);
  return som % 11 === 0;
}

/** BSN als 9 cijfers (8 cijfers krijgt een voorloopnul); ongeldig → ''. */
function normaliseerBsn(bsn) {
  if (!bsnGeldig(bsn)) return '';
  var s = String(bsn).replace(/\D/g, '');
  return s.length === 8 ? '0' + s : s;
}

/** "•••••1234": zo gaat een BSN naar de browser (nooit het volledige nummer). */
function maskeerBsn(bsn) {
  var s = String(bsn || '').replace(/\D/g, '');
  return s ? '•••••' + s.slice(-4) : '';
}

/**
 * Vangnet voor tab Log en foutmeldingen: elke reeks van precies 9 cijfers (ook met spaties, punten of streepjes
 * ertussen) wordt "[afgeschermd]". Bewust ruim: ook een 9-cijferige reeks die geen geldig BSN is.
 */
function maskeerBsnInTekst(tekst) {
  return String(tekst == null ? '' : tekst).replace(/(?<!\d)\d(?:[ .-]?\d){8}(?!\d)/g, '[afgeschermd]');
}

/** KvK-nummer: 8 cijfers; ongeldig → ''. */
function normaliseerKvk(kvk) {
  var s = String(kvk || '').replace(/[\s.]/g, '');
  return /^\d{8}$/.test(s) ? s : '';
}

/** Btw-id: NL + 9 cijfers + B + 2 cijfers, bijv. NL123456789B01; spaties en punten mogen. Ongeldig → ''. */
function normaliseerBtwId(btw) {
  var s = String(btw || '').replace(/[\s.-]/g, '').toUpperCase();
  return /^NL\d{9}B\d{2}$/.test(s) ? s : '';
}

/** "1234ab" → "1234 AB"; ongeldig → ''. */
function normaliseerPostcode(pc) {
  var m = /^([1-9]\d{3})\s?([A-Za-z]{2})$/.exec(String(pc || '').trim());
  if (!m) return '';
  var letters = m[2].toUpperCase();
  if (['SA', 'SD', 'SS'].indexOf(letters) !== -1) return '';
  return m[1] + ' ' + letters;
}

/** Telefoonnummer: Nederlands (10 cijfers) of internationaal; geeft opgeschoond nummer of ''. */
function normaliseerTelefoon(tel) {
  var s = String(tel || '').replace(/[\s().-]/g, '');
  if (/^\+\d{9,15}$/.test(s)) return s;
  if (/^00\d{9,15}$/.test(s)) return '+' + s.slice(2);
  if (/^0\d{9}$/.test(s)) return s;
  return '';
}

/** "1130" of "11.30" of "11:30" → "11:30"; ongeldig → ''. */
function normaliseerTijd(t) {
  var m = /^([01]?\d|2[0-3])[:.]?([0-5]\d)$/.exec(String(t || '').trim());
  if (!m) return '';
  return (m[1].length === 1 ? '0' : '') + m[1] + ':' + m[2];
}

/**
 * Tijdvak "11:30 - 14:00", "1130–1400" → "11:30-14:00" (gewoon streepje, zonder spaties). Leeg → ''. Ongeldig → null.
 * Een eindtijd na middernacht mag (bijv. "17:00-01:00").
 */
function normaliseerTijdvak(tekst) {
  var s = String(tekst || '').trim();
  if (!s) return '';
  var delen = s.split(/\s*[-–—]\s*|\s+tot\s+/);
  if (delen.length !== 2) return null;
  var van = normaliseerTijd(delen[0]);
  var tot = normaliseerTijd(delen[1]);
  if (!van || !tot || van === tot) return null;
  return van + '-' + tot;
}

/** Tijden uit de kolom (JSON-tekst of object) → {ma: ['11:30–14:00', ''], ...}. */
function leesTijden(waarde) {
  if (!waarde) return {};
  if (typeof waarde === 'object') return waarde;
  try {
    return JSON.parse(waarde) || {};
  } catch (e) {
    return {};
  }
}

/** "dd-mm-jjjj" of "jjjj-mm-dd" (date-input) → Date; ongeldig → null. */
function leesDatumInvoer(tekst) {
  var s = String(tekst || '').trim();
  var m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  var d, mnd, j;
  if (m) { d = +m[1]; mnd = +m[2]; j = +m[3]; } else {
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    j = +m[1]; mnd = +m[2]; d = +m[3];
  }
  var datum = new Date(j, mnd - 1, d);
  if (datum.getFullYear() !== j || datum.getMonth() !== mnd - 1 || datum.getDate() !== d) return null;
  return datum;
}

/** Date → "dd-mm-jjjj". */
function formatDatum(d) {
  if (!d || typeof d.getTime !== 'function') return '';
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
}

/** Minimale HTML-escaping voor tekst in mails en pagina's. */
function escapeHtml(tekst) {
  return String(tekst == null ? '' : tekst)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
