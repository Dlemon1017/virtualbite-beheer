/*
 * Beheerpagina Virtualbite contracttool (beheer.virtualbite.nl, GitHub Pages).
 * Praat met de Apps Script-API (config.js) via fetch zonder cookies. Gedeelde regels (velden, uitleg, controles,
 * berekening, postcodes, customer-facing e-mail) komen uit gedeeld/*.js: dezelfde bestanden als op de server.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var inst = { cf_domein: 'chickito.nl' };
  var huidig = null; // partner in het detailscherm
  var laatsteMerken = [];

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** Naam in lijst en kop: naam van de zaak, anders de contactpersoon ("Voornaam Achternaam"). */
  function naamVan(p) {
    var contact = [p.voornaam_contact, p.achternaam_contact].map(function (x) { return String(x || '').trim(); })
      .filter(Boolean).join(' ');
    return String(p.zaak_naam || contact || p.naam_start || '').trim();
  }
  function testTag() { return '<span class="tag-test" title="Testpartner: alles gaat naar hallo@">Test</span>'; }

  function badge(status) {
    return '<span class="badge b-' + esc(String(status).replace(/\s+/g, '-')) + '">' + esc(status) + '</span>';
  }

  // ---------- Melding en dialoog ----------
  var meldingTimer;
  function toon(tekst, isFout) {
    var m = $('melding');
    m.textContent = tekst;
    m.className = 'toon' + (isFout ? ' fout' : '');
    clearTimeout(meldingTimer);
    meldingTimer = setTimeout(function () { m.className = ''; }, isFout ? 6000 : 2600);
  }

  function bevestig(titel, tekst, jaTekst, gevaar) {
    return new Promise(function (klaar) {
      var achter = document.createElement('div');
      achter.className = 'dialoog-achter';
      achter.innerHTML = '<div class="dialoog" role="dialog" aria-modal="true" aria-labelledby="d-titel">' +
        '<h2 id="d-titel">' + esc(titel) + '</h2><p>' + esc(tekst) + '</p><div class="dialoog-knoppen">' +
        '<button class="knop licht" data-k="nee">Annuleer</button>' +
        '<button class="knop' + (gevaar ? ' rood' : '') + '" data-k="ja">' + esc(jaTekst) + '</button></div></div>';
      function sluit(uitkomst) { achter.remove(); document.removeEventListener('keydown', toets); klaar(uitkomst); }
      function toets(e) { if (e.key === 'Escape') sluit(false); }
      achter.addEventListener('click', function (e) {
        if (e.target === achter) sluit(false);
        var k = e.target.getAttribute('data-k');
        if (k) sluit(k === 'ja');
      });
      document.addEventListener('keydown', toets);
      document.body.appendChild(achter);
      achter.querySelector('[data-k="ja"]').focus();
    });
  }

  /** Keuzevenster: opties [[waarde, tekst], …] onder elkaar plus Annuleer. Geeft de gekozen waarde, of null. */
  function kies(titel, tekst, opties) {
    return new Promise(function (klaar) {
      var achter = document.createElement('div');
      achter.className = 'dialoog-achter';
      achter.innerHTML = '<div class="dialoog" role="dialog" aria-modal="true" aria-labelledby="d-titel">' +
        '<h2 id="d-titel">' + esc(titel) + '</h2><p>' + esc(tekst) + '</p><div class="dialoog-knoppen onder-elkaar">' +
        opties.map(function (o) { return '<button class="knop" data-k="' + esc(o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') +
        '<button class="knop licht" data-k="">Annuleer</button></div></div>';
      function sluit(uitkomst) { achter.remove(); document.removeEventListener('keydown', toets); klaar(uitkomst || null); }
      function toets(e) { if (e.key === 'Escape') sluit(null); }
      achter.addEventListener('click', function (e) {
        if (e.target === achter) sluit(null);
        var k = e.target.getAttribute('data-k');
        if (k !== null) sluit(k);
      });
      document.addEventListener('keydown', toets);
      document.body.appendChild(achter);
      achter.querySelector('[data-k]').focus();
    });
  }

  function bezig(knop, tekst) {
    var oud = knop.innerHTML;
    knop.disabled = true;
    knop.classList.add('bezig');
    knop.textContent = tekst || 'Bezig…';
    return function () { knop.disabled = false; knop.classList.remove('bezig'); knop.innerHTML = oud; };
  }

  // ---------- API en sessie ----------
  var SESSIE_SLEUTEL = 'vb_beheer_sessie';
  function leesSessie() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSIE_SLEUTEL) || 'null');
      return s && s.sessie && s.verloopt > Date.now() ? s : null;
    } catch (e) { return null; }
  }
  var sessie = leesSessie();
  function bewaarSessie(s) {
    try { localStorage.setItem(SESSIE_SLEUTEL, JSON.stringify(s)); } catch (e) { /* privévenster */ }
    sessie = s;
  }
  function wisSessie() {
    try { localStorage.removeItem(SESSIE_SLEUTEL); } catch (e) { /* niets */ }
    sessie = null;
    details = {}; // partnergegevens alleen in het geheugen, en weg bij uitloggen
    lijstCache = null;
  }

  // Lijst en details van de laatste "overzicht"-aanroep (alleen in het geheugen, nooit in browseropslag): schermen
  // openen direct en worden daarna op de achtergrond ververst.
  var details = {};
  var lijstCache = null;

  var STORING = 'De server van Google reageert even niet. Probeer het zo opnieuw.';
  var MAX_WACHT_MS = 20000; // daarna geldt het als storing (Google laat een verzoek soms lang hangen)

  function api(verzoek) {
    var afbreken = typeof AbortController === 'function' ? new AbortController() : null;
    var t = afbreken ? setTimeout(function () { afbreken.abort(); }, MAX_WACHT_MS) : null;
    return fetch(window.VB_CONFIG.api, {
      method: 'POST', credentials: 'omit', redirect: 'follow', signal: afbreken ? afbreken.signal : undefined,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(verzoek)
    }).then(function (r) {
      if (!r.ok) throw new Error(STORING);
      return r.text();
    }, function () { throw new Error(STORING); }).then(function (tekst) {
      clearTimeout(t);
      var j;
      try { j = JSON.parse(tekst); } catch (e) { throw new Error(STORING); }
      // Google stuurt een POST soms als GET door (antwoord van doGet): dan is er niets gedaan, dus storing.
      if (!j || j.status === 'get' || (verzoek.actie === 'beheer' && j.status === 'ok' && !('data' in j))) throw new Error(STORING);
      return j;
    }, function (e) { clearTimeout(t); throw e; });
  }

  /**
   * Bij een storing (foutpagina van Google) nog één keer: alleen-lezen aanroepen en aanroepen die je veilig kunt
   * herhalen (een veld op een waarde zetten, het btw-nummer controleren).
   */
  var ALLEEN_LEZEN = ['overzicht', 'detail', 'bewaar', 'controleerBtw', 'afstanden'];
  function roep(fn, args) {
    if (!sessie) { toonLogin(); return Promise.reject(new Error('Niet ingelogd.')); }
    var verzoek = { actie: 'beheer', sessie: sessie.sessie, functie: fn, args: args || [] };
    var p = api(verzoek);
    if (ALLEEN_LEZEN.indexOf(fn) !== -1) p = p.catch(function () { return api(verzoek); });
    return p.then(function (r) {
      if (r.status === 'uitgelogd') {
        wisSessie();
        toonLogin('Je sessie is verlopen of ingetrokken. Log opnieuw in.');
        throw new Error('Uitgelogd.');
      }
      if (r.status !== 'ok') throw new Error(r.melding || 'Er ging iets mis.');
      return r.data;
    });
  }

  // ---------- Inloggen ----------
  function toonLogin(melding) {
    $('app').hidden = true;
    sluitDetail();
    $('login').hidden = false;
    $('loginEmail').hidden = false;
    $('loginCode').hidden = true;
    $('l-email-fout').textContent = melding || '';
    $('l-email').focus();
  }

  function toonApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    $('gebruiker').textContent = sessie.email;
    laad();
  }

  $('loginEmail').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('l-email').value.trim();
    $('l-email-fout').textContent = '';
    if (!normaliseerEmail(email)) { $('l-email-fout').textContent = 'Vul een geldig e-mailadres in.'; return; }
    $('loginEmail').hidden = true;
    $('loginCode').hidden = false;
    $('l-uitleg').textContent = 'Als ' + email + ' toegang heeft, komt er nu een code naartoe. De code is 10 minuten ' +
      'geldig. Kijk ook even in je spam.';
    $('l-code').value = '';
    $('l-code-fout').textContent = '';
    $('l-code').focus();
    api({ actie: 'login_vraag', email: email }).then(function (r) {
      if (r.status === 'fouten') toonLogin(r.fouten.email);
      else if (r.status !== 'verstuurd') throw new Error();
    }).catch(function () {
      toonLogin('Versturen van de code lukte niet. Controleer je internet en probeer het opnieuw.');
    });
  });

  $('loginCode').addEventListener('submit', function (e) {
    e.preventDefault();
    $('l-code-fout').textContent = '';
    var herstel = bezig($('l-inloggen'), 'Bezig met inloggen…');
    var verzoek = { actie: 'login_code', email: $('l-email').value.trim(), code: $('l-code').value, apparaat: navigator.userAgent };
    // Mag veilig herhaald worden: de server geeft bij hetzelfde verzoek binnen 2 minuten dezelfde sessie terug.
    api(verzoek).catch(function () { return api(verzoek); }).then(function (r) {
      herstel();
      if (r.status !== 'ok') { $('l-code-fout').textContent = (r.fouten && r.fouten.code) || 'Inloggen lukte niet.'; return; }
      bewaarSessie({ sessie: r.sessie, email: r.email, verloopt: r.verloopt });
      toonApp();
    }).catch(function (err) { herstel(); $('l-code-fout').textContent = err.message; });
  });

  $('l-opnieuw').addEventListener('click', function () { toonLogin(); });

  $('uitloggen').addEventListener('click', function () {
    var s = sessie;
    wisSessie();
    $('lijst').innerHTML = '';
    if (s) api({ actie: 'uitloggen', sessie: s.sessie }).catch(function () { /* lokaal al uitgelogd */ });
    toonLogin('Je bent uitgelogd.');
  });

  // ---------- Lijst ----------
  function toonLijst(partners) {
    var n = partners.filter(function (p) { return p.status !== 'Geannuleerd'; }).length;
    $('telling').textContent = n === 1 ? '1 partner' : n + ' partners';
    $('lijst').innerHTML = partners.length ? partners.map(function (p) {
      return '<button class="item' + (p.status === 'Geannuleerd' ? ' uit' : '') + '" data-id="' + esc(p.id) + '">' +
        '<div class="wie"><div class="naam">' + esc(p.naam || p.id) + (p.test ? testTag() : '') + '</div>' +
        '<div class="wanneer">' + esc([p.id, p.stad, p.customer_facing_email].filter(Boolean).join(' · ')) + '</div></div>' +
        badge(p.status) + '</button>';
    }).join('') : '<div class="leeg">Nog geen partners. Maak er een aan met "Nieuwe partner".</div>';
    // Lijstje "Nog te doen": shakes "Ik beslis later" → nabellen (weg zodra je de keuze in "⋯ Beheer" zet)
    var later = partners.filter(function (p) { return p.status !== 'Geannuleerd' && p.shakes === 'later'; });
    $('teDoen').hidden = !later.length;
    $('teDoen').innerHTML = later.length ? '<h2>Nog te doen</h2>' + later.map(function (p) {
      return '<button class="item" data-id="' + esc(p.id) + '"><div class="wie"><div class="naam">Shakes nabellen: ' +
        esc(p.naam || p.id) + (p.test ? testTag() : '') + '</div><div class="wanneer">' + esc(p.id) + ' · koos "Ik beslis later"' +
        '</div></div></button>';
    }).join('') : '';
  }

  /** Lijst: eerst wat we al hebben (met de laatst bekende naam en status uit de details), daarna vers van de server. */
  function laad() {
    if (lijstCache) {
      toonLijst(lijstCache.map(function (p) {
        var d = details[p.id];
        return d ? Object.assign({}, p, { naam: naamVan(d) || p.naam, status: d.status, stad: d.stad,
          customer_facing_email: d.customer_facing_email }) : p;
      }));
    }
    return roep('overzicht').then(function (o) {
      inst = o.instellingen || inst;
      zetOpeningsMinimum(inst.openings_minimum);
      $('testbalk').hidden = !o.testmodus;
      vulMerken(o.merken);
      laatsteMerken = o.merken || [];
      lijstCache = o.partners;
      Object.keys(o.details || {}).forEach(function (id) {
        if (!(huidig && huidig.id === id)) details[id] = o.details[id]; // de open partner niet overschrijven
      });
      toonLijst(o.partners);
    }).catch(function (e) {
      if (e.message !== 'Uitgelogd.') { $('telling').textContent = ''; toon(e.message, true); }
    });
  }

  $('lijst').addEventListener('click', function (e) {
    var item = e.target.closest('.item');
    if (item) openDetail(item.getAttribute('data-id'));
  });
  $('teDoen').addEventListener('click', function (e) {
    var item = e.target.closest('.item');
    if (item) openDetail(item.getAttribute('data-id'));
  });

  // ---------- Nieuwe partner ----------
  var nieuwRoute = '';
  var nieuwKanaal = 'mail';
  var cfZelfGewijzigd = false;

  function vulMerken(merken) {
    var sel = $('n-merk');
    var huidigeKeuze = sel.value;
    sel.innerHTML = (merken || []).map(function (m) { return '<option value="' + esc(m.naam) + '">' + esc(m.naam) + '</option>'; }).join('');
    if (huidigeKeuze) sel.value = huidigeKeuze;
  }

  function resetNieuw() {
    ['n-voornaam', 'n-achternaam', 'n-email', 'n-mobiel', 'n-stad', 'n-cf'].forEach(function (id) { $(id).value = ''; });
    nieuwRoute = '';
    nieuwKanaal = 'mail';
    cfZelfGewijzigd = false;
    zetKeuze($('n-route'), '');
    zetKeuze($('n-kanaal'), 'mail');
    $('n-testpartner').checked = false;
    $('nieuw').querySelectorAll('[data-fout]').forEach(function (f) { f.textContent = ''; });
  }

  function zetKeuze(groep, waarde) {
    groep.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-waarde') === waarde));
    });
  }

  $('nieuwKnop').addEventListener('click', function () {
    resetNieuw();
    $('nieuw').hidden = false;
    $('nieuwKnop').hidden = true;
    werkAanmakenBij();
    $('n-voornaam').focus();
  });
  $('n-annuleer').addEventListener('click', function () { $('nieuw').hidden = true; $('nieuwKnop').hidden = false; });
  $('n-stad').addEventListener('input', function () {
    if (!cfZelfGewijzigd) $('n-cf').value = cfVoorstel($('n-stad').value, inst.cf_domein);
  });
  $('n-cf').addEventListener('input', function () { cfZelfGewijzigd = $('n-cf').value.trim() !== ''; });
  // Foutmelding weg zodra een veld wordt aangepast.
  [['n-voornaam', 'voornaam'], ['n-achternaam', 'achternaam'], ['n-email', 'email'], ['n-mobiel', 'mobiel'], ['n-stad', 'stad'],
    ['n-cf', 'customer_facing_email']].forEach(function (x) {
    $(x[0]).addEventListener('input', function () {
      $('nieuw').querySelector('[data-fout="' + x[1] + '"]').textContent = '';
      if (x[1] === 'stad') $('nieuw').querySelector('[data-fout="customer_facing_email"]').textContent = '';
    });
  });
  $('n-test').addEventListener('click', function () {
    var nr = String(Date.now()).slice(-4);
    $('n-voornaam').value = 'Jan';
    $('n-achternaam').value = 'Test ' + nr;
    $('n-email').value = 'hallo+test' + nr + '@virtualbite.nl';
    $('n-mobiel').value = '0612345678';
    $('n-stad').value = 'Teststad ' + nr;
    cfZelfGewijzigd = false;
    $('n-cf').value = cfVoorstel($('n-stad').value, inst.cf_domein);
    nieuwRoute = 'samen';
    zetKeuze($('n-route'), 'samen');
    $('n-testpartner').checked = true;
    $('nieuw').querySelectorAll('[data-fout]').forEach(function (f) { f.textContent = ''; });
  });
  $('n-kanaal').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    nieuwKanaal = b.getAttribute('data-waarde');
    zetKeuze($('n-kanaal'), nieuwKanaal);
    $('nieuw').querySelector('[data-fout="mobiel"]').textContent = '';
  });
  $('n-route').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    nieuwRoute = b.getAttribute('data-waarde');
    zetKeuze($('n-route'), nieuwRoute);
    $('nieuw').querySelector('[data-fout="route"]').textContent = '';
  });

  function werkAanmakenBij() {
    var mobiel = $('n-mobiel').value.trim();
    var klaar = !!$('n-voornaam').value.trim() && !!normaliseerEmail($('n-email').value) &&
      (!mobiel || !!whatsappNummer(mobiel)) && (nieuwKanaal !== 'whatsapp' || !!whatsappNummer(mobiel)) && !!$('n-merk').value &&
      $('n-stad').value.trim().length >= 2 && !!normaliseerCfAdres($('n-cf').value, inst.cf_domein) && !!nieuwRoute;
    $('n-maak').classList.toggle('klaar', klaar);
  }
  ['input', 'click'].forEach(function (t) {
    $('nieuw').addEventListener(t, function () { setTimeout(werkAanmakenBij, 0); });
  });

  $('nieuw').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = $('nieuw');
    form.querySelectorAll('[data-fout]').forEach(function (f) { f.textContent = ''; });
    var herstel = bezig($('n-maak'), 'Aanmaken…');
    roep('aanmaken', [{
      voornaam: $('n-voornaam').value, achternaam: $('n-achternaam').value, email: $('n-email').value, mobiel: $('n-mobiel').value,
      merk: $('n-merk').value, stad: $('n-stad').value, customer_facing_email: $('n-cf').value, route: nieuwRoute,
      kanaal: nieuwKanaal, test: $('n-testpartner').checked
    }]).then(function (r) {
      herstel();
      if (r.fouten) {
        Object.keys(r.fouten).forEach(function (k) {
          var f = form.querySelector('[data-fout="' + k + '"]');
          if (f) f.textContent = r.fouten[k];
        });
        return;
      }
      form.hidden = true;
      $('nieuwKnop').hidden = false;
      toon(r.automatisch_uitgenodigd ? 'Partner ' + r.id + ' aangemaakt en per mail uitgenodigd.' :
        r.uitnodigen_fout ? 'Partner ' + r.id + ' aangemaakt; uitnodigen lukte niet: ' + r.uitnodigen_fout : 'Partner ' + r.id + ' aangemaakt.',
        !!r.uitnodigen_fout);
      laad();
      toonDetail(r);
      openPaneel();
    }).catch(function (err) { herstel(); toon(err.message, true); });
  });

  // ---------- Detail: drie schermen ----------
  // Formulier (samen invullen), afronden (na "Ingevuld") en controle (Dimitri, vanaf "Wacht op controle").
  // Velden, opslaan, adres, postcodes, tijden en afstanden: gedeeld met de partnerpagina (gedeeld/formulier.js).
  var FORMULIER_STATUSSEN = ['Samen invullen', 'Aangemaakt', 'Uitgenodigd', 'Deels ingevuld'];
  var bewerkStap = null; // controlescherm: welk blok staat open voor wijzigen (index in FORMULIER_STAPPEN)

  var f = VBFormulier({
    root: $('detailInhoud'),
    inst: function () { return inst; },
    api: {
      bewaar: function (veld, waarde, volgnr) { return roep('bewaar', [huidig.id, veld, waarde, volgnr]); },
      afstanden: function (regels) { return roep('afstanden', [huidig.id, regels]); },
      btw: function () { return roep('controleerBtw', [huidig.id]); },
      toonBsn: function () { return roep('toonBsn', [huidig.id]); }
    },
    naWijziging: function () { werkKnoppenBij(); },
    naInvoer: function (veld) { if (veld === 'fee_percentage') werkVoorbeeldBij(); },
    melding: toon
  });

  /** Na uitnodigen of een herinnering: het menu weer open (op de statuskaart staan de knoppen al in beeld). */
  function openMenuBuitenStatuskaart() {
    if (!$('statusKaart')) $('beheerMenu').hidden = false;
  }

  function zetHuidig(p) {
    huidig = p;
    f.huidig = p;
  }

  function openPaneel() {
    $('detail').classList.add('open');
    $('detail').setAttribute('aria-hidden', 'false');
    $('detail').scrollTop = 0;
  }

  // Is er in het open detail al iets aangeraakt? Dan het scherm niet meer vervangen door de verse gegevens.
  var aangeraakt = false;
  ['input', 'change', 'click'].forEach(function (t) {
    $('detailInhoud').addEventListener(t, function () { aangeraakt = true; }, true);
  });

  /**
   * Partner openen: direct uit het geheugen (gegevens van de lijst), daarna vers van de server. Is er intussen niets
   * aangeraakt en is er iets veranderd, dan het scherm stil bijwerken.
   */
  function openDetail(id) {
    openPaneel();
    bewerkStap = null;
    aangeraakt = false;
    var bekend = details[id];
    if (bekend) toonDetail(bekend);
    else {
      $('detailInhoud').innerHTML = '<button class="terug" data-actie="terug">‹ Terug</button>' +
        '<div class="laad-regel"></div><div class="laad-regel kort"></div><div class="laad-regel"></div>';
    }
    var was = bekend ? JSON.stringify(bekend) : '';
    roep('detail', [id]).then(function (p) {
      if (!huidig && bekend) return; // intussen gesloten
      if (huidig && huidig.id !== id) return; // intussen een andere partner
      if (!bekend) { toonDetail(p); return; }
      if (aangeraakt || JSON.stringify(p) === was) { details[id] = huidig; return; }
      var top = $('detail').scrollTop;
      toonDetail(p);
      $('detail').scrollTop = top;
    }).catch(function (e) {
      if (e.message === 'Uitgelogd.') return;
      toon(e.message, true);
      if (!bekend) sluitDetail();
    });
  }

  function sluitDetail() {
    clearTimeout(verversTimer);
    VBSluitUitleg();
    $('detail').classList.remove('open');
    $('detail').setAttribute('aria-hidden', 'true');
    zetHuidig(null);
  }

  /** Kop met het menu "⋯ Beheer" (alleen voor Dimitri; dicht, zodat een meekijkende partner het niet ziet). */
  function kopHtml(p, metCf, zonderUitnodiging) {
    return '<div class="kop-balk"><button class="terug" data-actie="terug">‹ Terug</button>' +
      '<button type="button" class="klein-knop" data-actie="beheermenu" aria-expanded="false" aria-controls="beheerMenu">⋯ Beheer</button></div>' +
      '<div class="kaart beheermenu" id="beheerMenu" hidden><h2>Beheer (alleen Virtualbite)</h2>' +
      (zonderUitnodiging ? '' : uitnodigingHtml(p)) + partnerKaartVelden(p, !p.mag_bewerken, !metCf) + '</div>' +
      '<div class="kop-detail"><div><p class="merk">' + esc(p.id) + ' · ' + esc(p.merk || '') + ' · ' +
      (p.route === 'samen' ? 'samen invullen' : 'partner vult zelf in') + '</p><h1>' + esc(naamVan(p) || p.id) +
      (p.test ? testTag() : '') + '</h1></div>' +
      badge(p.status) + '</div>';
  }

  /** Uitnodigen via mail of WhatsApp en "Herinnering nu sturen" (zolang het formulier nog niet is ingevuld). */
  function uitnodigingInfo(p) {
    return p.uitnodiging_verstuurd_op ? 'Uitgenodigd op ' + p.uitnodiging_verstuurd_op + (p.laatst_uitgenodigd_op &&
      p.laatst_uitgenodigd_op !== p.uitnodiging_verstuurd_op ? ', laatst op ' + p.laatst_uitgenodigd_op : '') + ' via ' +
      (p.uitgenodigd_via === 'whatsapp' ? 'WhatsApp' : 'mail') + '.' : 'Nog niet uitgenodigd.';
  }

  function uitnodigingKnoppen(p) {
    var al = !!p.uitnodiging_verstuurd_op;
    return '<div class="knoppen-rij">' +
      '<button type="button" class="klein-knop" data-actie="uitnodigen-mail">' + (al ? 'Opnieuw versturen via mail' : 'Uitnodigen via mail') + '</button>' +
      '<button type="button" class="klein-knop" data-actie="uitnodigen-whatsapp">' + (al ? 'Opnieuw versturen via WhatsApp' :
        'Uitnodigen via WhatsApp') + '</button>' +
      (['Uitgenodigd', 'Deels ingevuld'].indexOf(p.status) !== -1 ?
        '<button type="button" class="klein-knop" data-actie="herinnering-nu">Herinnering nu sturen</button>' : '') + '</div>';
  }

  function uitnodigingHtml(p) {
    var kan = ['Aangemaakt', 'Samen invullen', 'Uitgenodigd', 'Deels ingevuld'].indexOf(p.status) !== -1;
    if (!kan) return '';
    return '<div class="uitnodigen"><div class="label">Partner zelf laten invullen</div><div class="klein">' +
      esc(uitnodigingInfo(p)) + '</div>' + uitnodigingKnoppen(p) + '</div>';
  }

  function toonDetail(p) {
    zetHuidig(p);
    details[p.id] = p; // het geheugen volgt wat op het scherm staat
    if (toontStatuskaart(p)) toonStatuskaart(p);
    else if (p.status === 'Aanpassing gevraagd') toonAanpassing(p);
    else if (FORMULIER_STATUSSEN.indexOf(p.status) !== -1) toonFormulier(p);
    else toonControle(p);
    if (p.markering && !p.markering.actueel && heeftPostcodes(p)) f.planAfstanden(true);
  }

  function heeftPostcodes(p) {
    return !!String(p.postcodes_gewenst || '').trim() ||
      f.leesRijen(p.bezorggebied).some(function (r) { return String(r.postcodes || '').trim(); });
  }

  // ---------- Statuskaart (partner vult zelf in, nog niet verstuurd) ----------
  var STATUSKAART_STATUSSEN = ['Aangemaakt', 'Uitgenodigd', 'Deels ingevuld'];

  function toontStatuskaart(p) {
    return p.route === 'zelf' && STATUSKAART_STATUSSEN.indexOf(p.status) !== -1;
  }

  /** Eerste stap die nog niet compleet is (zelfde regels als de partnerpagina); -1 = alles compleet. */
  function stapVanPartner(p) {
    var g = Object.assign({}, p);
    if (p.heeft_bsn) g.bsn = '111222333';
    var fouten = valideerPartnerFormulier(g).fouten;
    for (var i = 0; i < FORMULIER_STAPPEN.length; i++) {
      if (FORMULIER_STAPPEN[i].velden.some(function (d) { return fouten[d.veld]; })) return i;
    }
    return -1;
  }

  function toonStatuskaart(p) {
    var regel = function (label, waarde) {
      return '<div><dt>' + esc(label) + '</dt><dd>' + esc(waarde) + '</dd></div>';
    };
    var n = FORMULIER_STAPPEN.length;
    var stap = stapVanPartner(p);
    var voortgang = p.status !== 'Deels ingevuld' ? 'Nog niet begonnen' :
      stap === -1 ? 'Alles ingevuld, nog niet verstuurd' : 'Stap ' + (stap + 1) + ' van ' + n + ' (' + FORMULIER_STAPPEN[stap].titel + ')';
    var herinneringen = (p.herinneringen || []).map(function (h) {
      return 'Dag ' + h.dag + ': ' + (h.verstuurd ? 'verstuurd ' + h.verstuurd : 'gepland ' + h.gepland);
    });
    if (p.herinnering_handmatig_op) herinneringen.push('Handmatig: verstuurd ' + p.herinnering_handmatig_op);
    var h = kopHtml(p, true, true) +
      '<section class="kaart" id="statusKaart"><h2>Partner vult zelf in</h2><dl>' +
      regel('Status', p.status) +
      regel('Uitnodiging', uitnodigingInfo(p)) +
      regel('Voortgang', voortgang) +
      (p.formulier_opgeslagen_op ? regel('Laatst opgeslagen', p.formulier_opgeslagen_op) : '') +
      (herinneringen.length ? '<div><dt>Herinneringen</dt><dd>' + herinneringen.map(esc).join('<br>') + '</dd></div>' :
        regel('Herinneringen', p.uitnodiging_verstuurd_op ? 'Geen gepland' : 'Starten na de uitnodiging (dag 3, 5 en 7)')) +
      '</dl>' + uitnodigingKnoppen(p) + '</section>' +
      '<details class="kaart ingevuld"><summary>Bekijk ingevulde gegevens</summary>' +
      FORMULIER_STAPPEN.map(function (st) { return '<h3 class="tussenkop">' + esc(st.titel) + '</h3>' + VBSamenvatting(st, p, true); }).join('') +
      '</details>';
    $('detailInhoud').innerHTML = h;
  }

  // ---------- "Aanpassing gevraagd": wat er gevraagd is, opnieuw sturen, WhatsApp, intrekken ----------
  function toonAanpassing(p) {
    var regel = function (label, waarde) { return '<div><dt>' + esc(label) + '</dt><dd>' + esc(waarde) + '</dd></div>'; };
    var velden = [];
    try { velden = JSON.parse(p.aanpassing_velden || '[]'); } catch (e) { velden = []; }
    var wa = p.kanaal === 'whatsapp';
    var h = kopHtml(p, true, true) +
      '<section class="kaart" id="statusKaart"><h2>Aanpassing gevraagd</h2><dl>' +
      regel('Gevraagd op', p.aanpassing_op || '') +
      regel('Aanpassen', aanpassingLabels(velden).join(', ')) +
      regel('Toelichting', p.aanpassing_toelichting || '') +
      regel('Herinnering', p.aanpassing_herinnering_op ? 'Verstuurd ' + p.aanpassing_herinnering_op : 'Na 2 dagen, als er nog niets verstuurd is') +
      '</dl><div class="klein">Verstuurt de partner opnieuw, dan gaat de status terug naar "Wacht op controle" en krijg je een ' +
      'melding met de gewijzigde velden.</div><div class="knoppen-rij">' +
      '<button type="button" class="klein-knop" data-actie="aanpassing-mail">Opnieuw versturen via mail</button>' +
      (wa ? '<button type="button" class="klein-knop" data-actie="aanpassing-whatsapp">Via WhatsApp sturen</button>' : '') +
      '<button type="button" class="klein-knop" data-actie="aanpassing-intrekken">Intrekken (zelf aanpassen)</button></div></section>' +
      '<details class="kaart ingevuld"><summary>Bekijk ingevulde gegevens</summary>' +
      FORMULIER_STAPPEN.map(function (st) { return '<h3 class="tussenkop">' + esc(st.titel) + '</h3>' + VBSamenvatting(st, p, true); }).join('') +
      '</details>';
    $('detailInhoud').innerHTML = h;
  }

  /**
   * Venster "Aanpassing vragen": velden aanvinken (per stap, het locatieadres als één keuze) en een korte toelichting.
   * Geeft {velden, toelichting, venster} of null. Bij kanaal WhatsApp opent het WhatsApp-venster al bij de klik
   * (anders blokkeert de browser het), de link volgt na het antwoord van de server.
   */
  function aanpassingDialoog(p) {
    return new Promise(function (klaar) {
      var achter = document.createElement('div');
      achter.className = 'dialoog-achter';
      var stapNu = '';
      var lijst = aanpasbareVelden().map(function (a) {
        var kop = a.stap !== stapNu ? '<div class="aanpas-stap">' + esc(a.stap) + '</div>' : '';
        stapNu = a.stap;
        return kop + '<label class="vink-regel"><input type="checkbox" data-aanpas="' + esc(a.veld) + '"> ' + esc(a.label) + '</label>';
      }).join('');
      achter.innerHTML = '<div class="dialoog groot" role="dialog" aria-modal="true" aria-labelledby="d-titel">' +
        '<h2 id="d-titel">Aanpassing vragen</h2><p>Vink aan wat ' + esc(naamVan(p) || 'de partner') + ' moet aanpassen of ' +
        'aanvullen. De partner krijgt een mail' + (p.kanaal === 'whatsapp' ? ' en jij een WhatsApp-bericht om te sturen' : '') +
        ' met een knop naar het eigen formulier; wat er al staat blijft staan.</p>' + lijst +
        '<label for="d-toelichting" class="mt">Toelichting voor de partner</label>' +
        '<textarea id="d-toelichting" placeholder="Bijv. Het KvK-nummer klopt niet; kun je het nakijken?"></textarea>' +
        '<div class="fout" id="d-fout"></div><div class="dialoog-knoppen">' +
        '<button class="knop licht" data-k="nee">Annuleer</button><button class="knop hoofd klaar" data-k="ja">Versturen</button></div></div>';
      function sluit(uitkomst) { achter.remove(); document.removeEventListener('keydown', toets); klaar(uitkomst); }
      function toets(e) { if (e.key === 'Escape') sluit(null); }
      achter.addEventListener('click', function (e) {
        if (e.target === achter) return sluit(null);
        var k = e.target.getAttribute('data-k');
        if (k === 'nee') return sluit(null);
        if (k !== 'ja') return;
        var velden = Array.prototype.filter.call(achter.querySelectorAll('[data-aanpas]'), function (x) { return x.checked; })
          .map(function (x) { return x.getAttribute('data-aanpas'); });
        var toelichting = achter.querySelector('#d-toelichting').value.trim();
        var fout = !velden.length ? 'Vink minstens één veld aan.' : !toelichting ? 'Typ een korte toelichting.' : '';
        if (fout) { achter.querySelector('#d-fout').textContent = fout; return; }
        var venster = p.kanaal === 'whatsapp' ? window.open('', '_blank') : null;
        sluit({ velden: velden, toelichting: toelichting, venster: venster });
      });
      document.addEventListener('keydown', toets);
      document.body.appendChild(achter);
      achter.querySelector('[data-aanpas]').focus();
    });
  }

  function aanpassingVragen(knop) {
    var id = huidig.id;
    f.slaWachtendOp().then(function () { return aanpassingDialoog(huidig); }).then(function (k) {
      if (!k) return;
      var herstel = bezig(knop, 'Versturen…');
      roep('aanpassingVragen', [id, k.velden, k.toelichting]).then(function (r) {
        herstel();
        if (k.venster && r.whatsapp_url) k.venster.location.href = r.whatsapp_url;
        else if (k.venster) k.venster.close();
        toon('Aanpassing gevraagd: de partner heeft een mail gekregen' + (r.whatsapp_url ? '; WhatsApp staat klaar om te versturen.' : '.'));
        zetHuidig(r);
        toonDetail(r);
        $('detail').scrollTop = 0;
      }).catch(function (err) { herstel(); if (k.venster) k.venster.close(); toon(err.message, true); });
    });
  }

  // ---------- Scherm 1: formulier (samen invullen) ----------
  function toonFormulier(p) {
    var uit = !p.mag_bewerken;
    var h = kopHtml(p, true) + statusUitleg(p);
    if (p.testmodus && !uit) h += '<button type="button" class="klein-knop mt" data-actie="testgegevens">Vul testgegevens in</button>';
    FORMULIER_STAPPEN.forEach(function (stap) {
      h += '<section class="kaart"><h2>' + esc(stap.titel) + '</h2>' + f.stapVelden(stap, p, uit) +
        (stap.titel === 'Bezorggebied' ? '<div class="klein" id="afstandInfo" hidden></div>' : '') + '</section>';
    });
    h += '<div class="acties"><button class="knop hoofd" data-actie="ingevuld">Ingevuld</button></div>';
    $('detailInhoud').innerHTML = h;
    f.naTekenen();
  }

  function partnerKaartVelden(p, uit, zonderCf) {
    var veld = function (v, label, type, extra) {
      return '<div class="veld" data-rij="' + v + '"><label for="v-' + v + '">' + esc(label) + '</label>' +
        '<input id="v-' + v + '" data-veld="' + v + '" value="' + esc(p[v]) + '"' + (type || '') + ' autocomplete="off"' +
        (uit ? ' disabled' : '') + '>' + (extra || '') + '<div class="veld-status" data-status="' + v + '"></div></div>';
    };
    var mail = ' type="email" inputmode="email" autocapitalize="off"';
    var merken = (laatsteMerken || []).map(function (m) {
      return '<option value="' + esc(m.naam) + '"' + (m.naam === p.merk ? ' selected' : '') + '>' + esc(m.naam) + '</option>';
    }).join('');
    return veld('voornaam_contact', 'Voornaam', '', '<div class="klein">Van de contactpersoon; gebruikt in mails en WhatsApp ' +
        '("Hoi …").</div>') +
      veld('achternaam_contact', 'Achternaam') +
      veld('email', 'E-mail partner', mail) +
      veld('mobiel_partner', 'Mobiel partner', ' type="tel" inputmode="tel" placeholder="Bijv. 0612345678"', '<div class="klein">Nodig ' +
        'voor uitnodigen via WhatsApp.</div>') +
      '<div class="veld" data-rij="merk"><label for="v-merk">Merk</label><select id="v-merk" data-veld="merk"' +
        (uit ? ' disabled' : '') + '>' + merken + '</select><div class="veld-status" data-status="merk"></div></div>' +
      '<div class="veld" data-rij="kanaal"><label for="v-kanaal">Kanaal</label><select id="v-kanaal" data-veld="kanaal"' +
        (uit ? ' disabled' : '') + '><option value="mail"' + (p.kanaal !== 'whatsapp' ? ' selected' : '') + '>Mail (automatisch)</option>' +
        '<option value="whatsapp"' + (p.kanaal === 'whatsapp' ? ' selected' : '') + '>WhatsApp (zelf sturen)</option></select>' +
        '<div class="veld-status" data-status="kanaal"></div></div>' +
      veld('stad', 'Stad (vestigingsnaam)') +
      (zonderCf ? '' : veld('customer_facing_email', 'Customer-facing e-mailadres', mail,
        '<div class="klein">Moet uniek zijn over alle partners.</div>')) +
      veld('email_doorsturen', 'Eigen mailadres voor doorsturen', mail, '<div class="klein">Hierheen wordt ' +
        esc(p.customer_facing_email) + ' na tekenen doorgestuurd.</div>') +
      // Shakes: ook na tekenen aan te passen (bijv. na nabellen); apart opgeslagen (partnerZetShakes).
      (p.status !== 'Geannuleerd' ? '<div class="veld" data-rij="shakes-beheer"><label for="v-shakes-beheer">Shakes</label>' +
        '<select id="v-shakes-beheer" data-shakes-beheer>' + [['', 'Nog niet gekozen'], ['ja', 'Ja (proef)'],
          ['later', 'Later beslissen – nabellen'], ['nee', 'Nee – categorie uitzetten']].map(function (o) {
          return '<option value="' + o[0] + '"' + (String(p.shakes || '') === o[0] ? ' selected' : '') + (o[0] ? '' : ' disabled') + '>' +
            esc(o[1]) + '</option>';
        }).join('') + '</select><div class="veld-status" data-status="shakes-beheer"></div></div>' : '') +
      (['Getekend', 'Geannuleerd'].indexOf(p.status) === -1 ?
        '<button class="knop gevaar mt" data-actie="annuleren">Partner annuleren</button>' : '');
  }

  function statusUitleg(p) {
    var t = {
      'Samen invullen': ['info', 'Vul het formulier samen in. Alles wordt per veld opgeslagen. Klaar? Klik op "Ingevuld".'],
      'Aangemaakt': ['info', 'De partner vult zelf in. Nodig de partner uit via "⋯ Beheer" (mail of WhatsApp).'],
      'Uitgenodigd': ['info', 'Uitgenodigd' + (p.uitnodiging_verstuurd_op ? ' op ' + p.uitnodiging_verstuurd_op : '') +
        '. De partner heeft nog niets ingevuld. Herinneringen gaan automatisch op dag 3, 5 en 7.'],
      'Deels ingevuld': ['info', 'De partner is bezig met invullen' + (p.formulier_opgeslagen_op ? ' (laatst opgeslagen ' +
        p.formulier_opgeslagen_op + ')' : '') + '. Herinneringen gaan automatisch op dag 3, 5 en 7.'],
      'Te tekenen': ['info', 'Akkoord gegeven' + (p.gecontroleerd_op ? ' op ' + p.gecontroleerd_op : '') + '. ' +
        (p.teken_verstuurd_op ? 'De tekenlink is verstuurd op ' + p.teken_verstuurd_op + ' (zie de kaart "Overeenkomst").' :
          p.kanaal === 'whatsapp' ? 'Je krijgt een melding om de tekenlink via WhatsApp te sturen.' :
          'De tekenlink wordt automatisch per mail verstuurd zodra de stukken klaar zijn.')],
      'Getekend': ['info', 'Getekend' + (p.getekend_op ? ' op ' + p.getekend_op : '') + (p.teken_naam ? ' door ' + p.teken_naam +
        (p.teken_functie ? ' (' + p.teken_functie + ')' : '') : '') + '. Alles daarna gaat automatisch (kaart "Getekend").'],
      'Geannuleerd': ['let', 'Deze partner is geannuleerd' + (p.geannuleerd_op ? ' op ' + p.geannuleerd_op : '') + '.']
    }[p.status];
    return t ? '<div class="melding-blok mb-' + t[0] + '">' + esc(t[1]) + '</div>' : '';
  }

  // ---------- Scherm 2: afronden (na "Ingevuld" bij samen invullen) ----------
  function toonAfronden() {
    $('detailInhoud').innerHTML = '<div class="afronden"><h1>Bedankt!</h1><p>Je gegevens zijn compleet. Virtualbite ' +
      'controleert alles en je ontvangt de overeenkomst per mail.</p>' +
      '<button class="knop" data-actie="terug">Terug naar overzicht</button></div>';
    $('detail').scrollTop = 0;
  }

  // ---------- Kaart "Overeenkomst" (status Te tekenen; fase 4b) ----------
  var verversTimer = null;

  /** Kaart "Getekend": wat er na tekenen automatisch is gedaan, met links naar de stukken. */
  function getekendKaartHtml(p) {
    var v = p.verwerkt || {};
    var stappen = [['pdf', 'Getekende overeenkomst (PDF)'],
      ['koppel', p.customer_facing_email ? 'Mailadres ' + p.customer_facing_email : 'Mailadres @chickito.nl'], ['tb', 'TB-formulier'],
      ['mail', 'Getekende stukken naar partner'], ['tbmail', 'Aanmelding Thuisbezorgd'],
      ['shopify', 'Shopify-klant' + (p.lm_klantnummer ? ' (nr. ' + p.lm_klantnummer + ')' : '')],
      ['portaal', 'Uitnodiging bestelportaal'], ['lijst', 'Partnerlijst'], ['lm', 'Mail aan Leen Menken'], ['melding', 'Melding aan jou']];
    var inricht = ['shopify', 'portaal', 'lijst', 'lm'];
    var stand = function (x, stap) {
      return x === 'ok' ? '✓' : x === 'nvt' ? (inricht.indexOf(stap) !== -1 ? 'n.v.t. (handmatig gedaan)' : 'n.v.t.') :
        x === 'uit' ? 'uitgezet' : x === 'droog' ? 'droogloop (niets gedaan)' :
        x === 'concept' ? 'klaar als concept' : x === 'fout' ? 'mislukt (wordt dagelijks opnieuw geprobeerd)' : 'bezig…';
    };
    var link = function (url, tekst) { return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(tekst) + '</a>' : ''; };
    var s = p.stukken || {};
    return '<section class="kaart" id="tekenKaart"><h2>Getekend</h2><dl>' +
      stappen.map(function (x) {
        return '<div><dt>' + esc(x[1]) + '</dt><dd>' + esc(stand(v[x[0]], x[0])) + (x[0] === 'lm' && v.lm === 'concept' ?
          ' <button type="button" class="klein-knop" data-actie="lm-versturen">Versturen</button>' : '') + '</dd></div>';
      }).join('') +
      '<div><dt>Stukken</dt><dd>' + [link(s.overeenkomst, 'Overeenkomst (getekend)'), link(s.tb, 'TB-formulier (getekend)'),
        link(s.zwh, 'Zo werkt het'), link(s.av, 'Algemene Partnervoorwaarden'), link(s.map, 'Map in Drive')].filter(Boolean).join('<br>') +
      '</dd></div></dl>' + (stappen.some(function (x) { return v[x[0]] === 'fout'; }) ?
        '<div class="knoppen-rij"><button type="button" class="klein-knop" data-actie="verwerk-opnieuw">Opnieuw proberen</button></div>' : '') +
      '</section>' + bestellingKaartHtml(p) + planningKaartHtml(p.planning);
  }

  // ---------- Kaart "Eerste bestelling" (startpakket; Bestelling.js) ----------
  // Open formulier per partner in het geheugen, zodat het verversen van het detail de ingevulde aantallen niet wist.
  var bestelOpen = null; // {id, startpakket, leveropties, droog, aantallen: {sku: n}, datum}

  function euro(x) { return '€ ' + Number(x || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  function bestellingKaartHtml(p) {
    var e = p.eerste_bestelling || {};
    var h = '<section class="kaart" id="bestelKaart"><h2>Eerste bestelling</h2>';
    if (e.op) {
      h += '<dl><div><dt>Geplaatst</dt><dd>' + esc(e.op + (e.order ? ' – ' + e.order : '')) + '</dd></div>' +
        '<div><dt>Levering</dt><dd>' + esc(e.levering) + '</dd></div>' +
        (e.bedrag !== null && e.bedrag !== undefined ? '<div><dt>Totaal</dt><dd>' + esc(euro(e.bedrag)) + '</dd></div>' : '') + '</dl>';
    } else if (e.droog_op) {
      h += '<p class="klein">Testpartner: droogloop gedaan op ' + esc(e.droog_op) + ' (niets in Shopify).</p>';
    } else {
      h += '<p class="klein">Het startpakket (tab Startpakket) als eerste bestelling in het bestelportaal plaatsen: Net 15, ' +
        'geen bezorgkosten. De partner krijgt de gewone orderbevestiging van Shopify.' + (p.test ? ' Testpartner: alleen een droogloop.' : '') + '</p>';
    }
    var b = bestelOpen && bestelOpen.id === p.id ? bestelOpen : null;
    if (!b) {
      return h + '<div class="knoppen-rij"><button type="button" class="klein-knop" data-actie="bestel-open">' +
        (e.op ? 'Nog een eerste bestelling…' : 'Eerste bestelling samenstellen') + '</button></div></section>';
    }
    if (b.laden) return h + '<p class="klein">Startpakket en leverdata ophalen…</p></section>';
    if (!b.startpakket.length) {
      return h + '<div class="melding-blok mb-let">Tab Startpakket is leeg.</div></section>';
    }
    h += '<table class="bestel-tabel"><thead><tr><th>Product</th><th>Aantal</th></tr></thead><tbody>' +
      b.startpakket.map(function (r) {
        return '<tr><td>' + esc(r.productnaam || r.sku) + '<div class="klein">' + esc(r.sku) + '</div></td>' +
          '<td><input type="number" min="0" step="1" inputmode="numeric" class="bestel-aantal" data-sku="' + esc(r.sku) +
          '" value="' + esc(String(b.aantallen[r.sku] || 0)) + '" aria-label="Aantal ' + esc(r.productnaam || r.sku) + '"></td></tr>';
      }).join('') + '</tbody></table>' +
      '<label for="bestelDatum">Leverdatum</label><select id="bestelDatum">' +
      b.leveropties.map(function (o) {
        return '<option value="' + esc(o.datum) + '"' + (o.datum === b.datum ? ' selected' : '') + '>' + esc(o.label) +
          (o.vast ? '' : ' (afwijkende dag)') + ' – bestellen vóór ' + esc(o.deadline) + '</option>';
      }).join('') + '</select>' +
      '<div class="knoppen-rij"><button type="button" class="klein-knop" data-actie="bestel-plaatsen">' +
      (b.droog ? 'Droogloop' : 'Bestelling plaatsen') + '</button>' +
      '<button type="button" class="klein-knop" data-actie="bestel-sluit">Annuleer</button></div></section>';
    return h;
  }

  function bestelOpenen(knop) {
    var id = huidig.id;
    bestelOpen = { id: id, laden: true };
    toonDetailBehoud();
    roep('eersteBestellingStart', [id]).then(function (d) {
      if (!bestelOpen || bestelOpen.id !== id) return;
      var aantallen = {};
      d.startpakket.forEach(function (r) { aantallen[r.sku] = r.aantal; });
      bestelOpen = { id: id, startpakket: d.startpakket, leveropties: d.leveropties, droog: d.droog, aantallen: aantallen,
        datum: d.leveropties.length ? d.leveropties[0].datum : '' };
      if (huidig && huidig.id === id) toonDetailBehoud();
    }).catch(function (err) { bestelOpen = null; if (huidig && huidig.id === id) toonDetailBehoud(); toon(err.message, true); });
  }

  function toonDetailBehoud() { var top = $('detail').scrollTop; toonDetail(huidig); $('detail').scrollTop = top; }

  /** Bevestigingsvenster met HTML-inhoud (al ge-escaped). */
  function bevestigHtml(titel, html, jaTekst) {
    return new Promise(function (klaar) {
      var achter = document.createElement('div');
      achter.className = 'dialoog-achter';
      achter.innerHTML = '<div class="dialoog groot" role="dialog" aria-modal="true" aria-labelledby="d-titel">' +
        '<h2 id="d-titel">' + esc(titel) + '</h2>' + html + '<div class="dialoog-knoppen">' +
        '<button class="knop licht" data-k="nee">Annuleer</button><button class="knop" data-k="ja">' + esc(jaTekst) + '</button></div></div>';
      function sluit(uitkomst) { achter.remove(); document.removeEventListener('keydown', toets); klaar(uitkomst); }
      function toets(ev) { if (ev.key === 'Escape') sluit(false); }
      achter.addEventListener('click', function (ev) {
        if (ev.target === achter) sluit(false);
        var k = ev.target.getAttribute('data-k');
        if (k) sluit(k === 'ja');
      });
      document.addEventListener('keydown', toets);
      document.body.appendChild(achter);
      achter.querySelector('[data-k="ja"]').focus();
    });
  }

  function bestelPlaatsen(knop) {
    var b = bestelOpen;
    if (!b || b.laden) return;
    var id = b.id;
    var herstel = bezig(knop, 'Prijzen berekenen…');
    roep('eersteBestellingBereken', [id, b.aantallen, b.datum]).then(function (c) {
      herstel();
      var html = '<table class="bestel-tabel"><thead><tr><th>Product</th><th>Aantal</th><th>Bedrag</th></tr></thead><tbody>' +
        c.regels.map(function (r) {
          return '<tr><td>' + esc(r.naam) + '</td><td>' + esc(String(r.aantal)) + '</td><td>' + esc(euro(r.totaal)) + '</td></tr>';
        }).join('') + '</tbody></table><p>' +
        (c.indicatief ? 'Totaal (lijstprijzen, indicatief): ' + esc(euro(c.totaal)) :
          'Subtotaal ' + esc(euro(c.subtotaal)) + ' + btw ' + esc(euro(c.btw)) + ' = <strong>' + esc(euro(c.totaal)) + '</strong>') +
        '<br>Geen bezorgkosten · betaaltermijn Net 15<br>Levering: <strong>' + esc(c.levermoment) + '</strong>' +
        (c.afwijking ? ' (afwijkende dag: "Eerste bestelling (startpakket)")' : '') + '</p>' +
        (c.droog ? '<div class="melding-blok mb-let">Testpartner: droogloop. Er wordt niets in Shopify geplaatst; je krijgt een ' +
          '[TEST]-mail met deze bestelling.</div>' : '') +
        (c.al_geplaatst ? '<div class="melding-blok mb-let">Let op: er is al een eerste bestelling geplaatst (' + esc(c.geplaatst_op) +
          '). Dit wordt een tweede order.</div>' : '');
      return bevestigHtml(c.droog ? 'Droogloop eerste bestelling' : 'Bestelling plaatsen?', html, c.droog ? 'Droogloop' : 'Plaatsen')
        .then(function (ja) {
          if (!ja) return null;
          if (!c.al_geplaatst) return true;
          return bevestig('Echt een tweede order?', 'Er staat al een eerste bestelling in Shopify. Weet je zeker dat je nóg een ' +
            'order wilt plaatsen?', 'Ja, nog een order', true);
        }).then(function (ja) {
          if (!ja) return;
          var herstel2 = bezig(knop, c.droog ? 'Droogloop…' : 'Plaatsen…');
          return roep('eersteBestellingPlaatsen', [id, b.aantallen, b.datum, c.al_geplaatst]).then(function (r) {
            herstel2();
            bestelOpen = null;
            toon(c.droog ? 'Droogloop gedaan (niets in Shopify).' : 'Bestelling geplaatst: ' + (r.eerste_bestelling || {}).order + '.');
            zetHuidig(r);
            toonDetailBehoud();
          }, function (err) { herstel2(); toon(err.message, true); });
        });
    }).catch(function (err) { herstel(); toon(err.message, true); });
  }

  // Shakes in "⋯ Beheer" (ook na tekenen): meteen opslaan
  document.addEventListener('change', function (ev) {
    var sel = ev.target.closest && ev.target.closest('[data-shakes-beheer]');
    if (!sel || !huidig) return;
    var id = huidig.id;
    var st = document.querySelector('[data-status="shakes-beheer"]');
    if (st) st.textContent = 'Opslaan…';
    roep('shakes', [id, sel.value]).then(function (r) {
      if (huidig && huidig.id === id) { zetHuidig(r); details[id] = r; }
      if (st) st.textContent = 'Opgeslagen';
      if (lijstCache) lijstCache.forEach(function (x) { if (x.id === id) x.shakes = sel.value; });
    }).catch(function (err) { if (st) st.textContent = ''; toon(err.message, true); });
  });

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!bestelOpen || bestelOpen.laden) return;
    if (t.classList && t.classList.contains('bestel-aantal')) {
      bestelOpen.aantallen[t.getAttribute('data-sku')] = Math.max(0, Math.floor(Number(t.value) || 0));
    }
    if (t.id === 'bestelDatum') bestelOpen.datum = t.value;
  });
  document.addEventListener('change', function (ev) {
    if (bestelOpen && !bestelOpen.laden && ev.target.id === 'bestelDatum') bestelOpen.datum = ev.target.value;
  });

  /** Kaart "Onboarding en training": wat de partner heeft gekozen (agendawijzigingen van jou worden overgenomen). */
  function planningKaartHtml(pl) {
    if (!pl) return '';
    var regel = function (label, waarde) { return '<div><dt>' + esc(label) + '</dt><dd>' + esc(waarde) + '</dd></div>'; };
    var h = '<section class="kaart" id="planKaart"><h2>Onboarding en training</h2>';
    if (pl.verwijderd) h += '<div class="melding-blok mb-let">Een afspraak is uit je agenda verwijderd. Laat de partner opnieuw kiezen of plan ' +
      'zelf.</div>';
    var nogTeKiezen = pl.soort === 'onboarding' ? 'Onboarding' : pl.soort === 'training' ? 'Training' : 'Onboarding en training';
    h += '<dl>' + (!pl.open ? regel('Gepland', pl.gepland.join('\n')) + regel('Gekozen op', pl.gepland_op) :
      regel('Gepland', pl.gepland.length ? pl.gepland.join('\n') : 'Nog niet gekozen') + regel('Nog te kiezen', nogTeKiezen) +
      regel('Kiezen', 'Van ' + pl.vanaf + ' tot en met ' + pl.tot) +
      regel('Planlink', 'Verstuurd ' + pl.link_op) +
      regel('Herinneringen', pl.herinneringen.length ? pl.herinneringen.join('\n') : 'Dag 2 en 4 (partner en jij), dag 6 (alleen jij)')) +
      '</dl><div class="knoppen-rij">' +
      (pl.link ? '<a class="klein-knop" href="' + esc(pl.link) + '" target="_blank" rel="noopener">Planpagina openen</a>' : '') +
      '<button type="button" class="klein-knop" data-actie="plan-opnieuw">Opnieuw laten kiezen</button></div></section>';
    return h;
  }

  function tekenKaartHtml(p) {
    if (p.status === 'Getekend') return getekendKaartHtml(p);
    if (p.status !== 'Te tekenen') return '';
    var regel = function (label, waarde, html) {
      return '<div><dt>' + esc(label) + '</dt><dd>' + (html ? waarde : esc(waarde)) + '</dd></div>';
    };
    var link = function (url, tekst) { return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(tekst) + '</a>' : ''; };
    var h = '<section class="kaart" id="tekenKaart"><h2>Overeenkomst</h2>';
    if (p.contract_status === 'maken') {
      return h + '<p class="klein">De overeenkomst en "Zo werkt het" worden gemaakt (± 1 minuut). Dit scherm ververst vanzelf.</p></section>';
    }
    if (p.contract_status === 'fout') {
      return h + '<div class="melding-blok mb-let">Maken lukte niet: ' + esc(p.contract_fout || 'onbekende fout') + '</div>' +
        '<div class="knoppen-rij"><button type="button" class="klein-knop" data-actie="contract-opnieuw">Opnieuw maken</button></div></section>';
    }
    if (!p.stukken) return h + '<p class="klein">Nog geen stukken.</p></section>';
    var al = !!p.teken_verstuurd_op;
    var info = al ? 'Verstuurd op ' + p.teken_verstuurd_op + (p.laatst_teken_verstuurd_op && p.laatst_teken_verstuurd_op !==
      p.teken_verstuurd_op ? ', laatst op ' + p.laatst_teken_verstuurd_op : '') + ' via ' +
      (p.teken_via === 'whatsapp' ? 'WhatsApp' : 'mail') + (p.teken_link_geldig_tot ? '; link geldig tot ' + p.teken_link_geldig_tot : '') + '.' :
      'Nog niet verstuurd.';
    var herinneringen = (p.herinneringen_teken || []).map(function (x) {
      return 'Dag ' + x.dag + ': ' + (x.verstuurd ? 'verstuurd ' + x.verstuurd : 'gepland ' + x.gepland);
    });
    if (p.herinnering_teken_handmatig_op) herinneringen.push('Handmatig: verstuurd ' + p.herinnering_teken_handmatig_op);
    h += '<dl>' +
      regel('Stukken', [link(p.stukken.overeenkomst, 'Overeenkomst (ongetekend)'), link(p.stukken.zwh, 'Zo werkt het'),
        link(p.stukken.av, 'Algemene Partnervoorwaarden'), link(p.stukken.map, 'Map in Drive')].filter(Boolean).join('<br>'), true) +
      regel('Tekenlink', info) +
      regel('Herinneringen', herinneringen.length ? herinneringen.join('\n') : 'Starten na de tekenlink (dag 3, 5 en 7)') +
      '</dl><div class="knoppen-rij">' +
      '<button type="button" class="klein-knop" data-actie="tekenlink-mail">' + (al ? 'Opnieuw versturen via mail' : 'Tekenlink via mail') + '</button>' +
      '<button type="button" class="klein-knop" data-actie="tekenlink-whatsapp">' + (al ? 'Opnieuw versturen via WhatsApp' : 'Tekenlink via WhatsApp') + '</button>' +
      (al ? '<button type="button" class="klein-knop" data-actie="teken-herinnering-nu">Herinnering nu sturen</button>' : '') +
      '</div></section>';
    return h;
  }

  /**
   * Zolang de stukken worden gemaakt of de tekenlink nog niet weg is (automatische mail of WhatsApp-melding): elke 20 s
   * het detail verversen, alleen als dezelfde partner nog open staat; hooguit ±10 minuten.
   */
  var verversRondes = 0;
  var verversId = '';
  function planVerversen(p) {
    clearTimeout(verversTimer);
    if (verversId !== p.id) { verversId = p.id; verversRondes = 0; }
    var v = p.verwerkt || {};
    var bezig = p.status === 'Getekend' && (['pdf', 'tb', 'mail', 'tbmail', 'koppel', 'melding'].some(function (s) { return !v[s]; }) ||
      (!!v.shopify && ['portaal', 'lijst', 'lm'].some(function (s) { return !v[s]; }))); // inrichten (alleen als het al loopt)
    var wacht = bezig || (p.status === 'Te tekenen' && !p.getekend_op &&
      (p.contract_status === 'maken' || (p.contract_status === 'klaar' && !p.teken_verstuurd_op)));
    if (!wacht) { verversRondes = 0; return; }
    if (++verversRondes > 30) return;
    verversTimer = setTimeout(function () {
      if (!huidig || huidig.id !== p.id) return;
      roep('detail', [p.id]).then(function (vers) {
        if (!huidig || huidig.id !== p.id) return;
        var top = $('detail').scrollTop;
        toonDetail(vers);
        $('detail').scrollTop = top;
      }).catch(function () { planVerversen(p); });
    }, 20000);
  }

  // ---------- Scherm 3: controle (Dimitri) ----------
  function toonControle(p) {
    var uit = p.status !== 'Wacht op controle';
    var h = kopHtml(p, false) + statusUitleg(p) + tekenKaartHtml(p);
    planVerversen(p);
    h += '<section class="kaart" id="controle"><h2>In te vullen door Virtualbite</h2>' + controleVelden(p, uit) + '</section>';
    h += '<div id="controleFouten"></div>';
    FORMULIER_STAPPEN.forEach(function (stap, i) {
      if (stap.titel === 'Bezorggebied') return; // staat bovenaan
      var open = bewerkStap === i && !uit;
      h += '<section class="kaart" data-stap="' + i + '"><div class="kaart-kop"><h2>' + esc(stap.titel) + '</h2>' +
        (uit ? '' : '<button type="button" class="tekst-knop" data-actie="' + (open ? 'klaar-stap' : 'wijzig-stap') +
          '" data-stap="' + i + '">' + (open ? 'Klaar' : 'Wijzig') + '</button>') + '</div>' +
        (open ? f.stapVelden(stap, p, false) : samenvatting(stap, p)) + '</section>';
    });
    if (!uit) {
      h += '<div class="acties twee"><button class="knop licht" data-actie="aanpassing-vragen">Aanpassing vragen</button>' +
        '<button class="knop hoofd" data-actie="akkoord">Akkoord</button></div>';
    }
    if (p.status === 'Te tekenen' && !p.getekend_op) {
      h += '<div class="acties"><button class="knop licht" data-actie="terug-controle">Terug naar controle</button></div>';
    }
    $('detailInhoud').innerHTML = h;
    f.naTekenen();
    werkVoorbeeldBij();
    toonControleFouten(p.controle_fouten, p.waarschuwingen_formulier);
  }

  /** "Op Thuisbezorgd: Chickito Chicken - Amsterdam Oost": exact de naam van de vestiging op Thuisbezorgd. */
  function vestigingVoorbeeld(p, naam) {
    var n = String(naam || '').replace(/\s+/g, ' ').trim();
    return 'Op Thuisbezorgd: ' + (p.merk || 'Chickito Chicken') + ' - ' + (n || 'Amsterdam Oost') + (n ? '' : ' (voorbeeld)') +
      '. Ook in het TB-formulier en de aanmeldmail.';
  }

  function controleVelden(p, uit) {
    var dis = uit ? ' disabled' : '';
    var heeftUitzondering = !!String(p.openingstijden_uitzondering || '').trim();
    var veld = function (v, label, invoer, extra) {
      return '<div class="veld" data-rij="' + v + '"><label for="v-' + v + '">' + esc(label) + '</label>' + invoer + (extra || '') +
        '<div class="veld-status" data-status="' + v + '"></div></div>';
    };
    return veld('fee_percentage', 'Fee-percentage', '<input id="v-fee_percentage" data-veld="fee_percentage" inputmode="decimal" value="' +
        esc(String(p.fee_percentage == null ? '' : p.fee_percentage).replace('.', ',')) + '" placeholder="Bijv. 9"' + dis + '>',
        '<div class="voorbeeld" id="voorbeeld"></div>') +
      // Leeg: tekstveld met "Kies een datum" (een leeg datumveld toont in Safari de datum van vandaag in grijs).
      veld('startdatum', 'Startdatum', '<input id="v-startdatum" data-veld="startdatum" data-datum type="' +
        (p.startdatum ? 'date' : 'text') + '" placeholder="Kies een datum" value="' + esc(p.startdatum) + '"' + dis + '>') +
      veld('vestigingsnaam', 'Vestigingsnaam', '<input id="v-vestigingsnaam" data-veld="vestigingsnaam" autocomplete="off" value="' +
        esc(p.vestigingsnaam || p.stad || '') + '" placeholder="Bijv. Amsterdam Oost"' + dis + '>',
        '<div class="klein" id="vestigingVoorbeeld">' + esc(vestigingVoorbeeld(p, p.vestigingsnaam || p.stad || '')) + '</div>') +
      veld('customer_facing_email', 'Customer-facing e-mailadres', '<input id="v-customer_facing_email" data-veld="customer_facing_email" ' +
        'type="email" inputmode="email" autocapitalize="off" value="' + esc(p.customer_facing_email) + '"' + dis + '>',
        '<div class="klein">Afgeleid van de vestigingsnaam (bijv. amsterdamoost@chickito.nl); aanpasbaar. Moet uniek zijn. ' +
        'Na tekenen stuurt dit adres door naar het eigen adres van de partner.</div>') +
      merkenVelden(p, uit) + tbAanmeldenVeld(p, uit) +
      '<div class="veld"><div class="label">Openingstijden</div><div class="klein">Minimaal ' + esc(openingsMinimum()) +
        ' op vrijdag, zaterdag, zondag en minimaal 2 andere dagen.</div>' +
        '<div id="uitzondering"' + (heeftUitzondering ? '' : ' hidden') + '>' +
        veld('openingstijden_uitzondering', 'Reden uitzondering', '<input id="v-openingstijden_uitzondering" ' +
          'data-veld="openingstijden_uitzondering" value="' + esc(p.openingstijden_uitzondering) + '" placeholder="Bijv. de zaak sluit om 20:00"' + dis + '>') +
        veld('openingstijden_minimum', 'Afwijkende minimale tijd', '<input id="v-openingstijden_minimum" data-veld="openingstijden_minimum" ' +
          'value="' + esc(p.openingstijden_minimum) + '" placeholder="Bijv. 17:00-20:00" inputmode="numeric"' + dis + '>') + '</div>' +
        (uit ? '' : '<button type="button" class="klein-knop mt" data-actie="uitzondering">' +
          (heeftUitzondering ? 'Uitzondering verwijderen' : 'Uitzondering openingstijden') + '</button>') + '</div>' +
      '<div class="veld" data-rij="bezorggebied"><div class="label">Bezorggebied en bedragen per rij</div>' + f.rijenHtml(p, uit) +
        '<div class="klein" id="afstandInfo" hidden></div><div class="klein afstand-status" id="afstandStatus" hidden></div>' +
        (uit ? '' : '<button type="button" class="klein-knop mt" data-actie="afstanden">Afstanden opnieuw berekenen</button>') +
        '<div class="veld-status" data-status="bezorggebied"></div></div>';
  }

  /** Schakelaar "TB-aanmelding versturen" (standaard aan): uit = na tekenen geen aanmeldmail naar Thuisbezorgd/JET. */
  function tbAanmeldenVeld(p, uit) {
    var aan = p.tb_aanmelden !== 'nee';
    var dis = uit ? ' disabled' : '';
    return '<div class="veld" data-rij="tb_aanmelden"><div class="label">TB-aanmelding versturen</div>' +
      '<div class="keuze" data-keuze="tb_aanmelden" role="group" aria-label="TB-aanmelding versturen">' +
      [['ja', 'Aan'], ['nee', 'Uit']].map(function (k) {
        return '<button type="button" data-waarde="' + k[0] + '" aria-pressed="' + (aan === (k[0] === 'ja')) + '"' + dis + '>' + k[1] + '</button>';
      }).join('') + '</div><div class="klein">Uit: na het tekenen gaat er geen aanmeldmail naar Thuisbezorgd (bijv. al aangemeld). Het ' +
      'TB-formulier gaat wel mee in de mail aan de partner.</div><div class="veld-status" data-status="tb_aanmelden"></div></div>';
  }

  /** Andere virtuele merken (alleen Virtualbite): standaard Nee → "GEEN" in de overeenkomst; bij Ja welke merken. */
  function merkenVelden(p, uit) {
    var ja = p.externe_merken_ja === 'ja';
    var dis = uit ? ' disabled' : '';
    return '<div class="veld" data-rij="externe_merken_ja"><div class="label">Draaien er al andere virtuele merken vanuit de zaak?</div>' +
      '<div class="keuze" data-keuze="externe_merken_ja" role="group" aria-label="Andere virtuele merken">' +
      [['ja', 'Ja'], ['nee', 'Nee']].map(function (k) {
        return '<button type="button" data-waarde="' + k[0] + '" aria-pressed="' + (ja === (k[0] === 'ja')) + '"' + dis + '>' + k[1] + '</button>';
      }).join('') + '</div><div class="klein">In de overeenkomst: de merken, of "GEEN".</div>' +
      '<div class="veld-status" data-status="externe_merken_ja"></div></div>' +
      '<div class="veld" data-rij="externe_merken" id="merkenWelke"' + (ja ? '' : ' hidden') + '><label for="v-externe_merken">Welke merken?</label>' +
      '<input id="v-externe_merken" data-veld="externe_merken" value="' + esc(p.externe_merken) + '" placeholder="Bijv. Burger Brothers, ' +
      'Wok Express" autocomplete="off"' + dis + '><div class="veld-status" data-status="externe_merken"></div></div>';
  }

  /** Samenvatting van een stap (alleen-lezen), in de volgorde van het formulier. */
  function samenvatting(stap, p) {
    return VBSamenvatting(stap, p, true);
  }

  function werkVoorbeeldBij() {
    var el = $('voorbeeld');
    if (!el) return;
    try {
      el.textContent = 'Rekenvoorbeeld "Zo werkt het": ' + rekenvoorbeeld($('v-fee_percentage').value).tekst;
    } catch (e) {
      el.textContent = 'Vul een percentage in, bijv. 9 of 9,5.';
    }
  }

  var EXTRA_LABELS = { externe_merken: 'Welke merken', externe_merken_ja: 'Andere virtuele merken', fee_percentage: 'Fee-percentage', startdatum: 'Startdatum', bezorggebied: 'Bezorggebied',
    customer_facing_email: 'Customer-facing e-mailadres', vestigingsnaam: 'Vestigingsnaam', openingstijden_minimum: 'Afwijkende minimale tijd' };

  function toonControleFouten(fouten, waarschuwingen) {
    var el = $('controleFouten');
    if (!el) return;
    var k = Object.keys(fouten || {});
    var w = Object.keys(waarschuwingen || {}).filter(function (v) { return !(fouten || {})[v]; });
    el.innerHTML = (k.length ? '<div class="melding-blok mb-let">Nog niet klaar voor akkoord:<ul>' + k.map(function (v) {
      return '<li>' + esc(f.veldLabel(v, EXTRA_LABELS)) + ': ' + esc(fouten[v]) + '</li>';
    }).join('') + '</ul></div>' : '') + (w.length ? '<div class="melding-blok mb-info">' + w.map(function (v) {
      return esc(f.veldLabel(v, EXTRA_LABELS)) + ': ' + esc(waarschuwingen[v]);
    }).join('<br>') + '</div>' : '');
  }

  // ---------- Hoofdknoppen: groen als alles klopt, anders gedimd (wel klikbaar: dan verschijnen de meldingen) ----------
  function klaarVoorAkkoord() {
    if (!f.klaarVoorIngevuld()) return false;
    var fee = $('v-fee_percentage');
    var start = $('v-startdatum');
    var cf = $('v-customer_facing_email');
    if (!fee || isNaN(leesPercentage(fee.value)) || !start || !start.value) return false;
    if (cf && !normaliseerCfAdres(cf.value, inst.cf_domein)) return false;
    if (huidig.externe_merken_ja === 'ja' && !String(huidig.externe_merken || '').trim()) return false;
    var c = controleerBezorggebied(f.rijenUitScherm());
    if (c.fouten.length) return false;
    var reden = $('v-openingstijden_uitzondering');
    var min = $('v-openingstijden_minimum');
    var heeftUitzondering = reden && reden.value.trim() && !$('uitzondering').hidden;
    if (heeftUitzondering && !normaliseerTijdvak(min.value)) return false;
    return !dagenOnderMinimum(huidig.bezorgtijden, heeftUitzondering ? normaliseerTijdvak(min.value) : openingsMinimum()).length;
  }

  function werkKnoppenBij() {
    var ingevuld = document.querySelector('#detailInhoud [data-actie="ingevuld"]');
    if (ingevuld && huidig) ingevuld.classList.toggle('klaar', f.klaarVoorIngevuld());
    var akkoord = document.querySelector('#detailInhoud [data-actie="akkoord"]');
    if (akkoord && huidig) akkoord.classList.toggle('klaar', klaarVoorAkkoord());
  }

  // ---------- Acties van de beheerpagina (velden zelf: gedeeld/formulier.js) ----------
  $('detailInhoud').addEventListener('input', function (e) {
    if (e.target.id === 'v-vestigingsnaam' && $('vestigingVoorbeeld') && huidig) {
      $('vestigingVoorbeeld').textContent = vestigingVoorbeeld(huidig, e.target.value);
      // Customer-facing adres volgt de vestigingsnaam, zolang Dimitri het niet zelf heeft aangepast.
      var cfEl = $('v-customer_facing_email');
      if (cfEl && !cfEl.disabled) {
        var afgeleid = cfEl.getAttribute('data-afgeleid') || cfVoorstel(huidig.vestigingsnaam || huidig.stad, inst.cf_domein);
        var nieuw = cfVoorstel(e.target.value, inst.cf_domein);
        if (nieuw && cfEl.value.trim().toLowerCase() === afgeleid) {
          cfEl.value = nieuw;
          cfEl.setAttribute('data-afgeleid', nieuw);
          cfEl.dispatchEvent(new Event('input', { bubbles: true })); // opslaan + uniekcontrole zoals bij typen
        }
      }
    }
  });

  $('detailInhoud').addEventListener('click', function (e) {
    var merk = e.target.closest('[data-keuze="externe_merken_ja"] button');
    if (merk && !merk.disabled && $('merkenWelke')) { // opslaan doet gedeeld/formulier.js
      $('merkenWelke').hidden = merk.getAttribute('data-waarde') !== 'ja';
      if (!$('merkenWelke').hidden) $('v-externe_merken').focus();
      return;
    }
    var knop = e.target.closest('[data-actie]');
    if (!knop || !huidig) {
      if (knop && knop.getAttribute('data-actie') === 'terug') { sluitDetail(); laad(); }
      return;
    }
    var actie = knop.getAttribute('data-actie');
    if (actie === 'terug') { f.slaWachtendOp(); sluitDetail(); laad(); return; }
    if (actie === 'beheermenu') {
      var menu = $('beheerMenu');
      menu.hidden = !menu.hidden;
      knop.setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    if (actie === 'tekenlink-mail') return uitnodigen(knop, 'mail', 'tekenlink');
    if (actie === 'tekenlink-whatsapp') return uitnodigen(knop, 'whatsapp', 'tekenlink');
    if (actie === 'teken-herinnering-nu' || actie === 'contract-opnieuw') {
      var herstelT = bezig(knop, actie === 'contract-opnieuw' ? 'Bezig…' : 'Versturen…');
      roep(actie === 'contract-opnieuw' ? 'contractOpnieuw' : 'tekenHerinneringNu', [huidig.id]).then(function (r) {
        herstelT(); toon(actie === 'contract-opnieuw' ? 'De stukken worden opnieuw gemaakt.' : 'Herinnering verstuurd.'); toonDetail(r);
        if (actie === 'contract-opnieuw') stukkenNu(r.id);
      }).catch(function (err) { herstelT(); toon(err.message, true); });
      return;
    }
    if (actie === 'uitnodigen-mail') return uitnodigen(knop, 'mail');
    if (actie === 'uitnodigen-whatsapp') return uitnodigen(knop, 'whatsapp');
    if (actie === 'herinnering-nu') {
      var herstelH = bezig(knop, 'Versturen…');
      f.slaWachtendOp().then(function () { return roep('herinneringNu', [huidig.id]); }).then(function (r) {
        herstelH(); toon('Herinnering verstuurd.'); toonDetail(r); openMenuBuitenStatuskaart();
      }).catch(function (err) { herstelH(); toon(err.message, true); });
      return;
    }
    if (actie === 'aanpassing-vragen') return aanpassingVragen(knop);
    if (actie === 'lm-versturen') {
      bevestig('Mail aan Leen Menken versturen?', 'Het concept met de nieuwe leverlocatie en de partnerlijst gaat naar Leen Menken ' +
        '(m.verdouw@leenmenken.nl, cc customeronboarding@). Je kunt het concept eerst in Gmail bekijken.', 'Versturen').then(function (ja) {
        if (ja) statusActie(knop, 'lmVersturen', 'Versturen…', 'Mail aan Leen Menken verstuurd.');
      });
      return;
    }
    if (actie === 'bestel-open') return bestelOpenen(knop);
    if (actie === 'bestel-sluit') { bestelOpen = null; toonDetailBehoud(); return; }
    if (actie === 'bestel-plaatsen') return bestelPlaatsen(knop);
    if (actie === 'verwerk-opnieuw') return statusActie(knop, 'verwerkOpnieuw', 'Bezig…', 'De mislukte stappen worden opnieuw geprobeerd (± 1–3 min).');
    if (actie === 'aanpassing-mail' || actie === 'aanpassing-whatsapp') {
      var wa = actie === 'aanpassing-whatsapp';
      var vensterA = wa ? window.open('', '_blank') : null;
      var herstelA = bezig(knop, wa ? 'WhatsApp openen…' : 'Versturen…');
      roep('aanpassingSturen', [huidig.id, wa ? 'whatsapp' : 'mail']).then(function (r) {
        herstelA();
        if (vensterA && r.whatsapp_url) vensterA.location.href = r.whatsapp_url; else if (vensterA) vensterA.close();
        toon(wa ? 'WhatsApp geopend met het bericht. Druk daar zelf op verzenden.' : 'Mail opnieuw verstuurd.');
        toonDetail(r);
      }).catch(function (err) { herstelA(); if (vensterA) vensterA.close(); toon(err.message, true); });
      return;
    }
    if (actie === 'aanpassing-intrekken') {
      bevestig('Aanpassing intrekken?', 'De status gaat terug naar "Wacht op controle"; je past het dan zelf aan. De partner ' +
        'krijgt hier geen bericht over.', 'Intrekken').then(function (ja) {
        if (ja) statusActie(knop, 'aanpassingIntrekken', 'Bezig…', 'Ingetrokken. Status: Wacht op controle.');
      });
      return;
    }
    if (actie === 'plan-opnieuw') {
      kies('Wat moet opnieuw?', 'De gekozen afspraak (bij de training ook de reistijden) wordt verwijderd; de partner krijgt een ' +
        'annulering van Google Agenda en een mail om opnieuw te kiezen. De andere afspraak blijft staan.',
        [['onboarding', 'Onboarding'], ['training', 'Training'], ['beide', 'Allebei']]).then(function (soort) {
        if (!soort) return;
        var herstelP = bezig(knop, 'Bezig…');
        var pid = huidig.id;
        roep('planOpnieuw', [pid, soort]).then(function (r) {
          herstelP();
          toon('De partner krijgt een mail om ' + (soort === 'beide' ? 'onboarding en training' : 'de ' + soort) + ' opnieuw te kiezen.');
          zetHuidig(r);
          toonDetail(r);
        }).catch(function (err) { herstelP(); toon(err.message, true); });
      });
      return;
    }
    if (actie === 'terug-controle') {
      bevestig('Terug naar controle?', 'De status gaat terug naar "Wacht op controle" en je kunt alles weer aanpassen. ' +
        'Daarna geef je opnieuw akkoord.', 'Terug naar controle').then(function (ja) {
        if (ja) statusActie(knop, 'terugNaarControle', 'Bezig…', 'Terug naar controle. Status: Wacht op controle.');
      });
      return;
    }
    if (actie === 'testgegevens') {
      var herstel = bezig(knop, 'Invullen…');
      f.wachtTotOpgeslagen().then(function () { return roep('testgegevens', [huidig.id]); }).then(function (r) {
        herstel(); toon('Testgegevens ingevuld.'); toonDetail(r);
      }).catch(function (err) { herstel(); toon(err.message, true); });
      return;
    }
    if (actie === 'uitzondering') {
      var blok = $('uitzondering');
      if (blok.hidden) { blok.hidden = false; knop.textContent = 'Uitzondering verwijderen'; $('v-openingstijden_uitzondering').focus(); return; }
      $('v-openingstijden_uitzondering').value = '';
      $('v-openingstijden_minimum').value = '';
      f.bewaar('openingstijden_uitzondering', '', true);
      f.bewaar('openingstijden_minimum', '', true);
      blok.hidden = true;
      knop.textContent = 'Uitzondering openingstijden';
      return;
    }
    if (actie === 'wijzig-stap' || actie === 'klaar-stap') {
      // Direct openen/dichtklappen met wat op het scherm staat; daarna alleen de controlemeldingen vers ophalen.
      bewerkStap = actie === 'wijzig-stap' ? Number(knop.getAttribute('data-stap')) : null;
      var id = huidig.id;
      var top = $('detail').scrollTop;
      toonDetail(huidig);
      $('detail').scrollTop = top;
      f.slaWachtendOp().then(function () { return roep('detail', [id]); }).then(function (p) {
        if (!huidig || huidig.id !== id) return;
        huidig.controle_fouten = p.controle_fouten;
        huidig.waarschuwingen_formulier = p.waarschuwingen_formulier;
        toonControleFouten(p.controle_fouten, p.waarschuwingen_formulier);
      }).catch(function (err) { toon(err.message, true); });
      return;
    }
    if (actie === 'ingevuld') return statusActie(knop, 'ingevuld', 'Controleren…');
    if (actie === 'akkoord') {
      bevestig('Akkoord geven?', 'Daarna kunnen de gegevens niet meer worden gewijzigd. De overeenkomst wordt gemaakt en ' +
        'de tekenlink gaat naar de partner.', 'Akkoord').then(function (ja) {
        if (ja) statusActie(knop, 'akkoord', 'Bezig…', 'Akkoord gegeven. Status: Te tekenen.');
      });
      return;
    }
    if (actie === 'annuleren') {
      bevestig('Partner annuleren?', naamVan(huidig) + ' wordt geannuleerd. Dit kan niet ongedaan worden gemaakt.',
        'Annuleren', true).then(function (ja) {
        if (ja) statusActie(knop, 'annuleren', 'Bezig…', 'Partner geannuleerd.');
      });
    }
  });

  /**
   * Uitnodigen. WhatsApp: het venster gaat meteen open (anders blokkeert de browser het als pop-up) en krijgt het
   * bericht zodra de server de link heeft gemaakt; Dimitri drukt zelf op verzenden.
   */
  /** Uitnodiging of tekenlink (functie 'uitnodigen' of 'tekenlink') via mail of WhatsApp. */
  function uitnodigen(knop, kanaal, functie) {
    var fn = functie || 'uitnodigen';
    var venster = kanaal === 'whatsapp' ? window.open('', '_blank') : null;
    var herstel = bezig(knop, kanaal === 'mail' ? 'Versturen…' : 'WhatsApp openen…');
    f.slaWachtendOp().then(function () { return roep(fn, [huidig.id, kanaal]); }).then(function (r) {
      herstel();
      if (kanaal === 'whatsapp') {
        if (venster) venster.location.href = r.whatsapp_url;
        else window.location.href = r.whatsapp_url;
        toon('WhatsApp geopend met het bericht. Druk daar zelf op verzenden.');
      } else {
        toon(fn === 'tekenlink' ? 'Tekenlink verstuurd.' : 'Uitnodiging verstuurd.');
      }
      toonDetail(r.detail);
      if (fn !== 'tekenlink') openMenuBuitenStatuskaart();
    }).catch(function (err) {
      herstel();
      if (venster) venster.close();
      toon(err.message, true);
    });
  }

  /**
   * Eerst wachten tot alles is opgeslagen, dan de actie. Bij fouten: de gegevens opnieuw van de server laden (zodat het
   * scherm toont wat de server controleert), het blok met het eerste probleem openklappen, per veld een melding,
   * naar het eerste probleem scrollen en onderaan samenvatten wat er mist.
   */
  function statusActie(knop, fn, bezigTekst, klaarTekst) {
    var herstel = bezig(knop, bezigTekst);
    var id = huidig.id;
    var route = huidig.route;
    return f.slaWachtendOp().then(function () { return roep(fn, [id]); }).then(function (r) {
      herstel();
      if (r.fouten) return toonFouten(id, fn, r.fouten, r.detail);
      if (fn === 'akkoord') stukkenNu(id);
      zetHuidig(r);
      if (fn === 'ingevuld' && route === 'samen') { toonAfronden(); return; }
      toon(klaarTekst || 'Ingevuld. Status: Wacht op controle.');
      bewerkStap = null;
      toonDetail(r);
      $('detail').scrollTop = 0;
    }).catch(function (err) { herstel(); toon(err.message, true); });
  }

  /**
   * Na Akkoord of "Opnieuw maken": de stukken meteen laten maken (±30 s) in plaats van op de trigger te wachten (1–3 min).
   * Op de achtergrond; de kaart "Overeenkomst" ververst zichzelf al. Lukt het niet, dan doet de trigger het alsnog.
   */
  function stukkenNu(id) {
    roep('contractNu', [id]).then(function (r) {
      if (huidig && huidig.id === id) { var top = $('detail').scrollTop; zetHuidig(r); toonDetail(r); $('detail').scrollTop = top; }
    }).catch(function () { /* vangnet: de wachtrij-trigger */ });
  }

  /** Met het detail uit hetzelfde antwoord (sinds de snelheidsronde); anders nog apart ophalen. */
  function toonFouten(id, fn, fouten, detail) {
    return (detail ? Promise.resolve(detail) : roep('detail', [id])).then(function (p) {
      if (fn === 'akkoord') {
        var stap = FORMULIER_STAPPEN.map(function (st) { return st.velden.some(function (d) { return fouten[d.veld]; }); }).indexOf(true);
        if (stap !== -1 && FORMULIER_STAPPEN[stap].titel !== 'Bezorggebied') bewerkStap = stap;
      }
      toonDetail(p);
      if (fn === 'akkoord') toonControleFouten(fouten);
      f.toonVeldFouten(fouten);
      toon(f.samenvattingFouten(fouten, EXTRA_LABELS), true);
    }).catch(function () { toon(f.samenvattingFouten(fouten, EXTRA_LABELS), true); });
  }

  // ---------- Start ----------
  if (sessie) toonApp(); else toonLogin();
})();
