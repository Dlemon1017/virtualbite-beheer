/**
 * Thick shakes van F'real (21-10-2026): vraag in het partnerformulier (veld `shakes`, Velden.js) met een infovenster.
 * Eén plek voor de getallen, het rekenvoorbeeld en de teksten; gedeeld met partner- en beheerpagina (geen Apps
 * Script-services; getest in test/shakes.test.js). Nog geen automatische mail naar Interfastfood.
 */

var SHAKES = {
  prijs: 5.95,           // verkoopprijs per shake (incl. 9% btw)
  btw: 0.09,
  inkoop: 2.25,          // per shake: doos van 12 voor € 27
  doosPrijs: 27, doosAantal: 12,
  tbCommissie: 0.14,     // commissie Thuisbezorgd (over de verkoopprijs)
  vbFee: 0.09,           // vergoeding Virtualbite
  perDag: 5,             // Chickito Lelystad: gemiddeld 5 per dag
  dagenPerMaand: 30,
  huur: 50, huurMinMaanden: 18,
  occasion: 1750, nieuw: 3300, vriezer: 1250,
  proefMaanden: 2
};

/** Wat je per shake overhoudt (excl. btw): verkoopprijs excl. btw − inkoop − commissie − vergoeding. */
function shakeMarge(s) {
  s = s || SHAKES;
  return Math.round((s.prijs / (1 + s.btw) - s.inkoop - s.prijs * s.tbCommissie - s.prijs * s.vbFee) * 100) / 100;
}

/** Extra per maand bij `perDag` shakes (afgerond op hele euro's). */
function shakesPerMaand(s) {
  s = s || SHAKES;
  return Math.round(shakeMarge(s) * s.perDag * s.dagenPerMaand);
}

/** Terugverdientijd van een aanschaf in maanden, afgerond op een halve maand. */
function shakesTerugverdien(bedrag, s) {
  return Math.round(bedrag / shakesPerMaand(s) * 2) / 2;
}

/** "6½", "12" */
function halveMaandTekst(m) {
  var heel = Math.floor(m);
  return m - heel ? heel + '½' : String(heel);
}

/** "€1,84", "€3.300" (notatie zoals het rekenvoorbeeld in "Zo werkt het"). */
function euroKort(x) {
  var heel = Math.round(x * 100) % 100 === 0;
  var t = (heel ? Math.round(x).toString() : x.toFixed(2)).replace('.', ',');
  return '€' + t.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Voor beheer en de melding "heeft getekend": "ja (proef)" / "nee – categorie uitzetten voor deze locatie" / "". */
function shakesTekst(p) {
  var w = String(p && p.shakes || '').trim().toLowerCase();
  return w === 'ja' ? 'ja (proef)' : w === 'nee' ? 'nee – categorie uitzetten voor deze locatie' : '';
}

/**
 * Inhoud van het infovenster (HTML, alleen vaste teksten). esc: escape-functie van de pagina; pdfUrl: de presentatie.
 */
function shakesInfoHtml(esc, pdfUrl) {
  var s = SHAKES;
  var marge = shakeMarge(s);
  var maand = shakesPerMaand(s);
  var sectie = function (titel, inhoud) { return '<section class="sh-sectie"><h3>' + esc(titel) + '</h3>' + inhoud + '</section>'; };
  var p = function (t) { return '<p>' + t + '</p>'; };
  return '<p class="sh-uitgelicht">Bij Chickito Lelystad zit in 1 op de 5 bestellingen een shake. Ze verkopen beter dan ' +
    'drankjes, desserts en sausjes bij elkaar: gemiddeld ' + s.perDag + ' per dag.</p>' +
    sectie('Hoe het werkt', p('Bevroren beker uit de vriezer, in de compacte blender en binnen 40 seconden klaar. Geen ' +
      'wateraansluiting nodig.')) +
    sectie('Smaken', '<ul><li>Vanille</li><li>Aardbei</li><li>Chocolade</li><li>Cookies &amp; Cream met Oreo ' +
      '<span class="sh-label">best verkocht</span></li></ul>') +
    sectie('Wat het oplevert',
      p('<strong>Rekenvoorbeeld per shake:</strong> ' + esc(euroKort(s.prijs)) + ' verkoopprijs → ± ' + esc(euroKort(marge)) +
        ' voor jou, exclusief btw.') +
      '<p class="sh-klein">Na inkoop (' + esc(euroKort(s.inkoop)) + ' per shake, doos van ' + s.doosAantal + ' voor ' +
        esc(euroKort(s.doosPrijs)) + '), commissie Thuisbezorgd (' + Math.round(s.tbCommissie * 100) + '%) en vergoeding ' +
        'Virtualbite (' + Math.round(s.vbFee * 100) + '%).</p>' +
      p('<strong>Rekenvoorbeeld per maand:</strong> ' + s.perDag + ' shakes per dag → ± ' + esc(euroKort(maand)) + ' extra. ' +
        'Met huur (' + esc(euroKort(s.huur)) + '/mnd) ± ' + esc(euroKort(maand - s.huur)) + ' netto.') +
      p('Een occasion (' + esc(euroKort(s.occasion)) + ') verdien je terug in ± ' + halveMaandTekst(shakesTerugverdien(s.occasion, s)) +
        ' maanden, een nieuwe blender (' + esc(euroKort(s.nieuw)) + ') in ± ' + halveMaandTekst(shakesTerugverdien(s.nieuw, s)) +
        ' maanden.') +
      '<p class="sh-klein">Indicatie op basis van Chickito Lelystad; je eigen verkoop kan afwijken.</p>') +
    sectie('Proefperiode', p('Je test de blender ' + s.proefMaanden + ' maanden gratis.')) +
    sectie('Daarna kies je (excl. btw)', '<ul>' +
      '<li>Nieuwe blender kopen: ' + esc(euroKort(s.nieuw)) + '</li>' +
      '<li>Occasion kopen: ' + esc(euroKort(s.occasion)) + '</li>' +
      '<li>Occasion huren: ' + esc(euroKort(s.huur)) + ' per maand (minimaal ' + s.huurMinMaanden + ' maanden)</li></ul>' +
      '<p class="sh-klein">Bij aanschaf is een betalingsregeling van 12 maanden mogelijk. Na de huurperiode kun je verlengen, ' +
        'stoppen of de blender overnemen.</p>') +
    sectie('Vriezer', p('Optioneel: een F\'real-vriezer (' + esc(euroKort(s.vriezer)) + '), alleen zinvol bij een zichtlocatie. ' +
      'Een gewone vriezer volstaat.')) +
    sectie('Inkoop', p('Rechtstreeks via Interfastfood; Virtualbite regelt het account.')) +
    sectie('Tip', p('Met vanille als basis maak je ook varianten voor je eigen concept, bijvoorbeeld een matcha shake.')) +
    (pdfUrl ? '<p><a class="sh-download" href="' + esc(pdfUrl) + '" target="_blank" rel="noopener" download>' +
      'Download de presentatie van F\'real (PDF)</a></p>' : '');
}
