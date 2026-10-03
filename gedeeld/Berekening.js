/**
 * Berekeningen en Nederlandse notatie. Pure functies, getest in Node (test/berekening.test.js).
 *
 * Vergoeding Virtualbite = bruto bestelwaarde × fee%, exclusief btw. Alleen aan het eind afronden (op centen).
 */

var VOORBEELD_BRUTO = 10000; // rekenvoorbeeld in "Zo werkt het"

/** Afronden op centen, half naar boven (ook bij kommagetallen als 1,005). */
function rondCenten(x) {
  var n = Number(x);
  if (!isFinite(n)) throw new Error('Geen geldig bedrag.');
  var teken = n < 0 ? -1 : 1;
  return teken * Math.round(Number((Math.abs(n) * 100).toFixed(6))) / 100;
}

/** "1.234,56", "1234,56", "€ 35", 12.5 → getal; ongeldig → NaN. */
function leesBedrag(waarde) {
  if (typeof waarde === 'number') return waarde;
  var s = String(waarde == null ? '' : waarde).replace(/[€\s]/g, '');
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s)) return NaN;
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

/** "9", "9%", "9,5 %", 9.5 → getal (0 < p < 100); ongeldig → NaN. */
function leesPercentage(waarde) {
  var n = typeof waarde === 'number' ? waarde :
    /^\d+(,\d+)?$/.test(String(waarde == null ? '' : waarde).replace(/[%\s]/g, ''))
      ? Number(String(waarde).replace(/[%\s]/g, '').replace(',', '.')) : NaN;
  return n > 0 && n < 100 ? n : NaN;
}

/**
 * Vergoeding over een bruto bestelwaarde. Geeft {bruto, feePercentage, vergoeding}; vergoeding is exclusief btw
 * en pas aan het eind op centen afgerond.
 */
function berekenVergoeding(bruto, feePercentage) {
  var b = leesBedrag(bruto);
  var p = leesPercentage(feePercentage);
  if (!(b >= 0)) throw new Error('Ongeldige bruto bestelwaarde.');
  if (isNaN(p)) throw new Error('Ongeldig fee-percentage.');
  return { bruto: b, feePercentage: p, vergoeding: rondCenten(b * p / 100) };
}

/** 1234.5 → "1.234,50"; kort = true laat ",00" weg bij hele bedragen ("35"). */
function formatGetal(x, kort) {
  var c = rondCenten(x);
  var heel = Math.floor(Math.abs(c));
  var centen = Math.round((Math.abs(c) - heel) * 100);
  var tekst = String(heel).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (!(kort && centen === 0)) tekst += ',' + (centen < 10 ? '0' : '') + centen;
  return (c < 0 ? '-' : '') + tekst;
}

/** 1234.56 → "€ 1.234,56". */
function formatBedrag(x, kort) {
  return '€ ' + formatGetal(x, kort);
}

/** 9 → "9%", 9.5 → "9,5%". */
function formatPercentage(p) {
  var n = leesPercentage(p);
  if (isNaN(n)) throw new Error('Ongeldig fee-percentage.');
  return String(Number(n.toFixed(4))).replace('.', ',') + '%';
}

/**
 * Rekenvoorbeeld voor "Zo werkt het": € 10.000 bruto → vergoeding volgens de fee van de partner.
 * Tekst: "€ 10.000 bruto bestelwaarde → € 900 vergoeding, exclusief btw."
 */
function rekenvoorbeeld(feePercentage) {
  var r = berekenVergoeding(VOORBEELD_BRUTO, feePercentage);
  return {
    bruto: r.bruto,
    feePercentage: r.feePercentage,
    vergoeding: r.vergoeding,
    tekst: formatBedrag(r.bruto, true) + ' bruto bestelwaarde → ' + formatBedrag(r.vergoeding, true) +
      ' vergoeding, exclusief btw.'
  };
}
