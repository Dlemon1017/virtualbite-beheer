/**
 * Customer-facing e-mailadres per partner (bijv. lelystad@chickito.nl): voorstel, controle en de stap
 * `koppelCustomerFacingMail` na "Akkoord". De pure functies zijn getest in Node (test/customerfacing.test.js).
 */

/** "'s-Hertogenbosch" → "s-hertogenbosch@chickito.nl"; "Den Haag" → "den-haag@chickito.nl". */
function cfVoorstel(stad, domein) {
  var deel = String(stad || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return deel ? deel + '@' + domein : '';
}

/** Kleine letters, alleen letters/cijfers met losse punten of streepjes, op het juiste domein. Ongeldig → ''. */
function normaliseerCfAdres(adres, domein) {
  var s = String(adres || '').trim().toLowerCase();
  var m = /^([a-z0-9]+(?:[.-][a-z0-9]+)*)@(.+)$/.exec(s);
  return m && m[2] === String(domein).toLowerCase() ? s : '';
}

/**
 * Melding als het adres al bij een andere (niet-geannuleerde) partner hoort; anders ''.
 * partners: [{id, status, customer_facing_email}]; eigenId: de partner zelf (bij wijzigen).
 */
function cfUniekFout(adres, partners, eigenId) {
  var s = String(adres || '').trim().toLowerCase();
  var ander = (partners || []).filter(function (p) {
    return p.id !== eigenId && p.status !== STATUS.GEANNULEERD &&
      String(p.customer_facing_email || '').trim().toLowerCase() === s;
  })[0];
  return ander ? 'Dit adres hoort al bij partner ' + ander.id + '. Kies een ander adres, bijv. met de wijk erbij.' : '';
}

/**
 * Stap na **Getekend** (fase 4d): stad@chickito.nl laten doorsturen naar het eigen adres van de partner
 * (`email_doorsturen`). Instelling cf_koppelen: "proef" (standaard) logt alleen wat er zou gebeuren; "aan" volgt in fase
 * 4h (Google Groups via de Admin SDK, zie CLAUDE.md); "uit" doet niets. Nooit adressen van de partner in Log.
 */
function koppelCustomerFacingMail(partner) {
  var stand = cfKoppelen_();
  var cf = String(partner && partner.customer_facing_email || '');
  if (stand === 'uit') { schrijfLog(partner && partner.id, 'customer-facing e-mail', 'koppelen staat uit'); return { gekoppeld: false }; }
  schrijfLog(partner && partner.id, 'customer-facing e-mail', (stand === 'aan' ? 'aan (nog niet gebouwd, fase 4h): ' : 'proef: ') +
    'groep ' + cf + ' zou worden aangemaakt met 2 leden (eigen adres partner, info@chickito.nl)');
  return { gekoppeld: false, proef: true };
}
