/**
 * Customer-facing e-mailadres per partner (bijv. lelystad@chickito.nl): voorstel, controle en de stap
 * `koppelCustomerFacingMail` na "Akkoord". De pure functies zijn getest in Node (test/customerfacing.test.js).
 */

/**
 * Afgeleid van de vestigingsnaam (besluit 17-10-2026): kleine letters, zonder spaties, leestekens en accenten.
 * "Amsterdam Oost" → "amsterdamoost@chickito.nl"; "'s-Hertogenbosch" → "shertogenbosch@chickito.nl".
 */
function cfVoorstel(vestigingsnaam, domein) {
  var deel = String(vestigingsnaam || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
 * Stap na **Getekend** (fase 4h, vóór het TB-formulier en de aanmelding): het customer-facing adres (bijv.
 * amsterdamoost@chickito.nl) aanmaken als Google Group die doorstuurt naar het eigen adres van de partner
 * (`email_doorsturen`, anders e-mail communicatie of e-mail). Zelfde opzet als groepen.py (../chickito-partner mail):
 * groep "Chickito {vestigingsnaam}", eigenaar hallo@, leden de partner en info@chickito.nl, iedereen (ook extern) mag
 * posten, geen moderatie, spam niet vasthouden. Idempotent.
 * Instelling cf_koppelen: "aan" = echt; "proef" = alleen loggen; "uit" = niets. Nooit adressen van de partner in Log.
 * Bestaat het adres al in Workspace maar niet voor deze partner door de tool gemaakt (bijv. een groep uit
 * partners.csv), dan een fout: nooit een partner in de groep van een andere vestiging.
 */
var CF_EIGENAAR = 'hallo@virtualbite.nl';
var CF_VASTE_LEDEN = ['info@chickito.nl']; // alias van hallo@
var CF_INSTELLINGEN = { // Groups Settings API verwacht tekst, ook voor ja/nee
  whoCanPostMessage: 'ANYONE_CAN_POST', allowExternalMembers: 'true', whoCanJoin: 'INVITED_CAN_JOIN',
  messageModerationLevel: 'MODERATE_NONE', spamModerationLevel: 'ALLOW', includeCustomFooter: 'false',
  whoCanLeaveGroup: 'NONE_CAN_LEAVE'
};

function koppelCustomerFacingMail(partner, opties) {
  var stand = (opties && opties.stand) || cfKoppelen_();
  var cf = String(partner && partner.customer_facing_email || '').trim().toLowerCase();
  if (stand === 'uit') { schrijfLog(partner && partner.id, 'customer-facing e-mail', 'koppelen staat uit'); return { gekoppeld: false }; }
  if (stand !== 'aan') {
    schrijfLog(partner && partner.id, 'customer-facing e-mail', 'proef: groep ' + cf + ' zou worden aangemaakt (doorsturen naar ' +
      'het eigen adres van de partner, info@chickito.nl)');
    return { gekoppeld: false, proef: true };
  }
  var adres = normaliseerCfAdres(cf, cfDomein_());
  if (!adres) throw new Error('Geen geldig customer-facing adres.');
  var doel = [partner.email_doorsturen, partner.email_communicatie, partner.email].map(normaliseerEmail)
    .filter(Boolean)[0];
  if (!doel) throw new Error('Geen eigen mailadres van de partner om naar door te sturen.');
  var naam = 'Chickito ' + vestigingsnaam(partner);
  var kenmerk = 'Contracttool ' + partner.id;
  var groep = cfGroep_(adres);
  if (!groep) {
    groep = AdminDirectory.Groups.insert({ email: adres, name: naam, description: kenmerk + ' – doorsturen naar de partner' });
  } else {
    if (String(groep.email).toLowerCase() !== adres) throw new Error(adres + ' is een alias van groep ' + groep.email + '.');
    if (String(groep.description || '').indexOf(kenmerk) === -1) {
      throw new Error(adres + ' bestaat al in Google Workspace en is niet door de contracttool voor ' + partner.id +
        ' gemaakt. Kies een ander adres of koppel handmatig.');
    }
    if (groep.name !== naam) AdminDirectory.Groups.patch({ name: naam }, adres);
  }
  cfHerhaal_(function () { AdminGroupsSettings.Groups.patch(CF_INSTELLINGEN, adres); }); // nieuwe groep: soms even 404
  [[CF_EIGENAAR, 'OWNER'], [doel, 'MEMBER']].concat(CF_VASTE_LEDEN.map(function (x) { return [x, 'MEMBER']; }))
    .forEach(function (l) { cfHerhaal_(function () { cfLid_(adres, l[0], l[1]); }); });
  schrijfLog(partner.id, 'customer-facing e-mail', 'gekoppeld: ' + adres + ' stuurt door naar het eigen adres van de partner');
  return { gekoppeld: true };
}

function cfGroep_(adres) {
  try { return AdminDirectory.Groups.get(adres); } catch (e) {
    if (/not ?found|404/i.test(String(e && e.message))) return null;
    throw e;
  }
}

/** Lid toevoegen (of rol bijwerken). Al lid, ook via een alias (info@chickito.nl = hallo@): goed. */
function cfLid_(adres, email, rol) {
  var lid = null;
  try { lid = AdminDirectory.Members.get(adres, email); } catch (e) {
    if (!/not ?found|404/i.test(String(e && e.message))) throw e;
  }
  if (!lid) {
    try { AdminDirectory.Members.insert({ email: email, role: rol }, adres); } catch (e) {
      if (!/already exists|duplicate|409/i.test(String(e && e.message))) throw e;
    }
    return;
  }
  if (rol === 'OWNER' && lid.role !== 'OWNER') AdminDirectory.Members.patch({ role: rol }, adres, email);
}

function cfHerhaal_(fn) {
  for (var i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= 4 || !/not ?found|404/i.test(String(e && e.message))) throw e;
      Utilities.sleep(2000 * (i + 1));
    }
  }
}
