/**
 * Velden van het partnerformulier: labels, uitleg (ⓘ), keuzes en de controle bij "Versturen" / "Ingevuld".
 * Eén plek voor partnerformulier én "Samen invullen" (beheerpagina). Geen Apps Script-services; getest in Node
 * (test/velden.test.js). Gebruikt Validatie.js en Postcodes.js.
 *
 * Niet in het formulier: startdatum en fee (Dimitri, controlestap), customer-facing e-mail (Dimitri, aanmaken),
 * vaste waarden van het TB-formulier. Bezorging is altijd "Eigen bezorging"; afhalen = er is een afhaaltijd.
 */

var UITLEG = {
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
  koppeling: 'Hoe de bestellingen van Thuisbezorgd bij jou binnenkomen. T-Connect: een apparaat van Thuisbezorgd, ' +
    'vergelijkbaar met een pinautomaat, waarop je de bestellingen ontvangt. Terminal: een apparaat van Thuisbezorgd ' +
    '(€ 250 eenmalig en € 2,50 per week). POS-API: de bestellingen komen rechtstreeks in je kassasysteem. Twijfel je? ' +
    'Kies \'Other\' en vraag het ons.',
  tijden: 'Per dag kun je twee tijdvakken invullen, bijvoorbeeld een middagblok (11:30–14:00) en een avondblok ' +
    '(16:30–21:30). Laat een dag leeg als je dan gesloten bent. Volgens de overeenkomst ben je minimaal vijf dagen per ' +
    'week in ieder geval van 16:30 tot 21:00 open.',
  postcodes_gewenst: 'De postcodes (4 cijfers) waar je wilt bezorgen. Reeksen mogen, bijvoorbeeld "1091–1099". ' +
    'Virtualbite beoordeelt je wens en bevestigt het definitieve gebied; dat wordt je exclusieve gebied in de ' +
    'overeenkomst.'
};
UITLEG.afhaaltijden = UITLEG.tijden;
UITLEG.bezorgtijden = UITLEG.tijden;

var KEUZES = {
  rechtsvorm: [['eenmanszaak', 'Eenmanszaak'], ['vof', 'Vof'], ['bv', 'B.V.'], ['anders', 'Anders']],
  ja_nee: [['ja', 'Ja'], ['nee', 'Nee']],
  koppeling: [['tconnect', 'T-Connect'], ['terminal', 'Terminal'], ['pos_api', 'POS-API'], ['other', 'Other']]
};

/**
 * Formuliervelden per stap. soort: tekst | email | telefoon | kvk | btw | bsn | postcode | keuze | tijden | postcodes.
 * verplicht: true, of een functie (g) => boolean voor velden die alleen soms nodig zijn.
 */
var FORMULIER_STAPPEN = [
  { titel: 'Bedrijf', velden: [
    { veld: 'rechtsvorm', label: 'Rechtsvorm', soort: 'keuze', keuzes: 'rechtsvorm', verplicht: true },
    { veld: 'bedrijfsnaam', label: 'Officiële bedrijfsnaam', soort: 'tekst', verplicht: true },
    { veld: 'vestiging_straat', label: 'Straat en huisnummer (vestigingsadres)', soort: 'tekst', verplicht: true },
    { veld: 'vestiging_postcode', label: 'Postcode', soort: 'postcode', verplicht: true },
    { veld: 'vestiging_plaats', label: 'Vestigingsplaats', soort: 'tekst', verplicht: true },
    { veld: 'kvk', label: 'KvK-nummer', soort: 'kvk', verplicht: true },
    { veld: 'btw_id', label: 'BTW-nummer', soort: 'btw', verplicht: true },
    { veld: 'bsn', label: 'BSN', soort: 'bsn', verplicht: function (g) { return g.rechtsvorm === 'eenmanszaak'; } },
    { veld: 'eu_vestiging', label: 'Vestiging in een ander EU-land?', soort: 'keuze', keuzes: 'ja_nee', verplicht: true },
    { veld: 'eu_land', label: 'Welk EU-land?', soort: 'tekst', verplicht: function (g) { return g.eu_vestiging === 'ja'; } },
    { veld: 'pep', label: 'Ben je een politiek prominent persoon (PEP)?', soort: 'keuze', keuzes: 'ja_nee', verplicht: true }
  ] },
  { titel: 'Contact', velden: [
    { veld: 'eigenaar_naam', label: 'Eigenaar / bestuurder', soort: 'tekst', verplicht: true },
    { veld: 'telefoon_zaak', label: 'Telefoonnummer zaak', soort: 'telefoon', verplicht: true },
    { veld: 'contactpersoon', label: 'Contactpersoon', soort: 'tekst', verplicht: true },
    { veld: 'contactpersoon_mobiel', label: 'Mobiel contactpersoon', soort: 'telefoon', verplicht: true },
    { veld: 'email_facturen', label: 'E-mail voor facturen', soort: 'email', verplicht: true },
    { veld: 'email_communicatie', label: 'E-mail voor communicatie', soort: 'email', verplicht: true }
  ] },
  { titel: 'Locatie', velden: [
    { veld: 'zaak_naam', label: 'Naam van de zaak', soort: 'tekst', verplicht: true },
    { veld: 'locatie_straat', label: 'Straat en huisnummer (locatie)', soort: 'tekst', verplicht: true },
    { veld: 'locatie_postcode', label: 'Postcode', soort: 'postcode', verplicht: true },
    { veld: 'locatie_plaats', label: 'Plaats', soort: 'tekst', verplicht: true },
    { veld: 'locatie_telefoon', label: 'Telefoonnummer locatie', soort: 'telefoon', verplicht: true },
    { veld: 'locatie_contactpersoon', label: 'Contactpersoon locatie', soort: 'tekst', verplicht: true },
    { veld: 'locatie_mobiel', label: 'Mobiel contactpersoon locatie', soort: 'telefoon', verplicht: true }
  ] },
  { titel: 'Bezorgen', velden: [
    { veld: 'koppeling', label: 'Hoe ontvang je de bestellingen? (koppeling)', soort: 'keuze', keuzes: 'koppeling', verplicht: true },
    { veld: 'koppeling_anders', label: 'Toelichting koppeling', soort: 'tekst', verplicht: function (g) { return g.koppeling === 'other'; } },
    { veld: 'bezorgtijden', label: 'Bezorgtijden', soort: 'tijden', verplicht: true },
    { veld: 'afhaaltijden', label: 'Afhaaltijden (leeg laten als klanten niet kunnen afhalen)', soort: 'tijden', verplicht: false },
    { veld: 'postcodes_gewenst', label: 'Gewenst bezorggebied (postcodes)', soort: 'postcodes', verplicht: true },
    { veld: 'externe_merken', label: 'Andere virtuele merken die nu al vanuit de zaak draaien', soort: 'tekst', verplicht: true },
    { veld: 'opmerkingen', label: 'Opmerkingen', soort: 'tekst', verplicht: false }
  ] }
];

var DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

function alleFormulierVelden() {
  return [].concat.apply([], FORMULIER_STAPPEN.map(function (s) { return s.velden; }));
}

/** Tijden (object of JSON) opschonen. Geeft {waarde: {ma: [v1, v2], ...}, fout: ''}. */
function controleerTijden_(invoer) {
  var t = leesTijden(invoer);
  var uit = {};
  var fout = '';
  var iets = false;
  DAGEN.forEach(function (d) {
    uit[d] = [0, 1].map(function (i) {
      var n = normaliseerTijdvak((t[d] || [])[i]);
      if (n === null) fout = 'Vul tijden in als 11:30-14:00 (' + d + ').';
      if (n) iets = true;
      return n || '';
    });
  });
  return { waarde: uit, fout: fout, leeg: !iets };
}

/**
 * Controle bij "Versturen" (partner) en "Ingevuld" (samen). g: ingevulde waarden (veld → tekst).
 * Geeft {ok, waarde: opgeschoonde waarden, fouten: {veld: melding}}.
 */
function valideerPartnerFormulier(g) {
  var fouten = {};
  var w = {};
  alleFormulierVelden().forEach(function (d) {
    var ruw = g[d.veld];
    var tekst = typeof ruw === 'string' ? ruw.replace(/\s+/g, ' ').trim() : ruw;
    var nodig = typeof d.verplicht === 'function' ? d.verplicht(g) : d.verplicht;
    if (typeof d.verplicht === 'function' && !nodig) { // bijv. BSN zonder eenmanszaak: niet bewaren
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
    } else if (!leeg) {
      if (d.soort === 'email') { waarde = normaliseerEmail(tekst); if (!waarde) fout = 'Vul een geldig e-mailadres in.'; }
      if (d.soort === 'telefoon') { waarde = normaliseerTelefoon(tekst); if (!waarde) fout = 'Vul een geldig telefoonnummer in.'; }
      if (d.soort === 'postcode') { waarde = normaliseerPostcode(tekst); if (!waarde) fout = 'Vul een postcode in als 1234 AB.'; }
      if (d.soort === 'kvk') { waarde = normaliseerKvk(tekst); if (!waarde) fout = 'Een KvK-nummer heeft 8 cijfers.'; }
      if (d.soort === 'btw') { waarde = normaliseerBtwId(tekst); if (!waarde) fout = 'Vul het btw-id in als NL123456789B01.'; }
      if (d.soort === 'bsn') { waarde = normaliseerBsn(tekst); if (!waarde) fout = 'Dit BSN klopt niet. Controleer de 9 cijfers.'; }
      if (d.soort === 'keuze') {
        var ok = KEUZES[d.keuzes].some(function (k) { return k[0] === tekst; });
        if (!ok) fout = 'Maak een keuze.';
      }
      if (d.soort === 'postcodes') {
        var pc = leesPostcodes(tekst);
        if (pc.fouten.length) fout = 'Deze postcodes begrijpen we niet: ' + pc.fouten.join(', ') + '.';
        else if (!pc.postcodes.length) fout = 'Vul minimaal één postcode in.';
        else waarde = postcodesTekst(pc.postcodes);
      }
    }
    if (!fout && nodig && leeg) fout = d.soort === 'keuze' ? 'Maak een keuze.' : 'Vul dit veld in.';
    if (fout) fouten[d.veld] = fout;
    w[d.veld] = waarde == null ? '' : waarde;
  });
  return { ok: !Object.keys(fouten).length, waarde: w, fouten: fouten };
}
