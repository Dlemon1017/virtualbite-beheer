/**
 * Thick shakes van F'real (21-10-2026): eigen laatste stap "Thick shakes" in het partnerformulier (veld `shakes`,
 * Velden.js; keuzes ja / later / nee). Eén plek voor de getallen en de teksten van die stap; gedeeld met partner- en
 * beheerpagina (geen Apps Script-services; getest in test/shakes.test.js). Afbeeldingen uit de presentatie van F'real
 * (bronnen/freal-blender.jpg en freal-pick/peel/place.jpg, gepubliceerd als freal/…). Nog geen automatische mail naar Interfastfood.
 */

var SHAKES = {
  prijs: 5.95,           // verkoopprijs per shake (incl. 9% btw)
  perDag: 5,             // huidige verkoop: gemiddeld 5 per dag (nergens een plaatsnaam noemen)
  dagenPerMaand: 30,
  huur: 50, huurMinMaanden: 18,
  occasion: 1750, nieuw: 3300, vriezer: 1250,
  proefMaanden: 2, betaalMaanden: 12
};

/** Omzet per maand (incl. btw, zoals de klant betaalt) bij `perDag` shakes; hele euro's. */
function shakesOmzetPerMaand(s) {
  s = s || SHAKES;
  return Math.round(s.prijs * s.perDag * s.dagenPerMaand);
}

/** "€5,95", "€3.300" (notatie zoals het rekenvoorbeeld in "Zo werkt het"). */
function euroKort(x) {
  var heel = Math.round(x * 100) % 100 === 0;
  var t = (heel ? Math.round(x).toString() : x.toFixed(2)).replace('.', ',');
  return '€' + t.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Voor beheer en de melding "heeft getekend". */
function shakesTekst(p) {
  var w = String(p && p.shakes || '').trim().toLowerCase();
  return w === 'ja' ? 'ja (proef)' : w === 'later' ? 'later beslissen – nabellen' :
    w === 'nee' ? 'nee – categorie uitzetten voor deze locatie' : '';
}

var PRESENTATIE_FREAL_URL = 'https://teken.virtualbite.nl/Presentatie_Freal.pdf';

/** Uitleg boven de keuze in de stap "Thick shakes" (HTML, alleen vaste teksten). esc: escape-functie van de pagina. */
function shakesStapHtml(esc) {
  var s = SHAKES;
  var p = function (t, cls) { return '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + t + '</p>'; };
  // Elk onderdeel een eigen blok (.sh-blok) met dezelfde afstand erboven.
  var blok = function (kop, inhoud) {
    return '<div class="sh-blok">' + (kop ? '<div class="sub-label">' + kop + '</div>' : '') + inhoud + '</div>';
  };
  return '<div class="shakes-stap">' +
    '<img class="sh-foto" src="freal/blender.jpg?v=3" alt="Drie thick shakes naast de F\'real-blender" width="1120" height="840">' +
    p('Thick shakes staan standaard op het Chickito Chicken-menu: vanille, aardbei, chocolade en Cookies &amp; Cream met Oreo ' +
      '<span class="sh-label">best verkocht</span>.') +
    p('Ze worden kant-en-klaar en bevroren geleverd door onze partner Interfastfood.') +
    blok('Zo werkt het', '<div class="sh-zo">' + [
      ['pick', 'Pick', 'Pak een beker uit de vriezer'],
      ['peel', 'Peel', 'Haal het dekseltje eraf'],
      ['place', 'Place', 'Zet hem in de blender: binnen 40 seconden klaar']
    ].map(function (x, i) {
      return '<div class="sh-zo-rij"><img src="freal/' + x[0] + '.jpg" alt="' + x[1] + '" width="560" height="280">' +
        '<p><span class="sh-nr">' + (i + 1) + '</span>' + esc(x[2]) + '</p></div>';
    }).join('') + '</div>' +
      '<ul class="sh-punten"><li>De blender is compact en heeft geen wateraansluiting nodig</li>' +
      '<li>Nauwelijks extra handelingen</li><li>De shakes bewaar je in je gewone vriezer</li></ul>') +
    blok('In de praktijk', '<div class="sh-uitgelicht">1 op de 5 klanten van Chickito Chicken bestelt er een shake bij.</div>' +
      p('Gemiddeld ' + s.perDag + ' shakes per dag à ' + esc(euroKort(s.prijs)) + ': dat is ± ' +
        esc(euroKort(shakesOmzetPerMaand(s))) + ' extra omzet per maand.')) +
    blok('Tip', p('De shakes passen ook op je eigen menu. Voeg aan een vanilleshake een siroop of saus naar keuze toe en je ' +
      'maakt zo je eigen smaak, bijvoorbeeld matcha, banaan of Bueno.')) +
    blok('', '<div class="groep sh-voorwaarden"><div class="groep-kop"><span>Speciale voorwaarden voor Chickito Chicken-partners</span></div>' +
      p('Via Interfastfood hebben we aantrekkelijke voorwaarden afgesproken. Je test de blender eerst ' + s.proefMaanden +
        ' maanden gratis. Daarna kies je zelf:') +
      '<ul><li>Nieuwe blender kopen: ' + esc(euroKort(s.nieuw)) + '</li><li>Occasion kopen: ' + esc(euroKort(s.occasion)) + '</li>' +
      '<li>Occasion huren: ' + esc(euroKort(s.huur)) + ' per maand (minimaal ' + s.huurMinMaanden + ' maanden)</li></ul>' +
      p('Bij aanschaf is een betalingsregeling van ' + s.betaalMaanden + ' maanden mogelijk. Na de huurperiode kun je verlengen, ' +
        'stoppen of de blender overnemen. Alle bedragen excl. btw.', 'klein') +
      p('Optioneel: F\'real-vriezer ' + esc(euroKort(s.vriezer)) + ', alleen zinvol bij een zichtlocatie.', 'klein') +
      p('<strong>Geen risico:</strong> wil je na de proefperiode niet verder? Dan geef je de blender kosteloos terug en koopt ' +
        'Virtualbite je resterende voorraad shakes terug.') +
    '</div>') +
    '</div>';
}

/** Onder de keuze: de presentatie van F'real. */
function shakesDownloadHtml(esc) {
  return '<p class="sh-download"><a href="' + esc(PRESENTATIE_FREAL_URL) + '" target="_blank" rel="noopener">' +
    'Download de presentatie van F\'real</a></p>';
}
