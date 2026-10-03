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
 * Stap na "Akkoord": stad@chickito.nl laten doorsturen naar het eigen adres van de partner (`email_doorsturen`).
 * Nog niet gekoppeld: dat gebeurt nu met het project chickito-partnermail (zie CLAUDE.md, open punten).
 * Geeft nooit een fout, zodat "Akkoord" altijd doorgaat.
 */
function koppelCustomerFacingMail(partner) {
  schrijfLog(partner && partner.id, 'customer-facing e-mail', 'nog niet gekoppeld (handmatig via chickito-partnermail)');
  return { gekoppeld: false };
}
