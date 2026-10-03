/**
 * Velden van het partnerformulier: labels, uitleg (ⓘ), keuzes en de controle bij "Versturen" / "Ingevuld".
 * Eén plek voor partnerformulier én "Samen invullen" (beheerpagina). Geen Apps Script-services; getest in Node
 * (test/velden.test.js). Gebruikt Validatie.js en Postcodes.js.
 *
 * Volgorde = die van het TB-formulier; extra velden (rechtsvorm vóór de bedrijfsnaam, overige onderaan).
 * Niet in het formulier: startdatum en fee (Dimitri, controlestap), customer-facing e-mail (Dimitri, aanmaken),
 * vaste waarden van het TB-formulier. Bezorging is altijd "Eigen bezorging".
 */

var UITLEG = {
  tb_restaurant_id: 'Heb je al een restaurant op Thuisbezorgd? Klik in Partner Hub op je restaurantnaam; daar staat je ' +
    'ID (bijv. 1543994).',
  bedrijfsnaam: 'De naam zoals die bij de KvK staat ingeschreven, inclusief de rechtsvorm. Bijvoorbeeld ' +
    '"Pizzeria Roma Lelystad B.V." of "J. Jansen h.o.d.n. Snackbar De Hoek".',
  zaak_naam: 'De naam die je klanten kennen en die op de gevel staat, bijvoorbeeld "Snackbar De Hoek". Die kan ' +
    'anders zijn dan de officiële bedrijfsnaam.',
  eigenaar_naam: 'Bij een B.V.: de bestuurder zoals die bij de KvK staat. Bij een eenmanszaak of vof: de eigenaar of ' +
    'een van de vennoten. Vul voor- en achternaam in.',
  email_facturen: 'Hier sturen Thuisbezorgd en wij facturen en afrekeningen naartoe, bijvoorbeeld het adres van je ' +
    'boekhouder of administratie.',
  email_communicatie: 'Hier sturen we vragen, updates en praktische informatie naartoe. Kies een adres dat je zelf ' +
    'dagelijks leest. Mag hetzelfde zijn als het factuuradres.',
  kvk: 'Het nummer van 8 cijfers van je inschrijving bij de Kamer van Koophandel. Je vindt het op je KvK-uittreksel, ' +
    'of zoek je bedrijf op kvk.nl.',
  btw_id: 'Je btw-identificatienummer, in de vorm NL123456789B01. Het staat op je facturen en in brieven van de ' +
    'Belastingdienst (of in Mijn Belastingdienst Zakelijk). Heb je een eenmanszaak, gebruik dan het btw-id en niet ' +
    'het omzetbelastingnummer.',
  bsn: 'Alleen nodig bij een eenmanszaak: daar is je BSN je fiscale nummer en Thuisbezorgd vraagt het op hun ' +
    'registratieformulier. We bewaren het afgeschermd en gebruiken het alleen voor dat formulier.',
  eu_vestiging: 'Heeft je bedrijf ook een vestiging of belastingplicht in een ander EU-land, bijvoorbeeld een filiaal ' +
    'in België? Kies dan "Ja" en vul het land in. Voor de meeste zaken is het antwoord "Nee".',
  pep: 'Kies "Ja" als jij een hoge politieke of publieke functie hebt (bijvoorbeeld Kamerlid, minister of rechter bij ' +
    'de Hoge Raad), of als een familielid of naaste zakenpartner van je zo\'n functie heeft. Thuisbezorgd moet dit ' +
    'wettelijk vragen. Voor bijna iedereen is het antwoord "Nee".',
  koppeling: 'Hoe de bestellingen van Thuisbezorgd bij jou binnenkomen. Terminal: een apparaat van Thuisbezorgd ' +
    '(€ 250 eenmalig en € 2,50 per week). POS-API: de bestellingen komen rechtstreeks in je kassasysteem. Twijfel je? ' +
    'Kies \'Other\', dan zoeken we het samen uit.',
  tijden: 'Per dag kun je twee tijdvakken invullen, bijvoorbeeld een middagblok (11:30-14:00) en een avondblok ' +
    '(16:30-21:30). Laat een dag leeg als je dan gesloten bent. Volgens de overeenkomst ben je minimaal vijf dagen per ' +
    'week in ieder geval van 16:30 tot 21:00 open.',
  bezorggebied: 'De postcodes (4 cijfers) waar je wilt bezorgen. Reeksen mogen, bijvoorbeeld "1091-1099". ' +
    'Virtualbite beoordeelt je wens en bevestigt het definitieve gebied; dat wordt je exclusieve gebied in de ' +
    'overeenkomst.'
};
UITLEG.afhaaltijden = UITLEG.tijden;
UITLEG.bezorgtijden = UITLEG.tijden;

/** Minimale openingstijd volgens de overeenkomst (vrijdag, zaterdag, zondag + 2 andere dagen). */
var OPENINGS_MINIMUM = '16:30-21:00';
var VERPLICHTE_DAGEN = ['vr', 'za', 'zo'];
var MIN_OPEN_DAGEN = 5;

var KEUZES = {
  rechtsvorm: [['eenmanszaak', 'Eenmanszaak'], ['vof', 'Vof'], ['bv', 'B.V.'], ['anders', 'Anders']],
  ja_nee: [['ja', 'Ja'], ['nee', 'Nee']],
  koppeling: [['tconnect', 'T-Connect'], ['terminal', 'Terminal'], ['pos_api', 'POS-API'], ['other', 'Other']]
};

function locatieAnders_(g) { return g.locatie_zelfde === 'nee'; }

/**
 * Formuliervelden per stap, in de volgorde van het TB-formulier.
 * soort: tekst | cijfers | email | telefoon | kvk | btw | bsn | postcode | huisnummer | keuze | vinkje | tijden |
 *        bezorgrijen.
 * verplicht: true/false of een functie (g) => boolean. toon: functie (g) => boolean (verborgen = niet bewaren,
 * behalve het locatieadres: dat wordt dan een kopie van het vestigingsadres).
 * kop: tussenkop vóór dit veld. rij: velden met dezelfde rij-naam staan naast elkaar. voorbeeld: grijze tekst.
 */
var FORMULIER_STAPPEN = [
  { titel: 'Bedrijfsgegevens', velden: [
    { veld: 'tb_restaurant_id', label: 'Thuisbezorgd restaurant-ID (als je dat al hebt)', soort: 'cijfers', verplicht: false, voorbeeld: '1543994' },
    { veld: 'rechtsvorm', label: 'Rechtsvorm', soort: 'keuze', keuzes: 'rechtsvorm', verplicht: true },
    { veld: 'bedrijfsnaam', label: 'Officiële bedrijfsnaam', soort: 'tekst', verplicht: true, voorbeeld: 'Pizzeria Roma B.V.' },
    { veld: 'eigenaar_naam', label: 'Eigenaar / bestuurder', soort: 'tekst', verplicht: true, voorbeeld: 'Jan Jansen' },
    { veld: 'telefoon_zaak', label: 'Telefoonnummer zaak', soort: 'telefoon', verplicht: true, voorbeeld: '0201234567' },
    { veld: 'contactpersoon', label: 'Contactpersoon', soort: 'tekst', verplicht: true, voorbeeld: 'Jan Jansen' },
    { veld: 'contactpersoon_mobiel', label: 'Mobiel contactpersoon', soort: 'telefoon', verplicht: true, voorbeeld: '0612345678' },
    { veld: 'vestiging_postcode', label: 'Postcode', soort: 'postcode', verplicht: true, voorbeeld: '1234 AB',
      kop: 'Vestigingsadres (zoals bij de KvK)', rij: 'vestiging-nr' },
    { veld: 'vestiging_huisnummer', label: 'Huisnummer', soort: 'huisnummer', verplicht: true, voorbeeld: '12', rij: 'vestiging-nr' },
    { veld: 'vestiging_toevoeging', label: 'Toevoeging', soort: 'tekst', verplicht: false, voorbeeld: 'a', rij: 'vestiging-nr' },
    { veld: 'vestiging_straat', label: 'Straat', soort: 'tekst', verplicht: true, voorbeeld: 'Wordt automatisch ingevuld' },
    { veld: 'vestiging_plaats', label: 'Plaats', soort: 'tekst', verplicht: true, voorbeeld: 'Wordt automatisch ingevuld' },
    { veld: 'email_facturen', label: 'E-mail voor facturen', soort: 'email', verplicht: true, voorbeeld: 'administratie@pizzeriaroma.nl' },
    { veld: 'email_communicatie', label: 'E-mail voor communicatie', soort: 'email', verplicht: true, voorbeeld: 'info@pizzeriaroma.nl' },
    { veld: 'kvk', label: 'KvK-nummer', soort: 'kvk', verplicht: true, voorbeeld: '12345678' },
    { veld: 'btw_id', label: 'BTW-nummer', soort: 'btw', verplicht: true, voorbeeld: 'NL123456789B01' },
    { veld: 'bsn', label: 'BSN', soort: 'bsn', voorbeeld: '9 cijfers',
      verplicht: function (g) { return g.rechtsvorm === 'eenmanszaak'; },
      toon: function (g) { return g.rechtsvorm === 'eenmanszaak'; } },
    { veld: 'eu_vestiging', label: 'Vestiging in een ander EU-land?', soort: 'keuze', keuzes: 'ja_nee', verplicht: true },
    { veld: 'eu_land', label: 'Welk EU-land?', soort: 'tekst', voorbeeld: 'België',
      verplicht: function (g) { return g.eu_vestiging === 'ja'; }, toon: function (g) { return g.eu_vestiging === 'ja'; } },
    { veld: 'pep', label: 'Ben je een politiek prominent persoon (PEP)?', soort: 'keuze', keuzes: 'ja_nee', verplicht: true }
  ] },
  { titel: 'Locatie', velden: [
    { veld: 'zaak_naam', label: 'Naam van de zaak', soort: 'tekst', verplicht: true, voorbeeld: 'Pizzeria Roma' },
    { veld: 'locatie_zelfde', label: 'Locatieadres is hetzelfde als vestigingsadres', soort: 'vinkje', verplicht: false },
    { veld: 'locatie_postcode', label: 'Postcode', soort: 'postcode', voorbeeld: '1234 AB', kop: 'Locatieadres (waar de keuken is)',
      rij: 'locatie-nr', verplicht: locatieAnders_, toon: locatieAnders_ },
    { veld: 'locatie_huisnummer', label: 'Huisnummer', soort: 'huisnummer', voorbeeld: '12', rij: 'locatie-nr',
      verplicht: locatieAnders_, toon: locatieAnders_ },
    { veld: 'locatie_toevoeging', label: 'Toevoeging', soort: 'tekst', voorbeeld: 'a', rij: 'locatie-nr', verplicht: false,
      toon: locatieAnders_ },
    { veld: 'locatie_straat', label: 'Straat', soort: 'tekst', voorbeeld: 'Wordt automatisch ingevuld',
      verplicht: locatieAnders_, toon: locatieAnders_ },
    { veld: 'locatie_plaats', label: 'Plaats', soort: 'tekst', voorbeeld: 'Wordt automatisch ingevuld',
      verplicht: locatieAnders_, toon: locatieAnders_ },
    { veld: 'locatie_telefoon', label: 'Telefoonnummer locatie', soort: 'telefoon', verplicht: true, voorbeeld: '0201234567' },
    { veld: 'locatie_contactpersoon', label: 'Contactpersoon locatie', soort: 'tekst', verplicht: true, voorbeeld: 'Jan Jansen' },
    { veld: 'locatie_mobiel', label: 'Mobiel contactpersoon locatie', soort: 'telefoon', verplicht: true, voorbeeld: '0612345678' }
  ] },
  { titel: 'Overzicht en services', velden: [
    { veld: 'koppeling', label: 'Hoe ontvang je de bestellingen? (koppeling)', soort: 'keuze', keuzes: 'koppeling', verplicht: true },
    { veld: 'koppeling_anders', label: 'Toelichting koppeling', soort: 'tekst', voorbeeld: 'Bijv. de naam van je kassasysteem',
      verplicht: function (g) { return g.koppeling === 'other'; }, toon: function (g) { return g.koppeling === 'other'; } },
    { veld: 'afhalen', label: 'Kunnen klanten afhalen?', soort: 'keuze', keuzes: 'ja_nee', verplicht: true }
  ] },
  { titel: 'Bezorggebied', velden: [
    { veld: 'bezorggebied', label: 'Postcodes waar je wilt bezorgen', soort: 'bezorgrijen', verplicht: true }
  ] },
  { titel: 'Tijden', velden: [
    { veld: 'bezorgtijden', label: 'Bezorgtijden', soort: 'tijden', verplicht: true },
    { veld: 'afhaaltijden', label: 'Afhaaltijden', soort: 'tijden',
      verplicht: function (g) { return g.afhalen === 'ja'; }, toon: function (g) { return g.afhalen === 'ja'; } }
  ] },
  { titel: 'Overig', velden: [
    { veld: 'externe_merken', label: 'Andere virtuele merken die nu al vanuit de zaak draaien', soort: 'tekst', verplicht: true,
      voorbeeld: 'GEEN' },
    { veld: 'opmerkingen', label: 'Opmerkingen', soort: 'tekst', verplicht: false }
  ] }
];

var DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
var DAG_NAAM = { ma: 'maandag', di: 'dinsdag', wo: 'woensdag', do: 'donderdag', vr: 'vrijdag', za: 'zaterdag', zo: 'zondag' };

function alleFormulierVelden() {
  return [].concat.apply([], FORMULIER_STAPPEN.map(function (s) { return s.velden; }));
}

/** Is dit veld zichtbaar bij deze gegevens? */
function veldZichtbaar(d, g) {
  return typeof d.toon !== 'function' || d.toon(g);
}

/** Locatieadres zoals het geldt: bij "hetzelfde" (of nog niet gekozen) het vestigingsadres. */
function locatieAdres(p) {
  var pre = p.locatie_zelfde === 'nee' ? 'locatie_' : 'vestiging_';
  return {
    postcode: p[pre + 'postcode'] || '', huisnummer: p[pre + 'huisnummer'] || '', toevoeging: p[pre + 'toevoeging'] || '',
    straat: p[pre + 'straat'] || '', plaats: p[pre + 'plaats'] || ''
  };
}

/** Tijden (object of JSON) opschonen. Geeft {waarde: {ma: [v1, v2], ...}, fout: '', open: ['vr', …]}. */
function controleerTijden_(invoer) {
  var t = leesTijden(invoer);
  var uit = {};
  var fout = '';
  var open = [];
  DAGEN.forEach(function (d) {
    uit[d] = [0, 1].map(function (i) {
      var n = normaliseerTijdvak((t[d] || [])[i]);
      if (n === null) fout = 'Vul tijden in als 11:30-14:00 (' + DAG_NAAM[d] + ').';
      return n || '';
    });
    if (uit[d][0] || uit[d][1]) open.push(d);
  });
  return { waarde: uit, fout: fout, leeg: !open.length, open: open };
}

/** Dagen (open) die het minimum niet dekken, bijv. ['ma', 'di']. */
function dagenOnderMinimum(tijden, minimum) {
  var t = controleerTijden_(tijden);
  return t.open.filter(function (d) { return !dektMinimum(t.waarde[d], minimum || OPENINGS_MINIMUM); });
}

/** Regels voor de bezorgtijden: vrijdag, zaterdag en zondag + minimaal 2 andere dagen. '' als het klopt. */
function bezorgdagenFout(open) {
  var mist = VERPLICHTE_DAGEN.filter(function (d) { return open.indexOf(d) === -1; });
  if (mist.length) return 'Vul ook ' + mist.map(function (d) { return DAG_NAAM[d]; }).join(', ') + ' in. Vrijdag, zaterdag ' +
    'en zondag zijn verplicht, plus minimaal 2 andere dagen.';
  if (open.length < MIN_OPEN_DAGEN) return 'Vul minimaal ' + MIN_OPEN_DAGEN + ' dagen in: vrijdag, zaterdag, zondag en ' +
    'minimaal 2 andere dagen.';
  return '';
}

function dagenTekst_(dagen) {
  return dagen.map(function (d) { return DAG_NAAM[d]; }).join(', ');
}

/** Waarschuwing (niet blokkerend) als open dagen het minimum niet dekken. */
function minimumWaarschuwing(onder, minimum) {
  return onder.length ? 'Op ' + dagenTekst_(onder) + ' ben je niet de hele tijd open van ' +
    (minimum || OPENINGS_MINIMUM).replace('-', ' tot ') + '. Volgens de overeenkomst is dat de minimale openingstijd.' : '';
}

/** Controle van één ingevuld (niet leeg) veld. Geeft {waarde, fout}. Gedeeld met de pagina (direct bij typen). */
function controleerVeld(d, tekst) {
  var w = tekst;
  var n = function (f, melding) { w = f(tekst); return w ? '' : melding; };
  var fout = '';
  if (d.soort === 'email') fout = n(normaliseerEmail, 'Vul een geldig e-mailadres in.');
  if (d.soort === 'telefoon') fout = n(normaliseerTelefoon, 'Vul een geldig Nederlands telefoonnummer in, bijv. 0612345678.');
  if (d.soort === 'postcode') fout = n(normaliseerPostcode, 'Vul een postcode in als 1234 AB.');
  if (d.soort === 'huisnummer') fout = n(normaliseerHuisnummer, 'Vul alleen het huisnummer in (cijfers).');
  if (d.soort === 'cijfers') fout = n(normaliseerCijfers, 'Alleen cijfers.');
  if (d.soort === 'kvk') fout = n(normaliseerKvk, 'Een KvK-nummer heeft 8 cijfers.');
  if (d.soort === 'btw') fout = n(normaliseerBtwId, 'Vul het btw-id in als NL123456789B01.');
  if (d.soort === 'bsn') fout = n(normaliseerBsn, 'Dit BSN klopt niet. Controleer de 9 cijfers.');
  if (d.soort === 'keuze' && !KEUZES[d.keuzes].some(function (k) { return k[0] === tekst; })) fout = 'Maak een keuze.';
  if (d.soort === 'vinkje' && ['ja', 'nee'].indexOf(tekst) === -1) fout = 'Ongeldige keuze.';
  return { waarde: fout ? tekst : w, fout: fout };
}

/**
 * Controle bij "Versturen" (partner) en "Ingevuld" (samen). g: ingevulde waarden (veld → tekst).
 * Geeft {ok, waarde: opgeschoonde waarden, fouten: {veld: melding}, waarschuwingen: {veld: melding}}.
 */
function valideerPartnerFormulier(g) {
  var fouten = {};
  var waarschuwingen = {};
  var w = {};
  alleFormulierVelden().forEach(function (d) {
    var ruw = g[d.veld];
    var tekst = typeof ruw === 'string' ? ruw.replace(/\s+/g, ' ').trim() : ruw;
    var nodig = typeof d.verplicht === 'function' ? d.verplicht(g) : d.verplicht;
    if (!veldZichtbaar(d, g)) { // bijv. BSN zonder eenmanszaak: niet bewaren
      w[d.veld] = '';
      return;
    }
    var leeg = tekst == null || tekst === '';
    var waarde = tekst;
    var fout = '';

    if (d.soort === 'tijden') {
      var t = controleerTijden_(ruw);
      waarde = JSON.stringify(t.waarde);
      fout = t.fout;
      leeg = t.leeg;
      if (!fout && !leeg && d.veld === 'bezorgtijden') {
        fout = bezorgdagenFout(t.open);
        var onder = dagenOnderMinimum(t.waarde);
        if (onder.length) waarschuwingen.bezorgtijden = minimumWaarschuwing(onder);
      }
    } else if (d.soort === 'bezorgrijen') {
      var rijen = leesTijden(ruw);
      rijen = Array.isArray(rijen) ? rijen : [];
      var c = controleerBezorggebied(rijen);
      leeg = !c.postcodes.length && !c.fouten.length;
      fout = leeg ? '' : c.fouten.join(' ');
      waarde = JSON.stringify(rijen.map(function (r) {
        var pc = leesPostcodes(r.postcodes);
        return { postcodes: pc.fouten.length ? String(r.postcodes || '') : postcodesTekst(pc.postcodes), moa: leesBedrag(r.moa),
          bezorgkosten: leesBedrag(r.bezorgkosten), gratisVanaf: leesBedrag(r.gratisVanaf) };
      }));
    } else if (!leeg) {
      var v = controleerVeld(d, tekst);
      waarde = v.waarde;
      fout = v.fout;
    }
    if (!fout && nodig && leeg) fout = d.soort === 'keuze' ? 'Maak een keuze.' : 'Vul dit veld in.';
    if (fout) fouten[d.veld] = fout;
    w[d.veld] = waarde == null ? '' : waarde;
  });
  // Locatieadres hetzelfde als vestigingsadres: kopie bewaren (voor het TB-formulier en de afstanden).
  w.locatie_zelfde = g.locatie_zelfde === 'nee' ? 'nee' : 'ja';
  if (w.locatie_zelfde === 'ja') {
    ['postcode', 'huisnummer', 'toevoeging', 'straat', 'plaats'].forEach(function (k) { w['locatie_' + k] = w['vestiging_' + k]; });
  }
  return { ok: !Object.keys(fouten).length, waarde: w, fouten: fouten, waarschuwingen: waarschuwingen };
}
