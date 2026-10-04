/**
 * Herinneringen voor het invullen (fase 3): dag 3 en dag 5 naar de partner, dag 7 de laatste herinnering naar de
 * partner én een melding aan Dimitri. Gerekend vanaf de eerste uitnodiging, in kalenderdagen (Europe/Amsterdam).
 * Pure functies, getest in Node (test/opvolging.test.js).
 */

var DAG_MS = 24 * 3600 * 1000;
var HERINNERING_DAGEN = [3, 5, 7];

/** Begin van de dag (lokale tijd). */
function beginVanDag_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Aantal kalenderdagen van `van` tot `tot` (uitnodiging op maandag 15:00 → donderdag 09:00 = 3). */
function kalenderdagen(van, tot) {
  if (!van || typeof van.getTime !== 'function' || isNaN(van.getTime())) return -1;
  return Math.round((beginVanDag_(tot) - beginVanDag_(van)) / DAG_MS);
}

/** Statussen waarin het formulier nog bij de partner ligt. */
function wachtOpPartner(status) {
  return status === 'Uitgenodigd' || status === 'Deels ingevuld';
}

/**
 * Welke herinnering moet er vandaag (nu) uit? Geeft {stap: 1|2|3, overslaan: [lagere stappen die niet meer hoeven]}
 * of null. Elke stap maar één keer; mist de trigger een dag, dan gaat alleen de hoogste (nooit twee mails op één dag).
 * dagen: [3, 5, 7] (instelbaar).
 */
function herinneringVandaag(p, nu, dagen) {
  var d = dagen || HERINNERING_DAGEN;
  if (!wachtOpPartner(p.status)) return null;
  var verstreken = kalenderdagen(p.uitnodiging_verstuurd_op, nu);
  if (verstreken < 0) return null;
  var stap = 0;
  for (var i = d.length - 1; i >= 0; i--) {
    if (verstreken >= d[i]) { stap = i + 1; break; }
  }
  if (!stap || p['herinnering_formulier_' + stap + '_op']) return null;
  var overslaan = [];
  for (var s = 1; s < stap; s++) if (!p['herinnering_formulier_' + s + '_op']) overslaan.push(s);
  return { stap: stap, overslaan: overslaan };
}

/** Herinneringsdagen uit Instellingen (herinnering_1/2/3_dagen), anders 3, 5, 7. */
function herinneringDagen(inst) {
  return [1, 2, 3].map(function (n, i) {
    var v = Number(inst['herinnering_' + n + '_dagen']);
    return v > 0 ? v : HERINNERING_DAGEN[i];
  });
}

/** "0612345678" → "31612345678" voor wa.me; geen Nederlands mobiel nummer → ''. */
function whatsappNummer(tel) {
  var n = normaliseerTelefoon(tel);
  return /^06\d{8}$/.test(n) ? '31' + n.slice(1) : '';
}
