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

/**
 * Nederlands telefoonnummer (vast of mobiel) → "0612345678" / "0201234567"; +31 en 0031 worden 0. Anders ''.
 * Geen 0800/0900-nummers en geen buitenlandse nummers.
 */
function normaliseerTelefoon(tel) {
  var s = String(tel || '').replace(/[\s().-]/g, '');
  if (/^\+31/.test(s)) s = '0' + s.slice(3);
  else if (/^0031/.test(s)) s = '0' + s.slice(4);
  if (s.slice(0, 2) === '00') return '';
  if (!/^0[1-9]\d{8}$/.test(s) || /^0(800|900|90[69])/.test(s)) return '';
  return s;
}

/** Huisnummer: 1 tot 5 cijfers, zonder voorloopnul; anders ''. */
function normaliseerHuisnummer(nr) {
  var s = String(nr || '').trim();
  return /^[1-9]\d{0,4}$/.test(s) ? s : '';
}

/** Alleen cijfers (bijv. Thuisbezorgd restaurant-ID), 1 tot 12; anders ''. */
function normaliseerCijfers(t) {
  var s = String(t || '').replace(/\s+/g, '');
  return /^\d{1,12}$/.test(s) ? s : '';
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

/** "11:30" → 690 (minuten na middernacht). */
function minutenVan_(tijd) {
  var m = /^(\d{2}):(\d{2})$/.exec(tijd);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/**
 * Dekken de tijdvakken van een dag het minimum (bijv. "16:30-21:00")? Tijdvakken als "16:30-22:00"; een eindtijd
 * vóór de begintijd loopt door na middernacht. Aaneensluitende of overlappende vakken tellen samen.
 */
function dektMinimum(vakken, minimum) {
  var min = normaliseerTijdvak(minimum);
  if (!min) return false;
  var mv = min.split('-').map(minutenVan_);
  if (mv[1] <= mv[0]) mv[1] += 1440;
  var stukken = (vakken || []).map(normaliseerTijdvak).filter(Boolean).map(function (v) {
    var t = v.split('-').map(minutenVan_);
    if (t[1] <= t[0]) t[1] += 1440;
    return t;
  }).sort(function (a, b) { return a[0] - b[0]; });
  var tot = mv[0];
  for (var i = 0; i < stukken.length && tot < mv[1]; i++) {
    if (stukken[i][0] > tot) break;
    tot = Math.max(tot, stukken[i][1]);
  }
  return tot >= mv[1];
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
