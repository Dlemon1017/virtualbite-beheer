/**
 * Postcodes van het bezorggebied (= exclusief postcodegebied in de overeenkomst; één lijst, leidend).
 * Pure functies, getest in Node (test/postcodes.test.js).
 *
 * Bezorggebied (kolom `bezorggebied`, JSON): 5 rijen zoals het TB-formulier, elk met eigen bedragen, bijv.
 *   [{postcodes: '1091-1095, 1097', moa: 12.5, bezorgkosten: 2.75, gratisVanaf: 35}, {postcodes: '', …}, …]
 * De partner vult één veld "Postcodes" in (`postcodes_gewenst`). Bij "Ingevuld" verdeelt de tool die over de rijen
 * (verdeelNaarRijen): tot de grens in rij 1 met de standaardbedragen, daarboven in rij 2 met lege bedragen. Dimitri
 * kan in de controlestap postcodes verplaatsen en alle bedragen aanpassen. Lege rijen tellen niet mee.
 */

var TB_POSTCODEREGELS = 5;
var STREEPJE = '-'; // gewoon streepje, zonder spaties: "1091-1099" (een en-streepje rendert in de TB-PDF met een spatie)

/**
 * Leest vrije invoer: "1091, 1092-1095; 1097 t/m 1099 1100AB". Postcodes met letters tellen als hun 4 cijfers.
 * Geeft {postcodes: [gesorteerd, uniek], fouten: ['onbegrijpelijk stuk', ...]}.
 */
function leesPostcodes(tekst) {
  var s = String(tekst == null ? '' : tekst)
    .replace(/\s*(?:[-–—]|t\/m|tot en met)\s*/gi, '-')
    .replace(/(\d{4})\s+([A-Za-z]{2})(?![A-Za-z])/g, '$1$2');
  var gezien = {};
  var fouten = [];
  s.split(/[\s,;/]+/).filter(Boolean).forEach(function (stuk) {
    var los = /^([1-9]\d{3})(?:[A-Za-z]{2})?$/.exec(stuk);
    var reeks = /^([1-9]\d{3})-([1-9]\d{3})$/.exec(stuk);
    if (los) {
      gezien[los[1]] = true;
    } else if (reeks && Number(reeks[1]) <= Number(reeks[2])) {
      for (var n = Number(reeks[1]); n <= Number(reeks[2]); n++) gezien[n] = true;
    } else {
      fouten.push(stuk);
    }
  });
  return {
    postcodes: Object.keys(gezien).map(Number).sort(function (a, b) { return a - b; }),
    fouten: fouten
  };
}

/** [1091, 1092, 1093, 1097] → ['1091-1093', '1097']. Verwacht een gesorteerde, unieke lijst. */
function naarReeksen(postcodes) {
  var uit = [];
  for (var i = 0; i < postcodes.length; i++) {
    var van = postcodes[i];
    while (i + 1 < postcodes.length && postcodes[i + 1] === postcodes[i] + 1) i++;
    uit.push(van === postcodes[i] ? String(van) : van + STREEPJE + postcodes[i]);
  }
  return uit;
}

/** Nette tekst voor de overeenkomst, het scherm en het TB-formulier: "1091-1093, 1097". */
function postcodesTekst(postcodes) {
  return naarReeksen(postcodes).join(', ');
}

/** Vijf lege rijen met de standaardbedragen uit Instellingen; gewenst (optioneel) komt in rij 1. */
function standaardBezorggebied(gewenst, inst) {
  var rijen = [];
  for (var i = 0; i < TB_POSTCODEREGELS; i++) {
    rijen.push({
      postcodes: i === 0 && gewenst ? postcodesTekst(leesPostcodes(gewenst).postcodes) : '',
      moa: leesBedrag(inst.standaard_moa),
      bezorgkosten: leesBedrag(inst.standaard_bezorgkosten),
      gratisVanaf: leesBedrag(inst.standaard_gratis_vanaf)
    });
  }
  return rijen;
}

/** Altijd precies 5 rijen (ontbrekende aangevuld met de standaard). */
function vijfRijen(rijen, inst) {
  var std = standaardBezorggebied('', inst);
  return std.map(function (s, i) { return Object.assign({}, s, (rijen || [])[i] || {}); });
}

/**
 * Controleert het bezorggebied (rijen; lege rijen tellen niet mee). Geeft {postcodes: [alle, gesorteerd], fouten}.
 * Fout: onbegrijpelijke postcodes, ongeldige bedragen, een postcode in twee rijen, of helemaal geen postcodes.
 */
function controleerBezorggebied(groepen) {
  var fouten = [];
  var waar = {};
  (groepen || []).forEach(function (g, i) {
    var nr = 'Rij ' + (i + 1);
    if (!String(g.postcodes || '').trim()) return;
    var r = leesPostcodes(g.postcodes);
    if (r.fouten.length) fouten.push(nr + ': onbekende postcode(s) ' + r.fouten.join(', ') + '.');
    var bedragen = ['moa', 'bezorgkosten', 'gratisVanaf'].map(function (k) { return leesBedrag(g[k]); });
    if (bedragen.some(function (b) { return !(b >= 0); })) {
      fouten.push(nr + ': vul minimum, bezorgkosten en gratis vanaf in (geldige bedragen).');
    }
    r.postcodes.forEach(function (pc) {
      if (waar[pc] !== undefined && waar[pc] !== i) fouten.push('Postcode ' + pc + ' staat in rij ' + (waar[pc] + 1) + ' én ' + (i + 1) + '.');
      waar[pc] = i;
    });
  });
  var alle = Object.keys(waar).map(Number).sort(function (a, b) { return a - b; });
  if (!alle.length && !fouten.length) fouten.push('Vul minimaal één postcode in.');
  return { postcodes: alle, fouten: fouten };
}

/**
 * Verdeelt het bezorggebied over de regels van het TB-formulier.
 * past(tekst) zegt of een regel in het postcodeveld past (breedte gemeten met het lettertype van het formulier).
 * Per groep worden reeksen achter elkaar gezet ("1091-1095, 1097") zolang het past; elke groep begint op een nieuwe
 * regel met zijn eigen bedragen. Meer regels dan het formulier heeft: de rest gaat als tekst naar other_notes.
 * Geeft {regels: [{postcodes, moa, bezorgkosten, gratisVanaf}], overig: 'tekst of leeg'}.
 */
function verdeelOverRegels(groepen, past, maxRegels) {
  var max = maxRegels || TB_POSTCODEREGELS;
  var alle = [];
  groepen.forEach(function (g) {
    var regel = '';
    naarReeksen(leesPostcodes(g.postcodes).postcodes).forEach(function (reeks) {
      var langer = regel ? regel + ', ' + reeks : reeks;
      if (!regel || past(langer)) {
        regel = langer;
      } else {
        alle.push(regelMet_(g, regel));
        regel = reeks;
      }
    });
    if (regel) alle.push(regelMet_(g, regel));
  });
  var regels = alle.slice(0, max);
  var rest = alle.slice(max);
  // Overige regels per bedragcombinatie samenvoegen tot één zin.
  var perBedrag = [];
  rest.forEach(function (r) {
    var sleutel = bedragenTekst_(r);
    var bestaand = perBedrag.filter(function (b) { return b.sleutel === sleutel; })[0];
    if (bestaand) bestaand.postcodes.push(r.postcodes); else perBedrag.push({ sleutel: sleutel, postcodes: [r.postcodes] });
  });
  return {
    regels: regels,
    overig: perBedrag.map(function (b) {
      return 'Aanvullende postcodes (' + b.sleutel + '): ' + b.postcodes.join(', ');
    }).join('\n')
  };
}

function regelMet_(g, postcodes) {
  return {
    postcodes: postcodes,
    moa: leesBedrag(g.moa),
    bezorgkosten: leesBedrag(g.bezorgkosten),
    gratisVanaf: leesBedrag(g.gratisVanaf)
  };
}

function bedragenTekst_(r) {
  return 'minimum ' + formatBedrag(r.moa, true) + ', bezorgkosten ' + formatBedrag(r.bezorgkosten, true) +
    ', gratis vanaf ' + formatBedrag(r.gratisVanaf, true);
}

/**
 * Rijen markeren die minstens één postcode boven de grens hebben. afstanden: {"8231": {km, schatting}, …}.
 * Geeft per rij {boven: bool, postcodes: [{pc, km, schatting}]} (onbekende afstand: km null, niet boven).
 */
function markeerRijen(rijen, afstanden, grensKm) {
  return (rijen || []).map(function (r) {
    var lijst = leesPostcodes(r.postcodes).postcodes.map(function (pc) {
      var a = (afstanden || {})[pc] || {};
      return { pc: pc, km: typeof a.km === 'number' ? a.km : null, schatting: !!a.schatting };
    });
    return {
      boven: lijst.some(function (x) { return x.km !== null && x.km > grensKm; }),
      postcodes: lijst
    };
  });
}

/** Postcodes (getallen) waarvan de bekende afstand boven de grens ligt. */
function postcodesBovenGrens(postcodes, afstanden, grensKm) {
  return postcodes.filter(function (pc) {
    var a = (afstanden || {})[pc];
    return a && typeof a.km === 'number' && a.km > grensKm;
  });
}

/**
 * Vooraf verdelen bij "Ingevuld": postcodes tot en met de grens (en onbekende afstanden) in rij 1 met de
 * standaardbedragen; postcodes boven de grens in rij 2 met lege bedragen (Dimitri vult ze in vóór "Akkoord").
 */
function verdeelNaarRijen(postcodes, afstanden, grensKm, inst) {
  var ver = postcodesBovenGrens(postcodes, afstanden, grensKm);
  var dichtbij = postcodes.filter(function (pc) { return ver.indexOf(pc) === -1; });
  var rijen = standaardBezorggebied('', inst);
  rijen[0].postcodes = postcodesTekst(dichtbij);
  if (ver.length) rijen[1] = { postcodes: postcodesTekst(ver), moa: null, bezorgkosten: null, gratisVanaf: null };
  return rijen;
}

/** Tekst boven het postcodeveld van de partner. */
function standaardBedragenTekst(inst, grensKm) {
  return 'Standaard (tot ' + String(grensKm).replace('.', ',') + ' km rijden): minimum ' +
    formatBedrag(leesBedrag(inst.standaard_moa), true) + ', bezorgkosten ' + formatBedrag(leesBedrag(inst.standaard_bezorgkosten), true) +
    ', gratis bezorging vanaf ' + formatBedrag(leesBedrag(inst.standaard_gratis_vanaf), true) + '.';
}

function kmTekst_(grensKm) {
  return String(grensKm).replace('.', ',');
}

/** "a, b en c" */
function opsomming_(lijst) {
  return lijst.length < 2 ? String(lijst[0] || '') : lijst.slice(0, -1).join(', ') + ' en ' + lijst[lijst.length - 1];
}

/**
 * Eén korte regel per postcoderegel voor de partner, bijv. "⚠ 8218, 8219 en 8226 liggen meer dan 6 km rijden van je
 * zaak." ('' als er geen postcode boven de grens ligt). Zegt niet hoe de afstand is berekend.
 */
function grensRegel(postcodes, grensKm) {
  if (!postcodes.length) return '';
  return '⚠ ' + opsomming_(postcodes) + (postcodes.length === 1 ? ' ligt' : ' liggen') + ' meer dan ' + kmTekst_(grensKm) +
    ' km rijden van je zaak.';
}

/** Uitleg één keer onder alle postcoderegels (alleen als er minstens één postcode boven de grens ligt). */
function grensUitleg(grensKm) {
  return 'Voor postcodes verder dan ' + kmTekst_(grensKm) + ' km spreken we aangepaste bedragen af, zoals een hoger ' +
    'minimum en hogere bezorgkosten, zodat elke rit de moeite waard is. Geen zorgen: we stemmen samen bedragen af die ' +
    'voor jou goed uitpakken.';
}
