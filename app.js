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

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** Naam in lijst en kop: naam van de zaak, anders bedrijfsnaam, anders de naam bij het aanmaken. */
  function naamVan(p) {
    return String(p.zaak_naam || p.bedrijfsnaam || p.naam_start || '').trim();
  }
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
  }

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
  function laad() {
    return roep('overzicht').then(function (o) {
      inst = o.instellingen || inst;
      $('testbalk').hidden = !o.testmodus;
      $('n-test').hidden = !o.testmodus;
      var n = o.partners.filter(function (p) { return p.status !== 'Geannuleerd'; }).length;
      $('telling').textContent = n === 1 ? '1 partner' : n + ' partners';
      $('lijst').innerHTML = o.partners.length ? o.partners.map(function (p) {
        return '<button class="item' + (p.status === 'Geannuleerd' ? ' uit' : '') + '" data-id="' + esc(p.id) + '">' +
          '<div class="wie"><div class="naam">' + esc(p.naam || p.id) + '</div>' +
          '<div class="wanneer">' + esc([p.stad, p.customer_facing_email].filter(Boolean).join(' · ')) + '</div></div>' +
          badge(p.status) + '</button>';
      }).join('') : '<div class="leeg">Nog geen partners. Maak er een aan met "Nieuwe partner".</div>';
    }).catch(function (e) {
      if (e.message !== 'Uitgelogd.') { $('telling').textContent = ''; toon(e.message, true); }
    });
  }

  $('lijst').addEventListener('click', function (e) {
    var item = e.target.closest('.item');
    if (item) openDetail(item.getAttribute('data-id'));
  });

  // ---------- Nieuwe partner ----------
  var nieuwRoute = '';
  var cfZelfGewijzigd = false;

  function resetNieuw() {
    ['n-naam', 'n-email', 'n-stad', 'n-cf'].forEach(function (id) { $(id).value = ''; });
    nieuwRoute = '';
    cfZelfGewijzigd = false;
    zetKeuze($('n-route'), '');
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
    $('n-naam').focus();
  });
  $('n-annuleer').addEventListener('click', function () { $('nieuw').hidden = true; $('nieuwKnop').hidden = false; });
  $('n-stad').addEventListener('input', function () {
    if (!cfZelfGewijzigd) $('n-cf').value = cfVoorstel($('n-stad').value, inst.cf_domein);
  });
  $('n-cf').addEventListener('input', function () { cfZelfGewijzigd = $('n-cf').value.trim() !== ''; });
  // Foutmelding weg zodra een veld wordt aangepast.
  [['n-naam', 'naam'], ['n-email', 'email'], ['n-stad', 'stad'], ['n-cf', 'customer_facing_email']].forEach(function (x) {
    $(x[0]).addEventListener('input', function () {
      $('nieuw').querySelector('[data-fout="' + x[1] + '"]').textContent = '';
      if (x[1] === 'stad') $('nieuw').querySelector('[data-fout="customer_facing_email"]').textContent = '';
    });
  });
  $('n-test').addEventListener('click', function () {
    var nr = String(Date.now()).slice(-4);
    $('n-naam').value = 'Testpartner ' + nr;
    $('n-email').value = 'hallo+test' + nr + '@virtualbite.nl';
    $('n-stad').value = 'Teststad ' + nr;
    cfZelfGewijzigd = false;
    $('n-cf').value = cfVoorstel($('n-stad').value, inst.cf_domein);
    nieuwRoute = 'samen';
    zetKeuze($('n-route'), 'samen');
    $('nieuw').querySelectorAll('[data-fout]').forEach(function (f) { f.textContent = ''; });
  });
  $('n-route').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    nieuwRoute = b.getAttribute('data-waarde');
    zetKeuze($('n-route'), nieuwRoute);
    $('nieuw').querySelector('[data-fout="route"]').textContent = '';
  });

  function werkAanmakenBij() {
    var klaar = $('n-naam').value.trim().length >= 2 && !!normaliseerEmail($('n-email').value) &&
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
      naam: $('n-naam').value, email: $('n-email').value, stad: $('n-stad').value,
      customer_facing_email: $('n-cf').value, route: nieuwRoute
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
      toon('Partner ' + r.id + ' aangemaakt.');
      laad();
      toonDetail(r);
      openPaneel();
    }).catch(function (err) { herstel(); toon(err.message, true); });
  });

  // ---------- Uitleg (ⓘ) ----------
  var uitlegVan = null;
  function infoKnop(veld, label) {
    return UITLEG[veld] ? '<button type="button" class="info" data-uitleg="' + esc(veld) + '" aria-label="Uitleg bij ' +
      esc(label) + '" aria-expanded="false">i</button>' : '';
  }
  function toonUitleg(knop) {
    var u = $('uitleg');
    if (uitlegVan === knop) { sluitUitleg(); return; }
    sluitUitleg();
    u.textContent = UITLEG[knop.getAttribute('data-uitleg')];
    u.hidden = false;
    var r = knop.getBoundingClientRect();
    var breed = u.offsetWidth;
    var links = Math.max(16, Math.min(r.left + window.scrollX - 8, window.scrollX + document.documentElement.clientWidth - breed - 16));
    u.style.left = links + 'px';
    u.style.top = (r.bottom + window.scrollY + 8) + 'px';
    if (knop.closest('#detail')) { // detail scrolt zelf
      u.style.position = 'fixed';
      u.style.left = Math.max(16, Math.min(r.left - 8, document.documentElement.clientWidth - breed - 16)) + 'px';
      u.style.top = (r.bottom + 8) + 'px';
    } else {
      u.style.position = 'absolute';
    }
    knop.setAttribute('aria-expanded', 'true');
    uitlegVan = knop;
  }
  function sluitUitleg() {
    $('uitleg').hidden = true;
    if (uitlegVan) uitlegVan.setAttribute('aria-expanded', 'false');
    uitlegVan = null;
  }
  document.addEventListener('click', function (e) {
    var knop = e.target.closest('[data-uitleg]');
    if (knop) { e.preventDefault(); toonUitleg(knop); return; }
    if (!e.target.closest('#uitleg')) sluitUitleg();
  });
  var hover = window.matchMedia('(hover: hover) and (pointer: fine)');
  document.addEventListener('mouseover', function (e) {
    var knop = hover.matches && e.target.closest && e.target.closest('[data-uitleg]');
    if (knop && uitlegVan !== knop) toonUitleg(knop);
  });
  document.addEventListener('mouseout', function (e) {
    var knop = hover.matches && e.target.closest && e.target.closest('[data-uitleg]');
    if (knop && uitlegVan === knop && !(e.relatedTarget && knop.contains(e.relatedTarget))) sluitUitleg();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') sluitUitleg(); });
  $('detail').addEventListener('scroll', sluitUitleg);

  // ---------- Detail: drie schermen ----------
  // Formulier (samen invullen), afronden (na "Ingevuld") en controle (Dimitri, vanaf "Wacht op controle").
  var FORMULIER_STATUSSEN = ['Samen invullen', 'Aangemaakt', 'Uitgenodigd', 'Deels ingevuld', 'Terug bij partner'];
  var bewerkStap = null; // controlescherm: welk blok staat open voor wijzigen (index in FORMULIER_STAPPEN)

  function openPaneel() {
    $('detail').classList.add('open');
    $('detail').setAttribute('aria-hidden', 'false');
    $('detail').scrollTop = 0;
  }

  function openDetail(id) {
    $('detailInhoud').innerHTML = '<button class="terug" data-actie="terug">‹ Terug</button>' +
      '<div class="laad-regel"></div><div class="laad-regel kort"></div><div class="laad-regel"></div>';
    openPaneel();
    bewerkStap = null;
    roep('detail', [id]).then(toonDetail).catch(function (e) {
      if (e.message !== 'Uitgelogd.') { toon(e.message, true); sluitDetail(); }
    });
  }

  function sluitDetail() {
    sluitUitleg();
    $('detail').classList.remove('open');
    $('detail').setAttribute('aria-hidden', 'true');
    huidig = null;
  }

  function kopHtml(p) {
    return '<button class="terug" data-actie="terug">‹ Terug</button>' +
      '<div class="kop-detail"><div><p class="merk">' + esc(p.id) + ' · ' +
      (p.route === 'samen' ? 'samen invullen' : 'partner vult zelf in') + '</p><h1>' + esc(naamVan(p) || p.id) + '</h1></div>' +
      badge(p.status) + '</div>';
  }

  function toonDetail(p) {
    huidig = p;
    if (FORMULIER_STATUSSEN.indexOf(p.status) !== -1) toonFormulier(p);
    else toonControle(p);
    if (p.markering && !p.markering.actueel && heeftPostcodes(p)) planAfstanden(true);
  }

  function heeftPostcodes(p) {
    return !!String(p.postcodes_gewenst || '').trim() ||
      leesRijen(p.bezorggebied).some(function (r) { return String(r.postcodes || '').trim(); });
  }

  // ---------- Velden tekenen ----------
  var DAGNAMEN = { ma: 'Ma', di: 'Di', wo: 'Wo', do: 'Do', vr: 'Vr', za: 'Za', zo: 'Zo' };

  function veldInvoer(d, p, uit) {
    var id = 'v-' + d.veld;
    var dis = uit ? ' disabled' : '';
    var w = p[d.veld] == null ? '' : p[d.veld];
    var vb = d.voorbeeld ? ' placeholder="' + esc(d.voorbeeld) + '"' : '';
    if (d.soort === 'keuze') {
      return '<div class="keuze" data-keuze="' + esc(d.veld) + '" role="group" aria-label="' + esc(d.label) + '">' +
        KEUZES[d.keuzes].map(function (k) {
          return '<button type="button" data-waarde="' + esc(k[0]) + '" aria-pressed="' + (w === k[0]) + '"' + dis + '>' +
            esc(k[1]) + '</button>';
        }).join('') + '</div>';
    }
    if (d.soort === 'vinkje') {
      return '<label class="vink-regel"><input type="checkbox" id="' + id + '" data-vinkje="' + esc(d.veld) + '"' +
        (w !== 'nee' ? ' checked' : '') + dis + '> ' + esc(d.label) + '</label>';
    }
    if (d.soort === 'tijden') {
      var t = leesTijden(w);
      var leegRooster = !DAGEN.some(function (dag) { return (t[dag] || []).some(Boolean); });
      return '<div class="klein">Laat leeg als je die dag dicht bent.</div><div class="tijden" data-tijden="' + esc(d.veld) + '">' +
        DAGEN.map(function (dag) {
          var v = t[dag] || [];
          return '<span class="dag">' + DAGNAMEN[dag] + '</span>' + [0, 1].map(function (i) {
            return '<input data-dag="' + dag + '" data-i="' + i + '" value="' + esc(v[i] || '') + '" placeholder="' +
              (leegRooster ? tijdVoorbeeld(i) : '') + '" inputmode="numeric" autocomplete="off" aria-label="' +
              esc(d.label) + ' ' + DAG_NAAM[dag] + ', tijdvak ' + (i + 1) + '"' + dis + '>';
          }).join('');
        }).join('') + '</div>';
    }
    if (d.soort === 'bsn') {
      return '<div class="bsn-rij" id="bsn-tonen"' + (p.heeft_bsn ? '' : ' hidden') + '><span class="waarde" id="bsn-waarde">' +
        esc(p.bsn_gemaskeerd) + '</span><button type="button" class="klein-knop" data-actie="toon-bsn">Toon</button>' +
        (uit ? '' : '<button type="button" class="klein-knop" data-actie="wijzig-bsn">Wijzigen</button>') + '</div>' +
        '<input id="' + id + '" data-veld="bsn" inputmode="numeric" autocomplete="off"' + vb + (p.heeft_bsn ? ' hidden' : '') + dis + '>';
    }
    if (d.soort === 'postcoderegels') return postcodeRegelsHtml(d, w, uit);
    var type = d.soort === 'email' ? ' type="email" inputmode="email" autocapitalize="off"' :
      d.soort === 'telefoon' ? ' type="tel" inputmode="tel"' :
      ['kvk', 'cijfers', 'huisnummer'].indexOf(d.soort) !== -1 ? ' inputmode="numeric"' : '';
    return '<input id="' + id + '" data-veld="' + esc(d.veld) + '" value="' + esc(w) + '"' + type + vb + ' autocomplete="off"' + dis + '>';
  }

  function tijdVoorbeeld(i) { return i ? 'Bijv. 16:30-21:30' : 'Bijv. 11:30-14:00'; }

  /** Voorbeelden in een rooster alleen zolang het hele rooster leeg is. */
  function werkTijdVoorbeeldenBij(rooster) {
    var vakken = rooster.querySelectorAll('input');
    var leeg = !Array.prototype.some.call(vakken, function (x) { return x.value.trim(); });
    vakken.forEach(function (x) { x.placeholder = leeg ? tijdVoorbeeld(Number(x.getAttribute('data-i'))) : ''; });
  }

  // ---------- Postcoderegels (partner): max. 5, elk één postcode of reeks ----------
  function postcodeRegelsHtml(d, w, uit) {
    var regels = postcodeRegels(w);
    var n = Math.min(MAX_POSTCODEREGELS, Math.max(3, regels.length));
    var h = '<div class="klein">' + esc(standaardBedragenTekst(inst, inst.grens_km || 6)) + '</div><div id="pc-regels">';
    for (var i = 0; i < n; i++) h += postcodeRegelHtml(i, regels[i] || '', uit);
    return h + '</div><div class="grens-uitleg" id="pc-uitleg" hidden></div>' +
      (uit ? '' : '<button type="button" class="klein-knop mt" data-actie="pc-erbij"' +
      (n >= MAX_POSTCODEREGELS ? ' hidden' : '') + '>+ Postcode toevoegen</button>');
  }

  function postcodeRegelHtml(i, waarde, uit) {
    return '<div class="pc-regel"><label for="pc-' + i + '">Postcode ' + (i + 1) + '</label>' +
      '<input id="pc-' + i + '" data-pcregel="' + i + '" value="' + esc(waarde) + '" inputmode="numeric" autocomplete="off"' +
      (i === 0 ? ' placeholder="Bijv. 8231-8245"' : '') + (uit ? ' disabled' : '') + '>' +
      '<div class="fout" data-pcregel-fout="' + i + '"></div><div class="rij-melding" data-pcregel-melding="' + i + '" hidden></div></div>';
  }

  function pcRegelsUitScherm() {
    return Array.prototype.map.call(document.querySelectorAll('[data-pcregel]'), function (el) { return el.value.trim(); });
  }

  /** Melding per regel (formaat, één reeks, dubbel), zonder serveraanroep. */
  function controleerPcRegels() {
    var waarden = pcRegelsUitScherm();
    var gevuld = [];
    waarden.forEach(function (v, i) { if (v) gevuld.push(i); });
    var r = controleerPostcodeRegels(gevuld.map(function (i) { return waarden[i]; }));
    document.querySelectorAll('[data-pcregel-fout]').forEach(function (el) { el.textContent = ''; });
    Object.keys(r.regelFouten).forEach(function (k) {
      var el = document.querySelector('[data-pcregel-fout="' + gevuld[Number(k)] + '"]');
      if (el) el.textContent = r.regelFouten[k];
    });
    return r;
  }

  function labelHtml(d) {
    if (d.soort === 'vinkje') return '';
    var alsLabel = ['keuze', 'tijden', 'postcoderegels'].indexOf(d.soort) === -1 && d.soort !== 'bsn';
    return alsLabel ? '<label for="v-' + esc(d.veld) + '">' + esc(d.label) + infoKnop(d.veld, d.label) + '</label>' :
      '<div class="label">' + esc(d.label) + infoKnop(d.veld, d.label) + '</div>';
  }

  /** Eén stap als velden; velden met dezelfde `rij` naast elkaar, `kop` als tussenkop. */
  function stapVelden(stap, p, uit) {
    var h = '';
    var i = 0;
    while (i < stap.velden.length) {
      var d = stap.velden[i];
      var kop = d.kop ? '<h3 class="tussenkop" data-kop="' + esc(d.veld) + '">' + esc(d.kop) + '</h3>' : '';
      if (d.rij) {
        var groep = [];
        while (i < stap.velden.length && stap.velden[i].rij === d.rij) groep.push(stap.velden[i++]);
        h += kop + '<div class="veld-rij">' + groep.map(function (x) { return veldBlok(x, p, uit); }).join('') + '</div>' +
          '<div class="klein adres-melding" data-adres-melding="' + esc(d.rij) + '" hidden></div>';
      } else {
        h += kop + veldBlok(d, p, uit);
        i++;
      }
    }
    return h;
  }

  function veldBlok(d, p, uit) {
    return '<div class="veld" data-rij="' + esc(d.veld) + '">' + labelHtml(d) + veldInvoer(d, p, uit) +
      '<div class="veld-status" data-status="' + esc(d.veld) + '"></div></div>';
  }

  function werkZichtbaarheidBij() {
    if (!huidig) return;
    alleFormulierVelden().forEach(function (d) {
      var zicht = veldZichtbaar(d, huidig);
      var rij = document.querySelector('#detailInhoud [data-rij="' + d.veld + '"]');
      if (rij) rij.hidden = !zicht;
      var kop = document.querySelector('#detailInhoud [data-kop="' + d.veld + '"]');
      if (kop) kop.hidden = !zicht;
    });
    document.querySelectorAll('#detailInhoud .veld-rij').forEach(function (r) {
      r.hidden = !Array.prototype.some.call(r.children, function (c) { return !c.hidden; });
    });
  }

  // ---------- Bezorggebied (5 rijen) ----------
  function leesRijen(w) {
    var g = leesTijden(w);
    var rijen = Array.isArray(g) ? g : [];
    while (rijen.length < 5) {
      rijen.push({ postcodes: '', moa: inst.standaard_moa, bezorgkosten: inst.standaard_bezorgkosten, gratisVanaf: inst.standaard_gratis_vanaf });
    }
    return rijen.slice(0, 5);
  }

  function bedragTekst(x) {
    return typeof x === 'number' && isFinite(x) ? formatGetal(x, true) : String(x == null || x === 'NaN' ? '' : x);
  }

  /** De 5 rijen van het TB-formulier (alleen in het controlescherm): postcodes, afstand en bedragen per rij. */
  function rijenHtml(p, uit) {
    var dis = uit ? ' disabled' : '';
    return '<div class="klein">Gewenst door de partner: ' + esc(postcodeRegels(p.postcodes_gewenst).join(', ') || '–') + '</div><div id="rijen">' +
      leesRijen(p.bezorggebied).map(function (r, i) {
        var bedrag = function (k, label) {
          return '<div><label for="r' + i + '-' + k + '">' + label + '</label><input id="r' + i + '-' + k + '" data-rij-nr="' + i +
            '" data-k="' + k + '" inputmode="decimal" value="' + esc(bedragTekst(r[k])) + '"' + dis + '></div>';
        };
        return '<div class="groep" data-bezorgrij="' + i + '"><div class="groep-kop"><span>Rij ' + (i + 1) + '</span></div>' +
          '<label for="r' + i + '-postcodes" class="sr">Postcodes rij ' + (i + 1) + '</label>' +
          '<textarea id="r' + i + '-postcodes" data-rij-nr="' + i + '" data-k="postcodes" rows="1" placeholder="' +
          (i === 0 ? 'Bijv. 8231-8245, 8211' : '') + '"' + dis + '>' + esc(r.postcodes) + '</textarea>' +
          '<div class="rij-melding" data-rij-melding="' + i + '" hidden></div>' +
          '<div class="bedragen">' + bedrag('moa', 'Minimum (€)') + bedrag('bezorgkosten', 'Bezorgkosten (€)') +
          bedrag('gratisVanaf', 'Gratis vanaf (€)') + '</div></div>';
      }).join('') + '</div><div class="klein">Rijafstand tot het midden van het postcodegebied; de randen kunnen verder ' +
      'liggen. Postcodes boven ' + esc(String(inst.grens_km || 6).replace('.', ',')) + ' km staan vooraf in rij 2: vul daar de ' +
      'bedragen in. Verplaats postcodes gerust tussen de rijen.</div>';
  }

  function rijenUitScherm() {
    var rijen = [];
    document.querySelectorAll('#rijen [data-k]').forEach(function (el) {
      var i = Number(el.getAttribute('data-rij-nr'));
      rijen[i] = rijen[i] || {};
      rijen[i][el.getAttribute('data-k')] = el.value;
    });
    return rijen.filter(Boolean);
  }

  /** Markering per rij: voor de partner alleen de grenstekst; in het controlescherm ook km per postcode. */
  function toonMarkering(m, beheer) {
    if (!m) return;
    var ergensVer = false;
    document.querySelectorAll('[data-pcregel]').forEach(function (inp) {
      var i = inp.getAttribute('data-pcregel');
      var el = document.querySelector('[data-pcregel-melding="' + i + '"]');
      var hier = leesPostcodes(inp.value).postcodes.filter(function (pc) { return (m.boven || []).indexOf(pc) !== -1; });
      el.innerHTML = hier.length ? '<div class="grens-tekst">' + esc(grensRegel(hier, m.grens_km)) + '</div>' : '';
      el.hidden = !hier.length;
      ergensVer = ergensVer || hier.length > 0;
    });
    var uitleg = $('pc-uitleg');
    if (uitleg) { uitleg.textContent = ergensVer ? grensUitleg(m.grens_km) : ''; uitleg.hidden = !ergensVer; }
    (m.rijen || []).forEach(function (r, i) {
      var el = document.querySelector('[data-rij-melding="' + i + '"]');
      var blok = document.querySelector('[data-bezorgrij="' + i + '"]');
      if (!el) return;
      if (blok) blok.classList.toggle('boven-grens', r.boven);
      var h = '';
      if (beheer && r.postcodes.length) {
        h += '<div class="afstanden">' + r.postcodes.map(function (x) {
          var nl = function (v) { return String(v).replace('.', ','); };
          var km = x.km === null ? 'onbekend' : nl(x.km) + ' km' + (x.schatting ? ' (schatting)' : '') +
            (x.min !== null && x.min !== undefined ? ' (ca. ' + nl(x.min) + '–' + nl(x.max) + ' km)' : '');
          return '<div class="' + (x.km !== null && x.km > m.grens_km ? 'ver' : '') + '">' + x.pc + (x.wijk ? ' – ' + esc(x.wijk) : '') +
            ': ' + esc(km) + '</div>';
        }).join('') + '</div>';
      }
      el.innerHTML = h;
      el.hidden = !h;
    });
    var info = $('afstandInfo');
    if (info) {
      info.textContent = m.fout || (m.te_veel ? 'Meer dan 60 postcodes: niet alle afstanden zijn berekend.' :
        beheer && m.vanaf ? 'Afstanden vanaf ' + m.vanaf + '.' : '');
      info.hidden = !info.textContent;
    }
  }

  var afstandTimer = null;
  var afstandNr = 0;

  function zetAfstandStatus(tekst, metKnop) {
    var el = $('afstandStatus');
    if (!el) return;
    el.innerHTML = tekst ? esc(tekst) + (metKnop ? ' <button type="button" class="klein-knop" data-actie="afstanden">Opnieuw ' +
      'proberen</button>' : '') : '';
    el.hidden = !tekst;
  }

  /**
   * Afstanden berekenen, los van het opslaan (na een korte pauze in typen). In het formulier gaan de postcoderegels
   * zoals ze nu op het scherm staan mee. De server doet per keer hooguit 8 nieuwe postcodes; zolang het onvolledig is
   * vragen we door. Alleen het antwoord op het laatste verzoek telt.
   */
  function planAfstanden(direct) {
    clearTimeout(afstandTimer);
    if (!huidig) return;
    afstandTimer = setTimeout(function () { haalAfstanden(++afstandNr, 0); }, direct ? 0 : 1200);
  }

  function haalAfstanden(nr, ronde) {
    var id = huidig && huidig.id;
    if (!id || nr !== afstandNr) return;
    var regels = document.querySelector('[data-pcregel]') ? pcRegelsUitScherm() : null;
    zetAfstandStatus('Afstanden berekenen…');
    roep('afstanden', [id, regels]).then(function (r) {
      if (nr !== afstandNr || !huidig || huidig.id !== id) return;
      huidig.markering = r.markering;
      toonMarkering(r.markering, $('controle') !== null);
      if (r.onvolledig && ronde < 10) { haalAfstanden(nr, ronde + 1); return; }
      zetAfstandStatus(r.melding ? 'Afstanden berekenen lukte niet.' : '', !!r.melding);
    }).catch(function () {
      if (nr !== afstandNr) return;
      zetAfstandStatus('Afstanden berekenen lukte niet: de server van Google reageert even niet.', true);
    });
  }

  // ---------- Scherm 1: formulier (samen invullen) ----------
  function toonFormulier(p) {
    var uit = !p.mag_bewerken;
    var h = kopHtml(p) + statusUitleg(p);
    if (p.testmodus && !uit) h += '<button type="button" class="klein-knop mt" data-actie="testgegevens">Vul testgegevens in</button>';
    FORMULIER_STAPPEN.forEach(function (stap) {
      h += '<section class="kaart"><h2>' + esc(stap.titel) + '</h2>' + stapVelden(stap, p, uit) +
        (stap.titel === 'Bezorggebied' ? '<div class="klein" id="afstandInfo" hidden></div>' +
          '<div class="klein afstand-status" id="afstandStatus" hidden></div>' : '') + '</section>';
    });
    h += '<div class="acties"><button class="knop hoofd" data-actie="ingevuld">Ingevuld</button></div>';
    h += '<details class="kaart beheerdeel"><summary>Gegevens Virtualbite</summary>' + partnerKaartVelden(p, uit) + '</details>';
    $('detailInhoud').innerHTML = h;
    werkZichtbaarheidBij();
    toonMarkering(p.markering, false);
    werkKnoppenBij();
  }

  function partnerKaartVelden(p, uit, zonderCf) {
    var veld = function (v, label, type, extra) {
      return '<div class="veld" data-rij="' + v + '"><label for="v-' + v + '">' + esc(label) + '</label>' +
        '<input id="v-' + v + '" data-veld="' + v + '" value="' + esc(p[v]) + '"' + (type || '') + ' autocomplete="off"' +
        (uit ? ' disabled' : '') + '>' + (extra || '') + '<div class="veld-status" data-status="' + v + '"></div></div>';
    };
    var mail = ' type="email" inputmode="email" autocapitalize="off"';
    return veld('naam_start', 'Naam') + veld('email', 'E-mail partner', mail) + veld('stad', 'Stad (vestigingsnaam)') +
      (zonderCf ? '' : veld('customer_facing_email', 'Customer-facing e-mailadres', mail,
        '<div class="klein">Moet uniek zijn over alle partners.</div>')) +
      veld('email_doorsturen', 'Eigen mailadres voor doorsturen', mail, '<div class="klein">Hierheen wordt ' +
        esc(p.customer_facing_email) + ' later doorgestuurd (nog niet gekoppeld).</div>') +
      (['Getekend', 'Geannuleerd'].indexOf(p.status) === -1 ?
        '<button class="knop gevaar mt" data-actie="annuleren">Partner annuleren</button>' : '');
  }

  function statusUitleg(p) {
    var t = {
      'Samen invullen': ['info', 'Vul het formulier samen in. Alles wordt per veld opgeslagen. Klaar? Klik op "Ingevuld".'],
      'Aangemaakt': ['info', 'De partner vult zelf in. De uitnodigingsmail met de link wordt gebouwd in fase 3; ' +
        'tot die tijd kun je het formulier hier invullen en op "Ingevuld" klikken.'],
      'Te tekenen': ['info', 'Akkoord gegeven' + (p.gecontroleerd_op ? ' op ' + p.gecontroleerd_op : '') + '. Het versturen ' +
        'van de overeenkomst wordt gebouwd in fase 4.'],
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

  // ---------- Scherm 3: controle (Dimitri) ----------
  function toonControle(p) {
    var uit = p.status !== 'Wacht op controle';
    var h = kopHtml(p) + statusUitleg(p);
    h += '<section class="kaart" id="controle"><h2>In te vullen door Virtualbite</h2>' + controleVelden(p, uit) + '</section>';
    h += '<div id="controleFouten"></div>';
    FORMULIER_STAPPEN.forEach(function (stap, i) {
      if (stap.titel === 'Bezorggebied') return; // staat bovenaan
      var open = bewerkStap === i && !uit;
      h += '<section class="kaart" data-stap="' + i + '"><div class="kaart-kop"><h2>' + esc(stap.titel) + '</h2>' +
        (uit ? '' : '<button type="button" class="tekst-knop" data-actie="' + (open ? 'klaar-stap' : 'wijzig-stap') +
          '" data-stap="' + i + '">' + (open ? 'Klaar' : 'Wijzig') + '</button>') + '</div>' +
        (open ? stapVelden(stap, p, false) : samenvatting(stap, p)) + '</section>';
    });
    h += '<details class="kaart beheerdeel"><summary>Partner (naam, e-mail, doorsturen)</summary>' + partnerKaartVelden(p, uit, true) + '</details>';
    if (!uit) h += '<div class="acties"><button class="knop hoofd" data-actie="akkoord">Akkoord</button></div>';
    $('detailInhoud').innerHTML = h;
    werkZichtbaarheidBij();
    toonMarkering(p.markering, true);
    werkVoorbeeldBij();
    toonControleFouten(p.controle_fouten, p.waarschuwingen_formulier);
    werkKnoppenBij();
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
      veld('startdatum', 'Startdatum', '<input id="v-startdatum" data-veld="startdatum" type="date" value="' + esc(p.startdatum) + '"' + dis + '>') +
      veld('customer_facing_email', 'Customer-facing e-mailadres', '<input id="v-customer_facing_email" data-veld="customer_facing_email" ' +
        'type="email" inputmode="email" autocapitalize="off" value="' + esc(p.customer_facing_email) + '"' + dis + '>',
        '<div class="klein">Moet uniek zijn over alle partners.</div>') +
      '<div class="veld"><div class="label">Openingstijden</div><div class="klein">Minimaal ' + esc(OPENINGS_MINIMUM) +
        ' op vrijdag, zaterdag, zondag en minimaal 2 andere dagen.</div>' +
        '<div id="uitzondering"' + (heeftUitzondering ? '' : ' hidden') + '>' +
        veld('openingstijden_uitzondering', 'Reden uitzondering', '<input id="v-openingstijden_uitzondering" ' +
          'data-veld="openingstijden_uitzondering" value="' + esc(p.openingstijden_uitzondering) + '" placeholder="Bijv. de zaak sluit om 20:00"' + dis + '>') +
        veld('openingstijden_minimum', 'Afwijkende minimale tijd', '<input id="v-openingstijden_minimum" data-veld="openingstijden_minimum" ' +
          'value="' + esc(p.openingstijden_minimum) + '" placeholder="Bijv. 16:30-20:00" inputmode="numeric"' + dis + '>') + '</div>' +
        (uit ? '' : '<button type="button" class="klein-knop mt" data-actie="uitzondering">' +
          (heeftUitzondering ? 'Uitzondering verwijderen' : 'Uitzondering openingstijden') + '</button>') + '</div>' +
      '<div class="veld" data-rij="bezorggebied"><div class="label">Bezorggebied en bedragen per rij</div>' + rijenHtml(p, uit) +
        '<div class="klein" id="afstandInfo" hidden></div><div class="klein afstand-status" id="afstandStatus" hidden></div>' +
        (uit ? '' : '<button type="button" class="klein-knop mt" data-actie="afstanden">Afstanden opnieuw berekenen</button>') +
        '<div class="veld-status" data-status="bezorggebied"></div></div>';
  }

  /** Samenvatting van een stap (alleen-lezen), in de volgorde van het formulier. */
  function samenvatting(stap, p) {
    var regels = [];
    stap.velden.forEach(function (d) {
      if (!veldZichtbaar(d, p) || /_(huisnummer|toevoeging)$/.test(d.veld)) return;
      var w;
      if (d.rij) { // adres: als één regel
        var pre = d.veld.replace('_postcode', '_');
        w = [p[pre + 'straat'], huisnummerMetToevoeging(p[pre + 'huisnummer'], p[pre + 'toevoeging'])].filter(Boolean).join(' ') +
          ', ' + [p[pre + 'postcode'], p[pre + 'plaats']].filter(Boolean).join(' ');
        regels.push([d.kop, w]);
        return;
      }
      if (/_(straat|plaats)$/.test(d.veld) && /^(vestiging|locatie)_/.test(d.veld)) return;
      if (d.soort === 'keuze') w = (KEUZES[d.keuzes].filter(function (k) { return k[0] === p[d.veld]; })[0] || ['', ''])[1];
      else if (d.soort === 'vinkje') w = p[d.veld] === 'nee' ? 'Nee' : 'Ja';
      else if (d.soort === 'bsn') w = p.bsn_gemaskeerd;
      else if (d.soort === 'tijden') {
        var t = leesTijden(p[d.veld]);
        w = DAGEN.filter(function (dag) { return (t[dag] || []).some(Boolean); }).map(function (dag) {
          return DAGNAMEN[dag] + ' ' + t[dag].filter(Boolean).join(', ');
        }).join(' · ');
      } else w = p[d.veld];
      if (d.veld === 'btw_id' && p.btw_vies) w += ' (' + p.btw_vies + ')';
      regels.push([d.label, w]);
    });
    return '<dl>' + regels.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + (r[1] ? esc(r[1]) : '<span class="leeg-waarde">–</span>') + '</dd></div>';
    }).join('') + '</dl>';
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

  var EXTRA_LABELS = { fee_percentage: 'Fee-percentage', startdatum: 'Startdatum', bezorggebied: 'Bezorggebied',
    customer_facing_email: 'Customer-facing e-mailadres', openingstijden_minimum: 'Afwijkende minimale tijd' };

  function toonControleFouten(fouten, waarschuwingen) {
    var el = $('controleFouten');
    if (!el) return;
    var k = Object.keys(fouten || {});
    var w = Object.keys(waarschuwingen || {}).filter(function (v) { return !(fouten || {})[v]; });
    var label = function (v) {
      var d = alleFormulierVelden().filter(function (x) { return x.veld === v; })[0];
      return d ? d.label : EXTRA_LABELS[v] || v;
    };
    el.innerHTML = (k.length ? '<div class="melding-blok mb-let">Nog niet klaar voor akkoord:<ul>' + k.map(function (v) {
      return '<li>' + esc(label(v)) + ': ' + esc(fouten[v]) + '</li>';
    }).join('') + '</ul></div>' : '') + (w.length ? '<div class="melding-blok mb-info">' + w.map(function (v) {
      return esc(label(v)) + ': ' + esc(waarschuwingen[v]);
    }).join('<br>') + '</div>' : '');
  }

  // ---------- Directe controle en automatisch opslaan ----------
  var timers = {};
  var wachtend = {}; // veld → opslaan dat nog moet gebeuren (na de korte pauze bij typen)
  var lopend = {};   // veld → {bezig: Promise | null, volgende: {waarde} | null}

  /**
   * Klaar met opslaan? Wacht tot er per veld geen verzoek meer onderweg is (ook als er intussen een nieuwer verzoek
   * voor hetzelfde veld is gestart).
   */
  function wachtTotOpgeslagen() {
    var bezig = Object.keys(lopend).map(function (v) { return lopend[v].bezig; }).filter(Boolean);
    if (!bezig.length) return Promise.resolve();
    return Promise.all(bezig.map(function (b) { return b.catch(function () {}); })).then(wachtTotOpgeslagen);
  }

  /** Alles wat nog wacht nu opslaan (vóór "Ingevuld", "Akkoord" of een ander scherm). */
  function slaWachtendOp() {
    Object.keys(wachtend).forEach(function (v) {
      clearTimeout(timers[v]);
      var doe = wachtend[v];
      delete wachtend[v];
      doe();
    });
    return wachtTotOpgeslagen();
  }

  function zetStatus(veld, tekst, soort) {
    var el = document.querySelector('#detailInhoud [data-status="' + veld + '"]');
    if (el) { el.textContent = tekst || ''; el.className = 'veld-status' + (soort ? ' ' + soort : ''); }
  }

  function veldDef(veld) {
    return alleFormulierVelden().filter(function (x) { return x.veld === veld; })[0] || null;
  }

  /** Bij typen: een rode melding verdwijnt zodra de waarde klopt (lege velden pas bij "Ingevuld"). */
  function controleerDirect(veld, waarde, strikt) {
    var d = veldDef(veld);
    var el = document.querySelector('#detailInhoud [data-status="' + veld + '"]');
    if (!d || !el) return true;
    var tekst = String(waarde == null ? '' : waarde).trim();
    var fout = tekst ? controleerVeld(d, tekst).fout : '';
    if (fout && strikt) { zetStatus(veld, fout, 'fout'); return false; }
    if (!fout && el.classList.contains('fout') && (tekst || !d.verplicht)) zetStatus(veld, '');
    return !fout;
  }

  var ADRES_VELDEN = /^(vestiging|locatie)_(postcode|huisnummer|toevoeging|straat|plaats)$/;

  /**
   * Veld opslaan. Per veld is er hooguit één verzoek onderweg; komt er intussen een nieuwe waarde (snel klikken),
   * dan gaat alleen de laatste daarna nog. Antwoorden op oudere waarden worden genegeerd: de laatste klik wint en
   * het scherm (lokale keuze) blijft leidend. "Opslaan…" eindigt altijd in "Opgeslagen" of een melding.
   */
  function bewaar(veld, waarde, direct) {
    if (!huidig || !huidig.mag_bewerken) return;
    clearTimeout(timers[veld]);
    var doe = function () { delete wachtend[veld]; verstuur(veld, waarde); };
    if (direct) doe(); else { wachtend[veld] = doe; timers[veld] = setTimeout(doe, 900); }
  }

  function verstuur(veld, waarde) {
    var s = lopend[veld] || (lopend[veld] = { bezig: null, volgende: null });
    zetStatus(veld, 'Opslaan…');
    if (s.bezig) { s.volgende = { waarde: waarde }; return; }
    var id = huidig.id;
    var volgende = function () {
      s.bezig = null;
      if (!s.volgende) return false;
      var v = s.volgende.waarde;
      s.volgende = null;
      if (huidig && huidig.id === id) verstuur(veld, v);
      return true;
    };
    s.bezig = roep('bewaar', [id, veld, waarde]).then(function (r) {
      if (volgende()) return; // er is al een nieuwere waarde: dit antwoord is verouderd
      if (!huidig || huidig.id !== id) return;
      verwerkOpgeslagen(veld, r, id);
    }, function (e) {
      if (volgende()) return;
      zetStatus(veld, e.message === STORING ? 'Opslaan lukte niet: de server van Google reageert even niet. Pas het veld ' +
        'opnieuw aan of probeer het zo opnieuw.' : e.message, 'fout');
    });
  }

  function verwerkOpgeslagen(veld, r, id) {
    if (r.fout) { zetStatus(veld, r.fout, 'fout'); return; }
    var d = veldDef(veld);
    // Keuzes, vinkjes, tijden en postcoderegels: wat op het scherm staat is leidend (niet overschrijven).
    if (!d || ['keuze', 'vinkje', 'tijden', 'postcoderegels'].indexOf(d.soort) === -1) huidig[veld] = r.waarde;
    var melding = r.fout_extern || r.waarschuwing;
    zetStatus(veld, melding || r.info || 'Opgeslagen', melding ? 'fout' : 'ok');
    if (veld === 'bsn') toonBsnOpgeslagen(r.waarde);
    if (veld === 'btw_id') { huidig.btw_vies = ''; if (r.waarde) controleerBtw(id); }
    if (veld === 'customer_facing_email' || veld === 'email_doorsturen') {
      var el = document.querySelector('[data-veld="' + veld + '"]');
      if (el && document.activeElement !== el) el.value = r.waarde;
    }
    if (veld === 'bezorggebied' || veld === 'locatie_zelfde' || ADRES_VELDEN.test(veld)) planAfstanden();
    werkKnoppenBij();
  }

  /** VIES-controle (los van het opslaan). Een storing blokkeert niet: nette melding, later opnieuw. */
  function controleerBtw(id) {
    zetStatus('btw_id', 'Opgeslagen · controleren bij de EU…');
    roep('controleerBtw', [id]).then(function (r) {
      if (!huidig || huidig.id !== id) return;
      if (r.btw_vies !== undefined) huidig.btw_vies = r.btw_vies;
      zetStatus('btw_id', r.fout || r.waarschuwing || r.info || 'Opgeslagen', r.fout || r.waarschuwing ? 'fout' : 'ok');
    }).catch(function () {
      zetStatus('btw_id', 'BTW-nummer kon nu niet bij de EU worden gecontroleerd; we proberen het later opnieuw.', 'fout');
    });
  }

  var btwTimer = null;
  var BTW_FORMAAT = 'Vul het btw-id in als NL123456789B01 (NL, 9 cijfers, B, 2 cijfers).';

  function toonBsnOpgeslagen(gemaskeerd) {
    huidig.heeft_bsn = !!gemaskeerd;
    huidig.bsn_gemaskeerd = gemaskeerd;
    $('bsn-waarde').textContent = gemaskeerd;
    $('bsn-tonen').hidden = !gemaskeerd;
    if (gemaskeerd) { $('v-bsn').value = ''; $('v-bsn').hidden = true; }
  }

  function tijdenUitScherm(veld) {
    var t = {};
    document.querySelectorAll('[data-tijden="' + veld + '"] input').forEach(function (inp) {
      var dag = inp.getAttribute('data-dag');
      t[dag] = t[dag] || ['', ''];
      t[dag][Number(inp.getAttribute('data-i'))] = inp.value.trim();
    });
    return t;
  }

  // Adres: straat en plaats automatisch via PDOK na postcode + huisnummer (+ toevoeging).
  var adresTimers = {};
  var adresLaatste = {};
  function zoekAdres(pre) {
    var pc = $('v-' + pre + '_postcode');
    var nr = $('v-' + pre + '_huisnummer');
    var tv = $('v-' + pre + '_toevoeging');
    var melding = document.querySelector('[data-adres-melding="' + pre + '-nr"]');
    if (!pc || !nr || !melding) return;
    var url = pdokUrl(pc.value, nr.value);
    if (!url) { melding.hidden = true; adresLaatste[pre] = ''; return; }
    var sleutel = url + '|' + tv.value;
    if (sleutel === adresLaatste[pre]) return;
    adresLaatste[pre] = sleutel;
    fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) {
      if (!r.ok) throw new Error('PDOK');
      return r.json();
    }).then(function (j) {
      if (sleutel !== adresLaatste[pre]) return;
      var o = bagOordeel(j.response.docs, { toevoeging: tv.value });
      if (o.nummerBestaat) {
        [['straat', o.straat], ['plaats', o.woonplaats]].forEach(function (x) {
          var el = $('v-' + pre + '_' + x[0]);
          if (!el || el.value === x[1]) return;
          el.value = x[1];
          controleerDirect(pre + '_' + x[0], x[1]);
          bewaar(pre + '_' + x[0], x[1], true);
        });
      }
      melding.textContent = o.gevonden ? '' : 'Dit adres kunnen we niet vinden. Controleer postcode, huisnummer en toevoeging.';
      melding.hidden = o.gevonden;
    }).catch(function () { adresLaatste[pre] = ''; melding.hidden = true; });
  }
  function planAdres(veld) {
    var m = /^(vestiging|locatie)_(postcode|huisnummer|toevoeging)$/.exec(veld);
    if (!m) return;
    clearTimeout(adresTimers[m[1]]);
    adresTimers[m[1]] = setTimeout(function () { zoekAdres(m[1]); }, 600);
  }

  // ---------- Hoofdknoppen: groen als alles klopt, anders gedimd (wel klikbaar: dan verschijnen de meldingen) ----------
  function klaarVoorIngevuld() {
    var g = Object.assign({}, huidig);
    if (huidig.heeft_bsn && !g.bsn) g.bsn = '111222333'; // opgeslagen BSN (gemaskeerd): telt als ingevuld
    return valideerPartnerFormulier(g).ok;
  }

  function klaarVoorAkkoord() {
    if (!klaarVoorIngevuld()) return false;
    var fee = $('v-fee_percentage');
    var start = $('v-startdatum');
    var cf = $('v-customer_facing_email');
    if (!fee || isNaN(leesPercentage(fee.value)) || !start || !start.value) return false;
    if (cf && !normaliseerCfAdres(cf.value, inst.cf_domein)) return false;
    var c = controleerBezorggebied(rijenUitScherm());
    if (c.fouten.length) return false;
    var reden = $('v-openingstijden_uitzondering');
    var min = $('v-openingstijden_minimum');
    var heeftUitzondering = reden && reden.value.trim() && !$('uitzondering').hidden;
    if (heeftUitzondering && !normaliseerTijdvak(min.value)) return false;
    return !dagenOnderMinimum(huidig.bezorgtijden, heeftUitzondering ? normaliseerTijdvak(min.value) : OPENINGS_MINIMUM).length;
  }

  function werkKnoppenBij() {
    var ingevuld = document.querySelector('#detailInhoud [data-actie="ingevuld"]');
    if (ingevuld && huidig) ingevuld.classList.toggle('klaar', klaarVoorIngevuld());
    var akkoord = document.querySelector('#detailInhoud [data-actie="akkoord"]');
    if (akkoord && huidig) akkoord.classList.toggle('klaar', klaarVoorAkkoord());
  }

  var detail = $('detailInhoud');
  ['input', 'change', 'click'].forEach(function (t) {
    detail.addEventListener(t, function () { setTimeout(werkKnoppenBij, 0); });
  });
  detail.addEventListener('input', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-veld')) {
      var veld = el.getAttribute('data-veld');
      if (veld === 'fee_percentage') werkVoorbeeldBij();
      if (veld === 'btw_id') { // alleen opslaan en controleren als het formaat klopt; anders na een pauze een melding
        clearTimeout(btwTimer);
        clearTimeout(timers.btw_id);
        delete wachtend.btw_id;
        var btw = el.value.trim();
        if (btw && !normaliseerBtwId(btw)) {
          btwTimer = setTimeout(function () { zetStatus('btw_id', BTW_FORMAAT, 'fout'); }, 900);
          return;
        }
        zetStatus('btw_id', '');
        bewaar('btw_id', btw);
        return;
      }
      controleerDirect(veld, el.value);
      huidig[veld] = el.value;
      planAdres(veld);
      if (veld === 'bsn' && el.value.replace(/\D/g, '').length < 9) return; // pas bewaren als het compleet is
      bewaar(veld, el.value);
    } else if (el.hasAttribute('data-pcregel')) {
      controleerPcRegels();
      huidig.postcodes_gewenst = pcRegelsUitScherm().filter(Boolean).join('\n');
      toonMarkering(huidig.markering, false); // oude melding van een gewiste/gewijzigde regel meteen weg
      bewaar('postcodes_gewenst', pcRegelsUitScherm());
      planAfstanden();
    } else if (el.closest('[data-tijden]')) {
      werkTijdVoorbeeldenBij(el.closest('[data-tijden]'));
      var vak = el.closest('[data-tijden]').getAttribute('data-tijden');
      huidig[vak] = tijdenUitScherm(vak);
      var st = document.querySelector('#detailInhoud [data-status="' + vak + '"]');
      if (st && st.classList.contains('fout') && el.value.trim() && normaliseerTijdvak(el.value)) zetStatus(vak, '');
    } else if (el.hasAttribute('data-rij-nr')) {
      bewaar('bezorggebied', rijenUitScherm());
    }
  });
  detail.addEventListener('change', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-vinkje')) {
      var v = el.getAttribute('data-vinkje');
      huidig[v] = el.checked ? 'ja' : 'nee';
      werkZichtbaarheidBij();
      bewaar(v, huidig[v], true);
    } else if (el.hasAttribute('data-veld')) {
      var veld = el.getAttribute('data-veld');
      if (veld === 'btw_id' && el.value.trim() && !normaliseerBtwId(el.value)) { // geen serveraanroep
        clearTimeout(btwTimer);
        zetStatus('btw_id', BTW_FORMAAT, 'fout');
        return;
      }
      if (veld === 'btw_id' && !wachtend.btw_id) return; // al opgeslagen (en gecontroleerd) tijdens het typen
      if (controleerDirect(veld, el.value, true)) bewaar(veld, el.value, true);
      else bewaar(veld, el.value, true); // half ingevuld toch bewaren; melding blijft staan
    } else if (el.hasAttribute('data-pcregel')) {
      controleerPcRegels();
      bewaar('postcodes_gewenst', pcRegelsUitScherm(), true);
    } else if (el.closest('[data-tijden]')) {
      var vak = el.closest('[data-tijden]').getAttribute('data-tijden');
      bewaar(vak, tijdenUitScherm(vak), true);
    } else if (el.hasAttribute('data-rij-nr')) {
      bewaar('bezorggebied', rijenUitScherm(), true);
    }
  });

  detail.addEventListener('click', function (e) {
    var keuze = e.target.closest('[data-keuze] button');
    if (keuze && !keuze.disabled) {
      var groep = keuze.closest('[data-keuze]');
      var veld = groep.getAttribute('data-keuze');
      var waarde = keuze.getAttribute('data-waarde');
      zetKeuze(groep, waarde);
      huidig[veld] = waarde;
      zetStatus(veld, '');
      werkZichtbaarheidBij();
      bewaar(veld, waarde, true);
      return;
    }
    var knop = e.target.closest('[data-actie]');
    if (!knop) return;
    var actie = knop.getAttribute('data-actie');
    if (actie === 'terug') { slaWachtendOp(); sluitDetail(); laad(); return; }
    if (actie === 'toon-bsn') {
      if (knop.textContent === 'Verberg') { $('bsn-waarde').textContent = huidig.bsn_gemaskeerd; knop.textContent = 'Toon'; return; }
      roep('toonBsn', [huidig.id]).then(function (r) {
        $('bsn-waarde').textContent = r.bsn;
        knop.textContent = 'Verberg';
      }).catch(function (err) { toon(err.message, true); });
      return;
    }
    if (actie === 'wijzig-bsn') { $('bsn-tonen').hidden = true; $('v-bsn').hidden = false; $('v-bsn').focus(); return; }
    if (actie === 'afstanden') { planAfstanden(true); return; }
    if (actie === 'pc-erbij') {
      var aantal = document.querySelectorAll('[data-pcregel]').length;
      if (aantal < MAX_POSTCODEREGELS) {
        $('pc-regels').insertAdjacentHTML('beforeend', postcodeRegelHtml(aantal, '', false));
        $('pc-' + aantal).focus();
      }
      knop.hidden = aantal + 1 >= MAX_POSTCODEREGELS;
      return;
    }
    if (actie === 'testgegevens') {
      var herstel = bezig(knop, 'Invullen…');
      wachtTotOpgeslagen().then(function () { return roep('testgegevens', [huidig.id]); }).then(function (r) {
        herstel(); toon('Testgegevens ingevuld.'); toonDetail(r);
      }).catch(function (err) { herstel(); toon(err.message, true); });
      return;
    }
    if (actie === 'uitzondering') {
      var blok = $('uitzondering');
      if (blok.hidden) { blok.hidden = false; knop.textContent = 'Uitzondering verwijderen'; $('v-openingstijden_uitzondering').focus(); return; }
      $('v-openingstijden_uitzondering').value = '';
      $('v-openingstijden_minimum').value = '';
      bewaar('openingstijden_uitzondering', '', true);
      bewaar('openingstijden_minimum', '', true);
      blok.hidden = true;
      knop.textContent = 'Uitzondering openingstijden';
      return;
    }
    if (actie === 'wijzig-stap' || actie === 'klaar-stap') {
      bewerkStap = actie === 'wijzig-stap' ? Number(knop.getAttribute('data-stap')) : null;
      var id = huidig.id;
      slaWachtendOp().then(function () { return roep('detail', [id]); }).then(function (p) {
        var top = $('detail').scrollTop;
        toonDetail(p);
        $('detail').scrollTop = top;
      }).catch(function (err) { toon(err.message, true); });
      return;
    }
    if (actie === 'ingevuld') return statusActie(knop, 'ingevuld', 'Controleren…');
    if (actie === 'akkoord') {
      bevestig('Akkoord geven?', 'Daarna kunnen de gegevens niet meer worden gewijzigd. Het versturen van de overeenkomst ' +
        'volgt in fase 4.', 'Akkoord').then(function (ja) {
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

  /** Eerst wachten tot alles is opgeslagen, dan de actie. Bij fouten: per veld tonen en naar de eerste scrollen. */
  function statusActie(knop, fn, bezigTekst, klaarTekst) {
    var herstel = bezig(knop, bezigTekst);
    var id = huidig.id;
    var route = huidig.route;
    slaWachtendOp().then(function () { return roep(fn, [id]); }).then(function (r) {
      herstel();
      if (r.fouten) {
        if (fn === 'akkoord') {
          // Fout in een blok dat dicht staat: dat blok openen.
          var stap = FORMULIER_STAPPEN.map(function (s) { return s.velden.some(function (d) { return r.fouten[d.veld]; }); }).indexOf(true);
          if (stap !== -1 && FORMULIER_STAPPEN[stap].titel !== 'Bezorggebied' && bewerkStap !== stap) {
            bewerkStap = stap;
            toonControle(huidig);
          }
          toonControleFouten(r.fouten);
        }
        Object.keys(r.fouten).forEach(function (v) { zetStatus(v, r.fouten[v], 'fout'); });
        var eerste = document.querySelector('#detailInhoud .veld-status.fout');
        if (eerste) eerste.closest('.veld').scrollIntoView({ behavior: 'smooth', block: 'center' });
        toon('Nog niet alles is goed ingevuld.', true);
        return;
      }
      huidig = r;
      if (fn === 'ingevuld' && route === 'samen') { toonAfronden(); return; }
      toon(klaarTekst || 'Ingevuld. Status: Wacht op controle.');
      bewerkStap = null;
      toonDetail(r);
      $('detail').scrollTop = 0;
    }).catch(function (err) { herstel(); toon(err.message, true); });
  }

  // ---------- Start ----------
  if (sessie) toonApp(); else toonLogin();
})();
