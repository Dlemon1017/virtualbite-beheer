/**
 * Postcodes van het bezorggebied (= exclusief postcodegebied in de overeenkomst; één lijst, leidend).
 * Pure functies, getest in Node (test/postcodes.test.js).
 *
 * Bezorggebied (kolom `bezorggebied`, JSON): lijst groepen met eigen bedragen, bijv.
 *   [{postcodes: '1091-1095, 1097', moa: 12.5, bezorgkosten: 2.75, gratisVanaf: 35}]
 * Standaard één groep met de standaardbedragen; Dimitri kan in de controlestap postcodes met afwijkende bedragen
 * in een eigen groep zetten. Elke groep krijgt in het TB-formulier eigen regel(s).
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

/** Standaard bezorggebied uit de gewenste postcodes van de partner, met de standaardbedragen uit Instellingen. */
function standaardBezorggebied(gewenst, inst) {
  return [{
    postcodes: postcodesTekst(leesPostcodes(gewenst).postcodes),
    moa: leesBedrag(inst.standaard_moa),
    bezorgkosten: leesBedrag(inst.standaard_bezorgkosten),
    gratisVanaf: leesBedrag(inst.standaard_gratis_vanaf)
  }];
}

/**
 * Controleert het bezorggebied. Geeft {postcodes: [alle, gesorteerd], fouten: [meldingen]}.
 * Fout: onbegrijpelijke postcodes, ongeldige bedragen, een postcode in twee groepen, of helemaal geen postcodes.
 */
function controleerBezorggebied(groepen) {
  var fouten = [];
  var waar = {};
  (groepen || []).forEach(function (g, i) {
    var nr = 'Groep ' + (i + 1);
    var r = leesPostcodes(g.postcodes);
    if (r.fouten.length) fouten.push(nr + ': onbekende postcode(s) ' + r.fouten.join(', ') + '.');
    if (!r.postcodes.length) fouten.push(nr + ': geen postcodes.');
    ['moa', 'bezorgkosten', 'gratisVanaf'].forEach(function (k) {
      if (!(leesBedrag(g[k]) >= 0)) fouten.push(nr + ': ongeldig bedrag bij ' + k + '.');
    });
    r.postcodes.forEach(function (pc) {
      if (waar[pc] !== undefined && waar[pc] !== i) fouten.push('Postcode ' + pc + ' staat in groep ' + (waar[pc] + 1) + ' én ' + (i + 1) + '.');
      waar[pc] = i;
    });
  });
  var alle = Object.keys(waar).map(Number).sort(function (a, b) { return a - b; });
  if (!alle.length && !fouten.length) fouten.push('Geen postcodes.');
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
