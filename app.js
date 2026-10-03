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
  function api(verzoek) {
    return fetch(window.VB_CONFIG.api, {
      method: 'POST', credentials: 'omit', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(verzoek)
    }).then(function (r) {
      if (!r.ok) throw new Error(STORING);
      return r.text();
    }, function () { throw new Error(STORING); }).then(function (t) {
      try { return JSON.parse(t); } catch (e) { throw new Error(STORING); }
    });
  }

  /** Alleen-lezen aanroepen mogen bij een storing nog één keer opnieuw. */
  var ALLEEN_LEZEN = ['overzicht', 'detail'];
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
    $('n-naam').focus();
  });
  $('n-annuleer').addEventListener('click', function () { $('nieuw').hidden = true; $('nieuwKnop').hidden = false; });
  $('n-stad').addEventListener('input', function () {
    if (!cfZelfGewijzigd) $('n-cf').value = cfVoorstel($('n-stad').value, inst.cf_domein);
  });
  $('n-cf').addEventListener('input', function () { cfZelfGewijzigd = $('n-cf').value.trim() !== ''; });
  $('n-route').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    nieuwRoute = b.getAttribute('data-waarde');
    zetKeuze($('n-route'), nieuwRoute);
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

  // ---------- Detail ----------
  function openPaneel() {
    $('detail').classList.add('open');
    $('detail').setAttribute('aria-hidden', 'false');
    $('detail').scrollTop = 0;
  }

  function openDetail(id) {
    $('detailInhoud').innerHTML = '<button class="terug" data-actie="terug">‹ Terug</button>' +
      '<div class="laad-regel"></div><div class="laad-regel kort"></div><div class="laad-regel"></div>';
    openPaneel();
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

  var DAGNAMEN = { ma: 'Ma', di: 'Di', wo: 'Wo', do: 'Do', vr: 'Vr', za: 'Za', zo: 'Zo' };
  var DAGNAMEN_VOL = { ma: 'maandag', di: 'dinsdag', wo: 'woensdag', do: 'donderdag', vr: 'vrijdag', za: 'zaterdag', zo: 'zondag' };

  function veldHtml(d, p, uit) {
    var id = 'v-' + d.veld;
    var dis = uit ? ' disabled' : '';
    var w = p[d.veld] == null ? '' : p[d.veld];
    var label = '<label for="' + id + '">' + esc(d.label) + infoKnop(d.veld, d.label) + '</label>';
    var invoer;
    if (d.soort === 'keuze') {
      label = '<div class="label">' + esc(d.label) + infoKnop(d.veld, d.label) + '</div>';
      invoer = '<div class="keuze" data-keuze="' + esc(d.veld) + '" role="group" aria-label="' + esc(d.label) + '">' +
        KEUZES[d.keuzes].map(function (k) {
          return '<button type="button" data-waarde="' + esc(k[0]) + '" aria-pressed="' + (w === k[0]) + '"' + dis + '>' +
            esc(k[1]) + '</button>';
        }).join('') + '</div>';
    } else if (d.soort === 'tijden') {
      label = '<div class="label">' + esc(d.label) + infoKnop(d.veld, d.label) + '</div>';
      var t = leesTijden(w);
      invoer = '<div class="tijden" data-tijden="' + esc(d.veld) + '">' + DAGEN.map(function (dag) {
        var v = t[dag] || [];
        return '<span class="dag">' + DAGNAMEN[dag] + '</span>' + [0, 1].map(function (i) {
          return '<input data-dag="' + dag + '" data-i="' + i + '" value="' + esc(v[i] || '') + '" placeholder="' +
            (dag !== 'ma' ? '' : i ? '16:30-21:30' : '11:30-14:00') + '" inputmode="numeric" autocomplete="off" aria-label="' + esc(d.label) + ' ' + DAGNAMEN_VOL[dag] +
            ', tijdvak ' + (i + 1) + '"' + dis + '>';
        }).join('');
      }).join('') + '</div>';
    } else if (d.soort === 'bsn') {
      invoer = '<div class="bsn-rij" id="bsn-tonen"' + (p.heeft_bsn ? '' : ' hidden') + '><span class="waarde" id="bsn-waarde">' +
        esc(p.bsn_gemaskeerd) + '</span><button type="button" class="klein-knop" data-actie="toon-bsn">Toon</button>' +
        (uit ? '' : '<button type="button" class="klein-knop" data-actie="wijzig-bsn">Wijzigen</button>') + '</div>' +
        '<input id="' + id + '" data-veld="bsn" inputmode="numeric" autocomplete="off"' + (p.heeft_bsn ? ' hidden' : '') + dis + '>';
    } else if (d.soort === 'postcodes') {
      invoer = '<textarea id="' + id + '" data-veld="' + esc(d.veld) + '" rows="2" placeholder="Bijv. 8231-8245, 8211"' + dis + '>' +
        esc(w) + '</textarea>';
    } else {
      var type = d.soort === 'email' ? ' type="email" inputmode="email" autocapitalize="off"' :
        d.soort === 'telefoon' ? ' type="tel" inputmode="tel"' : d.soort === 'kvk' ? ' inputmode="numeric"' : '';
      invoer = '<input id="' + id + '" data-veld="' + esc(d.veld) + '" value="' + esc(w) + '"' + type + ' autocomplete="off"' + dis + '>';
    }
    return '<div class="veld" data-rij="' + esc(d.veld) + '">' + label + invoer +
      '<div class="veld-status" data-status="' + esc(d.veld) + '"></div></div>';
  }

  function zichtbaar(veld, p) {
    if (veld === 'bsn') return p.rechtsvorm === 'eenmanszaak';
    if (veld === 'eu_land') return p.eu_vestiging === 'ja';
    if (veld === 'koppeling_anders') return p.koppeling === 'other';
    return true;
  }
  function werkZichtbaarheidBij() {
    if (!huidig) return;
    ['bsn', 'eu_land', 'koppeling_anders'].forEach(function (v) {
      var rij = document.querySelector('[data-rij="' + v + '"]');
      if (rij) rij.hidden = !zichtbaar(v, huidig);
    });
  }

  function beheerVeld(veld, label, waarde, type, uit, extra) {
    return '<div class="veld" data-rij="' + veld + '"><label for="v-' + veld + '">' + esc(label) + '</label>' +
      '<input id="v-' + veld + '" data-veld="' + veld + '" value="' + esc(waarde) + '"' + (type || '') + ' autocomplete="off"' +
      (uit ? ' disabled' : '') + '>' + (extra || '') + '<div class="veld-status" data-status="' + veld + '"></div></div>';
  }

  function toonDetail(p) {
    huidig = p;
    var uit = !p.mag_bewerken;
    var h = '<button class="terug" data-actie="terug">‹ Terug</button>' +
      '<div class="kop-detail"><div><p class="merk">' + esc(p.id) + ' · ' + (p.route === 'samen' ? 'samen invullen' : 'partner vult zelf in') +
      '</p><h1>' + esc(naamVan(p) || p.id) + '</h1></div>' + badge(p.status) + '</div>';

    h += statusUitleg(p);

    h += '<section class="kaart"><h2>Partner</h2>' +
      beheerVeld('naam_start', 'Naam', p.naam_start, '', uit) +
      beheerVeld('email', 'E-mail partner', p.email, ' type="email" inputmode="email" autocapitalize="off"', uit) +
      beheerVeld('stad', 'Stad (vestigingsnaam)', p.stad, '', uit) +
      beheerVeld('customer_facing_email', 'Customer-facing e-mailadres', p.customer_facing_email,
        ' type="email" inputmode="email" autocapitalize="off"', uit, '<div class="klein">Moet uniek zijn over alle partners.</div>') +
      beheerVeld('email_doorsturen', 'Eigen mailadres voor doorsturen', p.email_doorsturen,
        ' type="email" inputmode="email" autocapitalize="off"', uit,
        '<div class="klein">Hierheen wordt ' + esc(p.customer_facing_email) + ' later doorgestuurd (nog niet gekoppeld).</div>') +
      '</section>';

    FORMULIER_STAPPEN.forEach(function (stap) {
      h += '<section class="kaart"><h2>' + esc(stap.titel) + '</h2>' + stap.velden.map(function (d) {
        return veldHtml(d, p, uit);
      }).join('') + '</section>';
    });

    if (p.status === 'Wacht op controle' || p.status === 'Te tekenen') h += controleHtml(p, p.status !== 'Wacht op controle');

    h += '<div class="acties">';
    if (['Samen invullen', 'Aangemaakt', 'Uitgenodigd', 'Deels ingevuld', 'Terug bij partner'].indexOf(p.status) !== -1) {
      h += '<button class="knop" data-actie="ingevuld">Ingevuld</button>';
    }
    if (p.status === 'Wacht op controle') h += '<button class="knop" data-actie="akkoord">Akkoord</button>';
    if (['Getekend', 'Geannuleerd'].indexOf(p.status) === -1) {
      h += '<button class="knop gevaar" data-actie="annuleren">Partner annuleren</button>';
    }
    h += '</div>';

    $('detailInhoud').innerHTML = h;
    werkZichtbaarheidBij();
    if (p.status === 'Wacht op controle') { toonControleFouten(p.controle_fouten); werkVoorbeeldBij(); }
  }

  function statusUitleg(p) {
    var t = {
      'Samen invullen': ['info', 'Vul het formulier samen in. Alles wordt per veld opgeslagen. Klaar? Klik op "Ingevuld". ' +
        'Er gaat nog niets naar de partner.'],
      'Aangemaakt': ['info', 'De partner vult zelf in. De uitnodigingsmail met de link wordt gebouwd in fase 3; ' +
        'tot die tijd kun je het formulier hier invullen en op "Ingevuld" klikken.'],
      'Wacht op controle': ['let', 'Controleer alles, vul fee en startdatum in, pas zo nodig het bezorggebied aan en ' +
        'klik op "Akkoord".'],
      'Te tekenen': ['info', 'Akkoord gegeven' + (p.gecontroleerd_op ? ' op ' + p.gecontroleerd_op : '') + '. Het versturen ' +
        'van de overeenkomst wordt gebouwd in fase 4.'],
      'Geannuleerd': ['let', 'Deze partner is geannuleerd' + (p.geannuleerd_op ? ' op ' + p.geannuleerd_op : '') + '.']
    }[p.status];
    return t ? '<div class="melding-blok mb-' + t[0] + '">' + esc(t[1]) + '</div>' : '';
  }

  // ---------- Controlestap ----------
  function controleHtml(p, uit) {
    var dis = uit ? ' disabled' : '';
    var groepen = leesBezorggebied(p.bezorggebied);
    return '<section class="kaart" id="controle"><h2>Controle</h2>' +
      '<div class="veld" data-rij="fee_percentage"><label for="v-fee_percentage">Fee-percentage</label>' +
      '<input id="v-fee_percentage" data-veld="fee_percentage" inputmode="decimal" value="' +
      esc(String(p.fee_percentage == null ? '' : p.fee_percentage).replace('.', ',')) + '"' + dis + '>' +
      '<div class="voorbeeld" id="voorbeeld"></div><div class="veld-status" data-status="fee_percentage"></div></div>' +
      '<div class="veld" data-rij="startdatum"><label for="v-startdatum">Startdatum</label>' +
      '<input id="v-startdatum" data-veld="startdatum" type="date" value="' + esc(p.startdatum) + '"' + dis + '>' +
      '<div class="veld-status" data-status="startdatum"></div></div>' +
      '<div class="veld" data-rij="bezorggebied"><div class="label">Bezorggebied en bedragen per postcoderegel</div>' +
      '<div class="klein">Eén groep = dezelfde bedragen. Zet postcodes met andere bedragen (bijv. buiten de stad) in een ' +
      'eigen groep. Gewenst door de partner: ' + esc(p.postcodes_gewenst || '–') + '</div>' +
      '<div id="groepen">' + groepen.map(function (g, i) { return groepHtml(g, i, uit); }).join('') + '</div>' +
      (uit ? '' : '<button type="button" class="klein-knop mt" data-actie="groep-erbij">Groep toevoegen</button>') +
      '<div class="veld-status" data-status="bezorggebied"></div></div>' +
      '<div id="controleFouten"></div></section>';
  }

  function groepHtml(g, i, uit) {
    var dis = uit ? ' disabled' : '';
    var bedrag = function (k, label) {
      return '<div><label for="g' + i + '-' + k + '">' + label + '</label><input id="g' + i + '-' + k + '" data-groep="' + i +
        '" data-k="' + k + '" inputmode="decimal" value="' + esc(typeof g[k] === 'number' && isFinite(g[k]) ? formatGetal(g[k], true) :
        String(g[k] == null ? '' : g[k])) + '"' + dis + '></div>';
    };
    return '<div class="groep"><div class="groep-kop"><span>Groep ' + (i + 1) + '</span>' +
      (uit || i === 0 ? '' : '<button type="button" class="tekst-knop" data-actie="groep-weg" data-groep="' + i + '">Verwijderen</button>') +
      '</div><label for="g' + i + '-postcodes">Postcodes</label><textarea id="g' + i + '-postcodes" data-groep="' + i +
      '" data-k="postcodes" rows="2"' + dis + '>' + esc(g.postcodes) + '</textarea><div class="bedragen">' +
      bedrag('moa', 'Minimum (€)') + bedrag('bezorgkosten', 'Bezorgkosten (€)') + bedrag('gratisVanaf', 'Gratis vanaf (€)') +
      '</div></div>';
  }

  function leesBezorggebied(w) {
    var g = leesTijden(w);
    return Array.isArray(g) ? g : [];
  }

  function groepenUitScherm() {
    var groepen = [];
    document.querySelectorAll('#groepen [data-k]').forEach(function (el) {
      var i = Number(el.getAttribute('data-groep'));
      groepen[i] = groepen[i] || {};
      groepen[i][el.getAttribute('data-k')] = el.value;
    });
    return groepen.filter(Boolean);
  }

  function werkVoorbeeldBij() {
    var el = $('voorbeeld');
    if (!el) return;
    var fee = $('v-fee_percentage').value;
    try {
      el.textContent = 'Rekenvoorbeeld "Zo werkt het": ' + rekenvoorbeeld(fee).tekst;
    } catch (e) {
      el.textContent = 'Vul een percentage in, bijv. 9 of 9,5.';
    }
  }

  function toonControleFouten(fouten) {
    var el = $('controleFouten');
    if (!el) return;
    var k = Object.keys(fouten || {});
    el.innerHTML = k.length ? '<div class="melding-blok mb-let">Nog niet klaar voor akkoord:<ul>' + k.map(function (v) {
      var d = alleFormulierVelden().filter(function (x) { return x.veld === v; })[0];
      var label = d ? d.label : { fee_percentage: 'Fee-percentage', startdatum: 'Startdatum', bezorggebied: 'Bezorggebied',
        customer_facing_email: 'Customer-facing e-mailadres' }[v] || v;
      return '<li>' + esc(label) + ': ' + esc(fouten[v]) + '</li>';
    }).join('') + '</ul></div>' : '';
  }

  // ---------- Automatisch opslaan ----------
  var timers = {};
  var reeks = Promise.resolve(); // opslaan na elkaar, in volgorde

  function zetStatus(veld, tekst, soort) {
    var el = document.querySelector('[data-status="' + veld + '"]');
    if (el) { el.textContent = tekst || ''; el.className = 'veld-status' + (soort ? ' ' + soort : ''); }
  }

  function bewaar(veld, waarde, direct) {
    if (!huidig || !huidig.mag_bewerken) return;
    clearTimeout(timers[veld]);
    var id = huidig.id;
    var doe = function () {
      zetStatus(veld, 'Opslaan…');
      reeks = reeks.then(function () {
        return roep('bewaar', [id, veld, waarde]).then(function (r) {
          if (!huidig || huidig.id !== id) return;
          if (r.fout) { zetStatus(veld, r.fout, 'fout'); return; }
          huidig[veld] = r.waarde;
          zetStatus(veld, r.waarschuwing || 'Opgeslagen', r.waarschuwing ? 'fout' : 'ok');
          if (veld === 'bsn') toonBsnOpgeslagen(r.waarde);
          if (veld === 'customer_facing_email' || veld === 'email_doorsturen') {
            var el = document.querySelector('[data-veld="' + veld + '"]');
            if (el && document.activeElement !== el) el.value = r.waarde;
          }
        }).catch(function (e) { zetStatus(veld, e.message, 'fout'); });
      });
    };
    if (direct) doe(); else timers[veld] = setTimeout(doe, 900);
  }

  function toonBsnOpgeslagen(gemaskeerd) {
    var invoer = $('v-bsn');
    huidig.heeft_bsn = !!gemaskeerd;
    huidig.bsn_gemaskeerd = gemaskeerd;
    $('bsn-waarde').textContent = gemaskeerd;
    $('bsn-tonen').hidden = !gemaskeerd;
    if (gemaskeerd) { invoer.value = ''; invoer.hidden = true; }
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

  var detail = $('detailInhoud');
  detail.addEventListener('input', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-veld')) {
      var veld = el.getAttribute('data-veld');
      if (veld === 'fee_percentage') werkVoorbeeldBij();
      if (veld === 'bsn' && el.value.replace(/\D/g, '').length < 9) return; // pas bewaren als het compleet is
      bewaar(veld, el.value);
    } else if (el.closest('[data-tijden]')) {
      // tijden pas bij verlaten van het vak (halve tijden zijn nog ongeldig)
    } else if (el.hasAttribute('data-k')) {
      bewaar('bezorggebied', groepenUitScherm());
    }
  });
  detail.addEventListener('change', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-veld')) bewaar(el.getAttribute('data-veld'), el.value, true);
    else if (el.closest('[data-tijden]')) {
      var veld = el.closest('[data-tijden]').getAttribute('data-tijden');
      bewaar(veld, tijdenUitScherm(veld), true);
    } else if (el.hasAttribute('data-k')) bewaar('bezorggebied', groepenUitScherm(), true);
  });

  detail.addEventListener('click', function (e) {
    var keuze = e.target.closest('[data-keuze] button');
    if (keuze && !keuze.disabled) {
      var groep = keuze.closest('[data-keuze]');
      var veld = groep.getAttribute('data-keuze');
      var waarde = keuze.getAttribute('data-waarde');
      zetKeuze(groep, waarde);
      huidig[veld] = waarde;
      werkZichtbaarheidBij();
      bewaar(veld, waarde, true);
      return;
    }
    var knop = e.target.closest('[data-actie]');
    if (!knop) return;
    var actie = knop.getAttribute('data-actie');
    if (actie === 'terug') { sluitDetail(); laad(); return; }
    if (actie === 'toon-bsn') {
      if (knop.textContent === 'Verberg') { $('bsn-waarde').textContent = huidig.bsn_gemaskeerd; knop.textContent = 'Toon'; return; }
      roep('toonBsn', [huidig.id]).then(function (r) {
        $('bsn-waarde').textContent = r.bsn;
        knop.textContent = 'Verberg';
      }).catch(function (err) { toon(err.message, true); });
      return;
    }
    if (actie === 'wijzig-bsn') { $('bsn-tonen').hidden = true; $('v-bsn').hidden = false; $('v-bsn').focus(); return; }
    if (actie === 'groep-erbij') {
      var groepen = groepenUitScherm();
      groepen.push({ postcodes: '', moa: inst.standaard_moa, bezorgkosten: inst.standaard_bezorgkosten,
        gratisVanaf: inst.standaard_gratis_vanaf });
      $('groepen').innerHTML = groepen.map(function (g, i) { return groepHtml(g, i, false); }).join('');
      return;
    }
    if (actie === 'groep-weg') {
      var rest = groepenUitScherm().filter(function (g, i) { return i !== Number(knop.getAttribute('data-groep')); });
      $('groepen').innerHTML = rest.map(function (g, i) { return groepHtml(g, i, false); }).join('');
      bewaar('bezorggebied', rest, true);
      return;
    }
    if (actie === 'ingevuld') return statusActie(knop, 'ingevuld', 'Controleren…', 'Ingevuld. Status: Wacht op controle.');
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
    Object.keys(timers).forEach(function (v) { clearTimeout(timers[v]); });
    var herstel = bezig(knop, bezigTekst);
    var id = huidig.id;
    reeks.then(function () { return roep(fn, [id]); }).then(function (r) {
      herstel();
      if (r.fouten) {
        Object.keys(r.fouten).forEach(function (v) { zetStatus(v, r.fouten[v], 'fout'); });
        toonControleFouten(fn === 'akkoord' ? r.fouten : null);
        var eerste = document.querySelector('.veld-status.fout');
        if (eerste) eerste.closest('.veld').scrollIntoView({ behavior: 'smooth', block: 'center' });
        toon('Nog niet alles is goed ingevuld.', true);
        return;
      }
      toon(klaarTekst);
      toonDetail(r);
      $('detail').scrollTop = 0;
    }).catch(function (err) { herstel(); toon(err.message, true); });
  }

  // ---------- Start ----------
  if (sessie) toonApp(); else toonLogin();
})();
