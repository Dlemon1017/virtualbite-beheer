/**
 * Rooster voor bezorg- en afhaaltijden (gedeeld met de pagina's): open dagen, één openingstijd voor alle dagen,
 * per dag eventueel een afwijkende tijd en (optioneel) een middagblok. Opslag blijft per dag twee tijdvakken
 * ({ma: ['11:30-14:00', '17:00-22:00'], …}, vroegste eerst), zoals het TB-formulier ze vraagt. Pure functies.
 *
 * Rooster: {dagen: {ma: true, …}, alg: {van, tot}, afwijk: {ma: {van, tot}}, middagJa: bool, middag: {ma: {van, tot}}}
 */

/** Minuten sinds 06:00 (01:00 komt na 23:45); geen tijd → -1. */
function dagMinuut(t) {
  var m = /^(\d{2}):(\d{2})$/.exec(t || '');
  return m ? ((Number(m[1]) * 60 + Number(m[2]) - 360) % 1440 + 1440) % 1440 : -1;
}

function vanTot_(vak) {
  var d = String(vak || '').split('-');
  return d.length === 2 ? { van: d[0], tot: d[1] } : { van: '', tot: '' };
}

function vakTekst_(x) {
  return x && x.van && x.tot ? x.van + '-' + x.tot : '';
}

/**
 * Rooster uit opgeslagen tijden. Per dag: het laatst beginnende vak is de openingstijd, het andere het middagblok.
 * De openingstijd die het vaakst voorkomt wordt de algemene; andere dagen wijken af. vast: dagen die altijd open zijn
 * (bezorgtijden: vr, za, zo).
 */
function roosterUitTijden(tijden, vast) {
  var t = leesTijden(tijden);
  var r = { dagen: {}, alg: { van: '', tot: '' }, afwijk: {}, middagJa: false, middag: {} };
  var hoofd = {};
  var tel = {};
  DAGEN.forEach(function (d) {
    var vakken = (t[d] || []).map(normaliseerTijdvak).filter(Boolean);
    r.dagen[d] = vakken.length > 0 || (vast || []).indexOf(d) !== -1;
    if (!vakken.length) return;
    vakken.sort(function (a, b) { return dagMinuut(vanTot_(a).van) - dagMinuut(vanTot_(b).van); });
    hoofd[d] = vakken[vakken.length - 1];
    tel[hoofd[d]] = (tel[hoofd[d]] || 0) + 1;
    if (vakken.length > 1) { r.middagJa = true; r.middag[d] = vanTot_(vakken[0]); }
  });
  var alg = Object.keys(tel).sort(function (a, b) { return tel[b] - tel[a]; })[0] || '';
  r.alg = vanTot_(alg);
  Object.keys(hoofd).forEach(function (d) { if (hoofd[d] !== alg) r.afwijk[d] = vanTot_(hoofd[d]); });
  return r;
}

/** De openingstijd van een dag: afwijkend of de algemene. */
function roosterHoofd(r, d) {
  return r.afwijk[d] || r.alg;
}

/** Opgeslagen vorm: per open dag [vroegste, laatste]; gesloten dagen ['', '']. Halve tijden tellen niet. */
function tijdenUitRooster(r) {
  var uit = {};
  DAGEN.forEach(function (d) {
    if (!r.dagen[d]) { uit[d] = ['', '']; return; }
    var vakken = [vakTekst_(roosterHoofd(r, d)), r.middagJa ? vakTekst_(r.middag[d]) : ''].filter(Boolean);
    vakken.sort(function (a, b) { return dagMinuut(vanTot_(a).van) - dagMinuut(vanTot_(b).van); });
    uit[d] = [vakken[0] || '', vakken[1] || ''];
  });
  return uit;
}

/** Eerste open dag met een half ingevulde tijd (alleen "van" of alleen "tot"), of ''. */
function roosterHalf(r) {
  var half = function (x) { return !!x && !!x.van !== !!x.tot; };
  if (half(r.alg) && DAGEN.some(function (d) { return r.dagen[d] && !r.afwijk[d]; })) return 'alg';
  return DAGEN.filter(function (d) {
    return r.dagen[d] && (half(r.afwijk[d]) || (r.middagJa && half(r.middag[d])));
  })[0] || '';
}

/** Aantal open dagen. */
function roosterAantalDagen(r) {
  return DAGEN.filter(function (d) { return r.dagen[d]; }).length;
}
