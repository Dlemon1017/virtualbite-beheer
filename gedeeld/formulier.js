/*
 * Gedeelde formulierlogica voor de beheerpagina ("Samen invullen", controlescherm) en de partnerpagina (fase 3).
 * Velden tekenen, direct controleren, automatisch opslaan (per veld, de laatste klik wint), adres opzoeken (PDOK),
 * postcoderegels, tijden, afstanden en de uitleg (ⓘ). De regels zelf komen uit gedeeld/*.js (dezelfde als de server).
 *
 * Gebruik: var f = VBFormulier({ root, api, inst, beheer, naWijziging, naInvoer, melding });
 *   api.bewaar(veld, waarde, volgnr) → Promise<antwoord>, api.afstanden(regels) → Promise, api.btw() → Promise,
 *   api.toonBsn() → Promise (alleen beheer). inst() geeft de instellingen (standaardbedragen, grens_km, cf_domein).
 *   f.huidig = de partner (gegevens zoals de server ze geeft); f.stapVelden(stap, p, uit) geeft de HTML.
 */
(function () {
  'use strict';

  var STORING = 'De server van Google reageert even niet. Probeer het zo opnieuw.';
  var DAGNAMEN = { ma: 'Ma', di: 'Di', wo: 'Wo', do: 'Do', vr: 'Vr', za: 'Za', zo: 'Zo' };
  var ADRES_VELDEN = /^(vestiging|locatie)_(postcode|huisnummer|toevoeging|straat|plaats)$/;
  var BTW_FORMAAT = 'Vul het btw-id in als NL123456789B01 (NL, 9 cijfers, B, 2 cijfers).';

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function veldDef(veld) {
    return alleFormulierVelden().filter(function (x) { return x.veld === veld; })[0] || null;
  }

  function zetKeuze(groep, waarde) {
    groep.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-waarde') === waarde));
    });
  }

  // ---------- Uitleg (ⓘ): één tooltip voor de hele pagina ----------
  var uitlegVan = null;
  function uitlegEl() {
    var u = document.getElementById('uitleg');
    if (!u) {
      u = document.createElement('div');
      u.id = 'uitleg';
      u.setAttribute('role', 'tooltip');
      u.hidden = true;
      document.body.appendChild(u);
    }
    return u;
  }
  function infoKnop(veld, label) {
    return UITLEG[veld] ? '<button type="button" class="info" data-uitleg="' + esc(veld) + '" aria-label="Uitleg bij ' +
      esc(label) + '" aria-expanded="false">i</button>' : '';
  }
  function toonUitleg(knop) {
    var u = uitlegEl();
    if (uitlegVan === knop) { sluitUitleg(); return; }
    sluitUitleg();
    u.textContent = uitlegTekst(knop.getAttribute('data-uitleg')); // met de minimale openingstijd uit Instellingen
    u.hidden = false;
    var r = knop.getBoundingClientRect();
    var breed = u.offsetWidth;
    u.style.position = 'fixed';
    u.style.left = Math.max(16, Math.min(r.left - 8, document.documentElement.clientWidth - breed - 16)) + 'px';
    u.style.top = (r.bottom + 8) + 'px';
    knop.setAttribute('aria-expanded', 'true');
    uitlegVan = knop;
  }
  function sluitUitleg() {
    uitlegEl().hidden = true;
    if (uitlegVan) uitlegVan.setAttribute('aria-expanded', 'false');
    uitlegVan = null;
  }
  document.addEventListener('click', function (e) {
    var knop = e.target.closest && e.target.closest('[data-uitleg]');
    if (knop) { e.preventDefault(); toonUitleg(knop); return; }
    if (!(e.target.closest && e.target.closest('#uitleg'))) sluitUitleg();
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
  window.addEventListener('scroll', sluitUitleg, true);

  /** Samenvatting van een stap (alleen-lezen), in de volgorde van het formulier. Beheer (controle) en partner (overzicht). */
  window.VBSamenvatting = function (stap, p) {
    var regels = [];
    stap.velden.forEach(function (d) {
      if (!veldZichtbaar(d, p) || /_(huisnummer|toevoeging)$/.test(d.veld)) return;
      var w;
      if (d.rij) { // adres: als één regel
        var pre = d.veld.replace('_postcode', '_');
        w = [p[pre + 'straat'], huisnummerMetToevoeging(p[pre + 'huisnummer'], p[pre + 'toevoeging'])].filter(Boolean).join(' ') +
          ', ' + [p[pre + 'postcode'], p[pre + 'plaats']].filter(Boolean).join(' ');
        regels.push([d.kop, w.replace(/^, |, $/, '')]);
        return;
      }
      if (/_(straat|plaats)$/.test(d.veld) && /^(vestiging|locatie)_/.test(d.veld)) return;
      if (d.soort === 'keuze') w = (KEUZES[d.keuzes].filter(function (k) { return k[0] === p[d.veld]; })[0] || ['', ''])[1];
      else if (d.soort === 'vinkje') w = p[d.veld] === 'ja' ? 'Ja' : 'Nee';
      else if (d.soort === 'bsn') w = p.bsn_gemaskeerd;
      else if (d.soort === 'postcoderegels') w = postcodeRegels(p[d.veld]).join('\n'); // per regel onder elkaar
      else if (d.soort === 'tijden') { // per dag een eigen regel: "Vr  11:30-14:00 en 16:30-22:00"
        var t = leesTijden(p[d.veld]);
        w = DAGEN.filter(function (dag) { return (t[dag] || []).some(Boolean); }).map(function (dag) {
          return DAGNAMEN[dag] + '  ' + t[dag].filter(Boolean).join(' en ');
        }).join('\n');
      } else w = p[d.veld];
      if (d.veld === 'btw_id' && p.btw_vies) w += ' (' + p.btw_vies + ')';
      regels.push([d.label, w]);
    });
    return '<dl>' + regels.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + (r[1] ? esc(r[1]) : '<span class="leeg-waarde">–</span>') + '</dd></div>';
    }).join('') + '</dl>';
  };

  window.VBSluitUitleg = sluitUitleg;
  window.VBZetKeuze = zetKeuze;

  window.VBFormulier = function (cfg) {
    var root = cfg.root;
    var f = { huidig: null };
    var $ = function (id) { return document.getElementById(id); };
    var q = function (sel) { return root.querySelector(sel); };
    var qa = function (sel) { return root.querySelectorAll(sel); };
    var inst = function () { return cfg.inst() || {}; };
    var naWijziging = function () { if (cfg.naWijziging) cfg.naWijziging(); };

    // ---------- Velden tekenen ----------
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
          (w === 'ja' ? ' checked' : '') + dis + '> ' + esc(d.label) + '</label>'; // standaard uit
      }
      if (d.soort === 'tijden') return '<div class="rooster" data-rooster="' + esc(d.veld) + '">' + roosterInhoud(d.veld, p, uit) + '</div>';
      if (d.soort === 'bsn') {
        return '<div class="bsn-rij" id="bsn-tonen"' + (p.heeft_bsn ? '' : ' hidden') + '><span class="waarde" id="bsn-waarde">' +
          esc(p.bsn_gemaskeerd) + '</span>' +
          (cfg.api.toonBsn ? '<button type="button" class="klein-knop" data-actie="toon-bsn">Toon</button>' : '') +
          (uit ? '' : '<button type="button" class="klein-knop" data-actie="wijzig-bsn">Wijzigen</button>') + '</div>' +
          '<input id="' + id + '" data-veld="bsn" inputmode="numeric" autocomplete="off"' + vb + (p.heeft_bsn ? ' hidden' : '') + dis + '>';
      }
      if (d.soort === 'postcoderegels') return postcodeRegelsHtml(w, uit);
      var type = d.soort === 'email' ? ' type="email" inputmode="email" autocapitalize="off"' :
        d.soort === 'telefoon' ? ' type="tel" inputmode="tel"' :
        ['kvk', 'cijfers', 'huisnummer'].indexOf(d.soort) !== -1 ? ' inputmode="numeric"' : '';
      return '<input id="' + id + '" data-veld="' + esc(d.veld) + '" value="' + esc(w) + '"' + type + vb + ' autocomplete="off"' + dis + '>';
    }

    // ---------- Tijden: rooster (dagen, één openingstijd, afwijkende dagen, middag; logica in gedeeld/Rooster.js) ----------
    // Kwartieren, beginnend bij 06:00 (na middernacht onderaan: 00:00-05:45).
    var KWARTIEREN = (function () {
      var uit = [];
      for (var m = 6 * 60; m < 30 * 60; m += 15) {
        var u = Math.floor(m / 60) % 24;
        uit.push((u < 10 ? '0' : '') + u + ':' + (m % 60 < 10 ? '0' : '') + (m % 60));
      }
      return uit;
    })();

    /**
     * Opties van één keuzelijst. "van": de hele lijst (06:00-05:45); de lege keuze staat vóór `anker` (16:00, bij de
     * middag 11:00), zodat de lijst daar opent. "tot": alleen tijden ná "van" (door over middernacht, tot 05:45); de lege
     * keuze bovenaan, dus de lijst opent bij de eerste tijd na "van".
     */
    function tijdOpties(kant, waarde, van, leegTekst, anker) {
      var lijst = kant === 'tot' && van ? KWARTIEREN.filter(function (x) { return dagMinuut(x) > dagMinuut(van); }) : KWARTIEREN.slice();
      if (waarde && lijst.indexOf(waarde) === -1) lijst.unshift(waarde); // oude waarde buiten de lijst: niet kwijtraken
      var leegVoor = kant === 'tot' && van ? lijst[0] : anker;
      var leeg = '<option value=""' + (waarde ? '' : ' selected') + '>' + esc(leegTekst) + '</option>';
      return lijst.map(function (x) {
        return (x === leegVoor ? leeg : '') + '<option' + (x === waarde ? ' selected' : '') + '>' + x + '</option>';
      }).join('') + (lijst.indexOf(leegVoor) === -1 ? leeg : '');
    }

    /** Eén tijd (van of tot). soort: alg | dag | middag. */
    function tijdKiezer(vak, soort, dag, kant, x, leegTekst, naam, dis) {
      var anker = soort === 'middag' ? (kant === 'van' ? '11:00' : '14:00') : (kant === 'van' ? '16:00' : '21:00');
      return '<select data-rsoort="' + soort + '" data-dag="' + dag + '" data-kant="' + kant + '" aria-label="' + esc(naam + ', ' + kant) +
        '"' + (x[kant] ? '' : ' class="leeg"') + dis + '>' + tijdOpties(kant, x[kant], kant === 'tot' ? x.van : '', leegTekst, anker) +
        '</select>';
    }

    function vanTotHtml(vak, soort, dag, x, naam, dis, metLabels, voorbeeld) {
      var kies = function (kant) {
        var k = tijdKiezer(vak, soort, dag, kant, x, voorbeeld ? 'Bijv. ' + voorbeeld[kant] : '–', naam, dis);
        return metLabels ? '<label class="kiezer"><span>' + kant + '</span>' + k + '</label>' : k;
      };
      return '<div class="blok">' + kies('van') + '<span class="streep">–</span>' + kies('tot') + '</div>';
    }

    var roosters = {}; // vak → {p, r}: wat op het scherm staat (ook open dagen zonder tijd)
    var afhaalZelfde = { p: null, ja: null };

    function vasteDagen(vak) { return vak === 'bezorgtijden' ? VERPLICHTE_DAGEN : []; }

    function rooster(vak, p) {
      if (!roosters[vak] || roosters[vak].p !== p) roosters[vak] = { p: p, r: roosterUitTijden(p[vak], vasteDagen(vak)) };
      return roosters[vak].r;
    }

    function normTijden(x) { return JSON.stringify(tijdenUitRooster(roosterUitTijden(x))); }

    /** Afhalen op dezelfde tijden als bezorgen? Standaard ja (ook als er nog geen afhaaltijden zijn). */
    function zelfdeAlsBezorg(p) {
      if (afhaalZelfde.p !== p) {
        var leeg = !DAGEN.some(function (d) { return (leesTijden(p.afhaaltijden)[d] || []).some(Boolean); });
        afhaalZelfde = { p: p, ja: leeg || normTijden(p.afhaaltijden) === normTijden(p.bezorgtijden) };
      }
      return afhaalZelfde.ja;
    }

    function keuzeKnoppen(soort, ja, dis) {
      return '<div class="keuze" data-rkeuze="' + soort + '" role="group">' + [['ja', 'Ja'], ['nee', 'Nee']].map(function (k) {
        return '<button type="button" data-waarde="' + k[0] + '" aria-pressed="' + (ja === (k[0] === 'ja')) + '"' + dis + '>' + k[1] + '</button>';
      }).join('') + '</div>';
    }

    function roosterInhoud(vak, p, uit) {
      var dis = uit ? ' disabled' : '';
      var h = '';
      if (vak === 'afhaaltijden') {
        var zelfde = zelfdeAlsBezorg(p);
        h += '<div class="sub-label">Zelfde tijden als bezorgen?</div>' + keuzeKnoppen('zelfde', zelfde, dis);
        if (zelfde) return h + '<div class="klein mt">Afhalen kan op dezelfde dagen en tijden als bezorgen.</div>';
      }
      var r = rooster(vak, p);
      var vast = vasteDagen(vak);
      var open = DAGEN.filter(function (d) { return r.dagen[d]; });
      h += '<div class="sub-label">Op welke dagen ben je open?</div><div class="dag-vinkjes">' + DAGEN.map(function (d) {
        return '<label class="dag-vink"><input type="checkbox" data-rdag="' + d + '"' + (r.dagen[d] ? ' checked' : '') +
          (uit || vast.indexOf(d) !== -1 ? ' disabled' : '') + ' aria-label="' + DAG_NAAM[d] + '"><span>' + DAGNAMEN[d] + '</span></label>';
      }).join('') + '</div>';
      if (vast.length) h += '<div class="klein">Vr, Za en Zo zijn verplicht volgens de overeenkomst.</div>';
      if (vak === 'bezorgtijden' && open.length < MIN_OPEN_DAGEN) {
        h += '<div class="klein let-tekst">Kies minimaal ' + MIN_OPEN_DAGEN + ' dagen: vrijdag, zaterdag, zondag en 2 andere.</div>';
      }
      h += '<div class="sub-label">Openingstijd</div>' + vanTotHtml(vak, 'alg', '', r.alg, 'Openingstijd', dis, true,
        { van: '17:00', tot: '22:00' }) + '<div class="klein">Geldt voor alle open dagen; per dag kun je afwijken.</div>';
      if (open.length) {
        h += '<div class="dag-lijst">' + open.map(function (d) {
          var hoofd = roosterHoofd(r, d);
          var regel = '<div class="dag-regel"><span class="dag">' + DAGNAMEN[d] + '</span>' + (r.afwijk[d] ?
            vanTotHtml(vak, 'dag', d, r.afwijk[d], DAG_NAAM[d], dis, false) +
              (uit ? '' : '<button type="button" class="tekst-knop" data-ractie="terug" data-dag="' + d + '">zelfde</button>') :
            '<span class="tijd">' + (hoofd.van && hoofd.tot ? hoofd.van + ' – ' + hoofd.tot : '–') + '</span>' +
              (uit ? '' : '<button type="button" class="tekst-knop" data-ractie="wijzig" data-dag="' + d + '">wijzig</button>')) + '</div>';
          if (r.middagJa) {
            regel += '<div class="dag-regel middag"><span class="dag">middag</span>' + vanTotHtml(vak, 'middag', d, r.middag[d] ||
              { van: '', tot: '' }, DAG_NAAM[d] + ' middag', dis, false) + '<span></span></div>';
          }
          return regel;
        }).join('') + '</div>';
      }
      h += '<div class="sub-label">Ben je op sommige dagen ook \'s middags open?</div>' + keuzeKnoppen('middag', r.middagJa, dis);
      if (r.middagJa) h += '<div class="klein">Vul de middag in bij de dagen waarop je ook \'s middags open bent (optioneel).</div>';
      return h;
    }

    function tekenRooster(vak) {
      var el = q('[data-rooster="' + vak + '"]');
      if (el) el.innerHTML = roosterInhoud(vak, f.huidig, !f.huidig.mag_bewerken);
    }

    /** Na een wijziging: opnieuw tekenen, opslaan, en afhaaltijden zo nodig meenemen. */
    function roosterGewijzigd(vak) {
      tekenRooster(vak);
      var t = tijdenUitRooster(roosters[vak].r);
      f.huidig[vak] = t;
      var st = q('[data-status="' + vak + '"]');
      if (st && st.classList.contains('fout') && !f.halveTijden(vak)) zetStatus(vak, ''); // melding weg als het nu klopt
      bewaar(vak, t, true);
      if (vak === 'bezorgtijden') f.volgAfhaaltijden();
    }

    /** "Zelfde tijden als bezorgen": afhaaltijden = bezorgtijden (en blijven meeveranderen). */
    f.volgAfhaaltijden = function () {
      var p = f.huidig;
      if (!p || !p.mag_bewerken || p.afhalen !== 'ja' || !zelfdeAlsBezorg(p)) return;
      var bezorg = roosters.bezorgtijden && roosters.bezorgtijden.p === p ? tijdenUitRooster(roosters.bezorgtijden.r) :
        tijdenUitRooster(roosterUitTijden(p.bezorgtijden));
      if (normTijden(p.afhaaltijden) === JSON.stringify(bezorg)) return;
      p.afhaaltijden = bezorg;
      roosters.afhaaltijden = null;
      bewaar('afhaaltijden', bezorg, true);
    };

    function roosterWijziging(el) {
      var vak = el.closest('[data-rooster]').getAttribute('data-rooster');
      var r = rooster(vak, f.huidig);
      if (el.hasAttribute('data-rdag')) {
        r.dagen[el.getAttribute('data-rdag')] = el.checked;
      } else if (el.hasAttribute('data-rsoort')) {
        var soort = el.getAttribute('data-rsoort');
        var dag = el.getAttribute('data-dag');
        var x = soort === 'alg' ? r.alg : soort === 'dag' ? r.afwijk[dag] : (r.middag[dag] = r.middag[dag] || { van: '', tot: '' });
        x[el.getAttribute('data-kant')] = el.value;
        if (x.van && x.tot && dagMinuut(x.tot) <= dagMinuut(x.van)) x.tot = ''; // "tot" moet na "van" liggen
      } else return;
      roosterGewijzigd(vak);
    }

    function roosterKlik(knop) {
      var vak = knop.closest('[data-rooster]').getAttribute('data-rooster');
      var groep = knop.closest('[data-rkeuze]');
      if (groep) {
        var ja = knop.getAttribute('data-waarde') === 'ja';
        if (groep.getAttribute('data-rkeuze') === 'zelfde') {
          afhaalZelfde = { p: f.huidig, ja: ja };
          roosters.afhaaltijden = null; // bij "Nee": verder vanaf de huidige (gekopieerde) tijden
          tekenRooster(vak);
          if (ja) f.volgAfhaaltijden();
          return;
        }
        rooster(vak, f.huidig).middagJa = ja;
      } else {
        var r = rooster(vak, f.huidig);
        var dag = knop.getAttribute('data-dag');
        if (knop.getAttribute('data-ractie') === 'wijzig') r.afwijk[dag] = { van: r.alg.van, tot: r.alg.tot };
        else delete r.afwijk[dag];
      }
      roosterGewijzigd(vak);
    }

    // Postcoderegels (partner): max. 5, elk één postcode of reeks.
    function postcodeRegelsHtml(w, uit) {
      var regels = postcodeRegels(w);
      var n = Math.min(MAX_POSTCODEREGELS, Math.max(3, regels.length));
      var h = '<div class="klein">' + esc(standaardBedragenTekst(inst(), inst().grens_km || 6)) + '</div><div id="pc-regels">';
      for (var i = 0; i < n; i++) h += postcodeRegelHtml(i, regels[i] || '', uit);
      return h + '</div><div class="grens-uitleg" id="pc-uitleg" hidden></div>' +
        (uit ? '' : '<button type="button" class="klein-knop mt" data-actie="pc-erbij"' +
        (n >= MAX_POSTCODEREGELS ? ' hidden' : '') + '>+ Postcode toevoegen</button>') +
        '<div class="klein afstand-status" id="afstandStatus" hidden></div>';
    }

    function postcodeRegelHtml(i, waarde, uit) {
      return '<div class="pc-regel"><label for="pc-' + i + '">Postcode ' + (i + 1) + '</label>' +
        '<input id="pc-' + i + '" data-pcregel="' + i + '" value="' + esc(waarde) + '" type="text" autocomplete="off" autocorrect="off" spellcheck="false"' + // gewoon toetsenbord: "-" en "," nodig
        (i === 0 ? ' placeholder="Bijv. 8231-8245"' : '') + (uit ? ' disabled' : '') + '>' +
        '<div class="fout" data-pcregel-fout="' + i + '"></div><div class="rij-melding" data-pcregel-melding="' + i + '" hidden></div></div>';
    }

    function pcRegelsUitScherm() {
      return Array.prototype.map.call(qa('[data-pcregel]'), function (el) { return el.value.trim(); });
    }

    /** Melding per regel (formaat, één reeks, dubbel), zonder serveraanroep. */
    function controleerPcRegels() {
      var waarden = pcRegelsUitScherm();
      var gevuld = [];
      waarden.forEach(function (v, i) { if (v) gevuld.push(i); });
      var r = controleerPostcodeRegels(gevuld.map(function (i) { return waarden[i]; }));
      qa('[data-pcregel-fout]').forEach(function (el) { el.textContent = ''; });
      Object.keys(r.regelFouten).forEach(function (k) {
        var el = q('[data-pcregel-fout="' + gevuld[Number(k)] + '"]');
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
    f.stapVelden = function (stap, p, uit) {
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
    };

    function veldBlok(d, p, uit) {
      return '<div class="veld" data-rij="' + esc(d.veld) + '">' + labelHtml(d) + veldInvoer(d, p, uit) +
        '<div class="veld-status" data-status="' + esc(d.veld) + '"></div></div>';
    }

    f.werkZichtbaarheidBij = function () {
      if (!f.huidig) return;
      alleFormulierVelden().forEach(function (d) {
        var zicht = veldZichtbaar(d, f.huidig);
        var rij = q('[data-rij="' + d.veld + '"]');
        if (rij) rij.hidden = !zicht;
        var kop = q('[data-kop="' + d.veld + '"]');
        if (kop) kop.hidden = !zicht;
      });
      qa('.veld-rij').forEach(function (r) {
        r.hidden = !Array.prototype.some.call(r.children, function (c) { return !c.hidden; });
      });
    };

    /** Na het plaatsen van de HTML: zichtbaarheid, markering en knoppen bijwerken. */
    f.naTekenen = function () {
      f.werkZichtbaarheidBij();
      f.volgAfhaaltijden();
      f.toonMarkering(f.huidig && f.huidig.markering);
      naWijziging();
    };

    // ---------- Bezorggebied (5 rijen, alleen beheer) ----------
    f.leesRijen = function (w) {
      var g = leesTijden(w);
      var rijen = Array.isArray(g) ? g : [];
      var i = inst();
      while (rijen.length < 5) {
        rijen.push({ postcodes: '', moa: i.standaard_moa, bezorgkosten: i.standaard_bezorgkosten, gratisVanaf: i.standaard_gratis_vanaf });
      }
      return rijen.slice(0, 5);
    };

    function bedragTekst(x) {
      return typeof x === 'number' && isFinite(x) ? formatGetal(x, true) : String(x == null || x === 'NaN' ? '' : x);
    }

    /** De 5 rijen van het TB-formulier (alleen in het controlescherm): postcodes, afstand en bedragen per rij. */
    f.rijenHtml = function (p, uit) {
      var dis = uit ? ' disabled' : '';
      return '<div class="klein">Gewenst door de partner: ' + esc(postcodeRegels(p.postcodes_gewenst).join(', ') || '–') +
        '</div><div id="rijen">' + f.leesRijen(p.bezorggebied).map(function (r, i) {
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
        'liggen. Postcodes boven ' + esc(String(inst().grens_km || 6).replace('.', ',')) + ' km staan vooraf in rij 2: vul daar ' +
        'de bedragen in. Verplaats postcodes gerust tussen de rijen.</div>';
    };

    f.rijenUitScherm = function () {
      var rijen = [];
      qa('#rijen [data-k]').forEach(function (el) {
        var i = Number(el.getAttribute('data-rij-nr'));
        rijen[i] = rijen[i] || {};
        rijen[i][el.getAttribute('data-k')] = el.value;
      });
      return rijen.filter(Boolean);
    };

    /** Markering: per postcoderegel de korte ⚠-regel + uitleg; in het controlescherm km, wijk en bereik per rij. */
    f.toonMarkering = function (m) {
      if (!m) return;
      var beheer = !!q('#controle');
      var ergensVer = false;
      qa('[data-pcregel]').forEach(function (inp) {
        var i = inp.getAttribute('data-pcregel');
        var el = q('[data-pcregel-melding="' + i + '"]');
        var hier = leesPostcodes(inp.value).postcodes.filter(function (pc) { return (m.boven || []).indexOf(pc) !== -1; });
        el.innerHTML = hier.length ? '<div class="grens-tekst">' + esc(grensRegel(hier, m.grens_km)) + '</div>' : '';
        el.hidden = !hier.length;
        ergensVer = ergensVer || hier.length > 0;
      });
      var uitleg = $('pc-uitleg');
      if (uitleg) { uitleg.textContent = ergensVer ? grensUitleg(m.grens_km) : ''; uitleg.hidden = !ergensVer; }
      (m.rijen || []).forEach(function (r, i) {
        var el = q('[data-rij-melding="' + i + '"]');
        var blok = q('[data-bezorgrij="' + i + '"]');
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
    };

    // ---------- Afstanden (los van het opslaan) ----------
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
     * Afstanden na een korte pauze in typen. In het formulier gaan de postcoderegels zoals ze nu op het scherm staan mee.
     * De server doet per keer hooguit 8 nieuwe postcodes; zolang het onvolledig is vragen we door. Alleen het laatste
     * verzoek telt.
     */
    f.planAfstanden = function (direct) {
      clearTimeout(afstandTimer);
      if (!f.huidig) return;
      afstandTimer = setTimeout(function () { haalAfstanden(++afstandNr, 0); }, direct ? 0 : 1200);
    };

    function haalAfstanden(nr, ronde) {
      var p = f.huidig;
      if (!p || nr !== afstandNr) return;
      var regels = q('[data-pcregel]') ? pcRegelsUitScherm() : null;
      zetAfstandStatus('Afstanden berekenen…');
      cfg.api.afstanden(regels).then(function (r) {
        if (nr !== afstandNr || f.huidig !== p) return;
        p.markering = r.markering;
        f.toonMarkering(r.markering);
        if (r.onvolledig && ronde < 10) { haalAfstanden(nr, ronde + 1); return; }
        zetAfstandStatus(r.melding ? 'Afstanden berekenen lukte niet.' : '', !!r.melding);
      }).catch(function () {
        if (nr !== afstandNr) return;
        zetAfstandStatus('Afstanden berekenen lukte niet: de server reageert even niet.', true);
      });
    }

    // ---------- Status, directe controle en automatisch opslaan ----------
    f.zetStatus = function (veld, tekst, soort) {
      var el = q('[data-status="' + veld + '"]');
      if (el) { el.textContent = tekst || ''; el.className = 'veld-status' + (soort ? ' ' + soort : ''); }
    };
    var zetStatus = f.zetStatus;

    /** Bij typen: een rode melding verdwijnt zodra de waarde klopt (lege velden pas bij "Ingevuld"/"Versturen"). */
    function controleerDirect(veld, waarde, strikt) {
      var d = veldDef(veld);
      var el = q('[data-status="' + veld + '"]');
      if (!d || !el) return true;
      var tekst = String(waarde == null ? '' : waarde).trim();
      var fout = tekst ? controleerVeld(d, tekst).fout : '';
      if (fout && strikt) { zetStatus(veld, fout, 'fout'); return false; }
      if (!fout && el.classList.contains('fout') && (tekst || !d.verplicht)) zetStatus(veld, '');
      return !fout;
    }

    var timers = {};
    var wachtend = {}; // veld → opslaan dat nog moet gebeuren (na de korte pauze bij typen)
    var lopend = {};   // veld → {bezig: Promise | null, volgende: {waarde} | null}
    var laatsteVolgnr = 0;
    /** Oplopend volgnummer: de server negeert een opslagverzoek dat ouder is dan het laatst verwerkte voor dat veld. */
    function nieuwVolgnr() {
      laatsteVolgnr = Math.max(laatsteVolgnr + 1, Date.now() * 1000);
      return laatsteVolgnr;
    }

    /** Wacht tot er per veld geen verzoek meer onderweg is. */
    f.wachtTotOpgeslagen = function () {
      var bezig = Object.keys(lopend).map(function (v) { return lopend[v].bezig; }).filter(Boolean);
      if (!bezig.length) return Promise.resolve();
      return Promise.all(bezig.map(function (b) { return b.catch(function () {}); })).then(f.wachtTotOpgeslagen);
    };

    /** Alles wat nog wacht nu opslaan (vóór "Ingevuld", "Versturen", "Akkoord" of een ander scherm). */
    f.slaWachtendOp = function () {
      Object.keys(wachtend).forEach(function (v) {
        clearTimeout(timers[v]);
        var doe = wachtend[v];
        delete wachtend[v];
        doe();
      });
      return f.wachtTotOpgeslagen();
    };

    /**
     * Veld opslaan. Per veld is er hooguit één verzoek onderweg; komt er intussen een nieuwe waarde (snel klikken), dan
     * gaat alleen de laatste daarna nog. Antwoorden op oudere waarden worden genegeerd: de laatste klik wint en het
     * scherm blijft leidend. "Opslaan…" eindigt altijd in "Opgeslagen" of een melding.
     */
    f.bewaar = function (veld, waarde, direct) {
      if (!f.huidig || !f.huidig.mag_bewerken) return;
      clearTimeout(timers[veld]);
      var doe = function () { delete wachtend[veld]; verstuur(veld, waarde); };
      if (direct) doe(); else { wachtend[veld] = doe; timers[veld] = setTimeout(doe, 900); }
    };
    var bewaar = f.bewaar;

    function verstuur(veld, waarde) {
      var s = lopend[veld] || (lopend[veld] = { bezig: null, volgende: null, timer: null });
      // "Opslaan…" pas na ±1 s: meestal is het dan al klaar, en dan voelt het sneller (opslaan gaat op de achtergrond).
      clearTimeout(s.timer);
      s.timer = setTimeout(function () { zetStatus(veld, 'Opslaan…'); }, 1000);
      if (s.bezig) { s.volgende = { waarde: waarde }; return; }
      var p = f.huidig;
      var volgende = function () {
        clearTimeout(s.timer);
        s.bezig = null;
        if (!s.volgende) return false;
        var v = s.volgende.waarde;
        s.volgende = null;
        if (f.huidig === p) verstuur(veld, v);
        return true;
      };
      s.bezig = cfg.api.bewaar(veld, waarde, nieuwVolgnr()).then(function (r) {
        if (volgende()) return; // er is al een nieuwere waarde: dit antwoord is verouderd
        if (f.huidig !== p) return;
        if (r.verouderd) { zetStatus(veld, 'Opgeslagen', 'ok'); return; }
        verwerkOpgeslagen(veld, r);
      }, function (e) {
        if (volgende()) return;
        zetStatus(veld, e && e.message === STORING ? 'Opslaan lukte niet: de server reageert even niet. Pas het veld ' +
          'opnieuw aan of probeer het zo opnieuw.' : (e && e.message) || 'Opslaan lukte niet.', 'fout');
      });
    }

    function verwerkOpgeslagen(veld, r) {
      if (r.fout) { zetStatus(veld, r.fout, 'fout'); return; }
      var d = veldDef(veld);
      // Keuzes, vinkjes, tijden en postcoderegels: wat op het scherm staat is leidend (niet overschrijven).
      if (!d || ['keuze', 'vinkje', 'tijden', 'postcoderegels'].indexOf(d.soort) === -1) f.huidig[veld] = r.waarde;
      // Rood = blokkeert (zelfde regels als de server); geel = alleen een waarschuwing.
      var nietBlokkerend = veld === 'bezorgtijden';
      var melding = r.fout_extern || r.waarschuwing;
      zetStatus(veld, melding || r.info || 'Opgeslagen', melding ? (nietBlokkerend && !r.fout_extern ? 'let' : 'fout') : 'ok');
      if (veld === 'bsn') toonBsnOpgeslagen(r.waarde);
      if (veld === 'btw_id') { f.huidig.btw_vies = ''; if (r.waarde) controleerBtw(); }
      if (veld === 'customer_facing_email' || veld === 'email_doorsturen') {
        var el = q('[data-veld="' + veld + '"]');
        if (el && document.activeElement !== el) el.value = r.waarde;
      }
      if (veld === 'bezorggebied' || veld === 'locatie_zelfde' || ADRES_VELDEN.test(veld)) f.planAfstanden();
      naWijziging();
    }

    /** VIES-controle (los van het opslaan). Een storing blokkeert niet: nette melding, later opnieuw. */
    function controleerBtw() {
      var p = f.huidig;
      zetStatus('btw_id', 'Opgeslagen · controleren bij de EU…');
      cfg.api.btw().then(function (r) {
        if (f.huidig !== p) return;
        if (r.btw_vies !== undefined) p.btw_vies = r.btw_vies;
        zetStatus('btw_id', r.fout || r.waarschuwing || r.info || 'Opgeslagen', r.fout ? 'fout' : r.waarschuwing ? 'let' : 'ok');
        naWijziging();
      }).catch(function () {
        zetStatus('btw_id', 'BTW-nummer kon nu niet bij de EU worden gecontroleerd; we proberen het later opnieuw.', 'let');
      });
    }

    var btwTimer = null;

    function toonBsnOpgeslagen(gemaskeerd) {
      f.huidig.heeft_bsn = !!gemaskeerd;
      f.huidig.bsn_gemaskeerd = gemaskeerd;
      $('bsn-waarde').textContent = gemaskeerd;
      $('bsn-tonen').hidden = !gemaskeerd;
      if (gemaskeerd) { $('v-bsn').value = ''; $('v-bsn').hidden = true; }
    }

    /** Melding voor een half ingevulde tijd, of ''. */
    f.halveTijden = function (veld) {
      if (!q('[data-rooster="' + veld + '"]') || !roosters[veld] || (veld === 'afhaaltijden' && zelfdeAlsBezorg(f.huidig))) return '';
      var h = roosterHalf(roosters[veld].r);
      return h === 'alg' ? 'Kies bij de openingstijd zowel "van" als "tot".' :
        h ? 'Kies op ' + DAG_NAAM[h] + ' zowel de begin- als de eindtijd (of laat beide leeg).' : '';
    };

    // Adres: straat en plaats automatisch via PDOK na postcode + huisnummer (+ toevoeging).
    var adresTimers = {};
    var adresLaatste = {};
    function zoekAdres(pre) {
      var pc = $('v-' + pre + '_postcode');
      var nr = $('v-' + pre + '_huisnummer');
      var tv = $('v-' + pre + '_toevoeging');
      var melding = q('[data-adres-melding="' + pre + '-nr"]');
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
            f.huidig[pre + '_' + x[0]] = x[1];
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

    // ---------- Klaar? (zelfde regels als de server) ----------
    f.heeftRodeMelding = function () {
      return Array.prototype.some.call(qa('.veld-status.fout, .fout'),
        function (el) { return el.textContent.trim() && !el.closest('[hidden]'); });
    };

    f.klaarVoorIngevuld = function () {
      if (!f.huidig || f.heeftRodeMelding()) return false;
      var g = Object.assign({}, f.huidig);
      if (f.huidig.heeft_bsn && !g.bsn) g.bsn = '111222333'; // opgeslagen BSN (gemaskeerd): telt als ingevuld
      return valideerPartnerFormulier(g).ok;
    };

    /**
     * Controle van één stap (partnerpagina, bij "Volgende"): dezelfde regels als bij versturen, maar alleen voor de
     * zichtbare velden van deze stap, plus half ingevulde tijden, postcoderegels en rode meldingen die al in beeld staan
     * (behalve "opslaan lukte niet": een storing van Google houdt de partner niet tegen). Geeft {veld: melding}.
     */
    f.controleerStap = function (stap) {
      var g = Object.assign({}, f.huidig);
      if (f.huidig.heeft_bsn && !g.bsn) g.bsn = '111222333';
      var alle = valideerPartnerFormulier(g).fouten;
      var fouten = {};
      stap.velden.forEach(function (d) {
        if (!veldZichtbaar(d, g)) return;
        if (alle[d.veld]) fouten[d.veld] = alle[d.veld];
        if (d.soort === 'tijden' && f.halveTijden(d.veld)) fouten[d.veld] = f.halveTijden(d.veld);
        if (d.soort === 'postcoderegels' && q('[data-pcregel]') && controleerPcRegels().fout && !fouten[d.veld]) {
          fouten[d.veld] = 'Controleer de postcodes hierboven.';
        }
      });
      Array.prototype.forEach.call(qa('.veld-status.fout'), function (el) {
        var v = el.getAttribute('data-status');
        var tekst = el.textContent.trim();
        if (!v || !tekst || el.closest('[hidden]') || /^Opslaan lukte niet/.test(tekst) || fouten[v]) return;
        if (stap.velden.some(function (d) { return d.veld === v; })) fouten[v] = tekst;
      });
      return fouten;
    };

    f.veldLabel = function (v, extra) {
      var d = veldDef(v);
      return d ? d.label : (extra || {})[v] || v;
    };

    /** "Nog 1 ding: e-mail voor facturen." / "Nog 3 dingen: a, b en c." */
    f.samenvattingFouten = function (fouten, extra) {
      var labels = Object.keys(fouten).map(function (v) { return f.veldLabel(v, extra).replace(/[.?!:]+$/, ''); });
      var en = function (l) { return l.length < 2 ? l[0] : l.slice(0, -1).join(', ') + ' en ' + l[l.length - 1]; };
      if (labels.length > 5) return 'Nog ' + labels.length + ' dingen, waaronder ' + en(labels.slice(0, 5)) + '.';
      return (labels.length === 1 ? 'Nog 1 ding: ' : 'Nog ' + labels.length + ' dingen: ') + en(labels) + '.';
    };

    /** Meldingen per veld zetten en naar het eerste (zichtbare) probleem scrollen. */
    f.toonVeldFouten = function (fouten) {
      Object.keys(fouten).forEach(function (v) { zetStatus(v, fouten[v], 'fout'); });
      naWijziging();
      var eerste = Array.prototype.filter.call(qa('.veld-status.fout'), function (el) { return !el.closest('[hidden]'); })[0];
      if (eerste) eerste.closest('.veld').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    // ---------- Gebeurtenissen ----------
    root.addEventListener('focusin', function (e) {
      var el = e.target;
      if (el.hasAttribute && el.hasAttribute('data-datum') && el.type === 'text') {
        el.type = 'date';
        if (typeof el.showPicker === 'function') { try { el.showPicker(); } catch (x) { /* niet overal toegestaan */ } }
      }
    });
    root.addEventListener('focusout', function (e) {
      var el = e.target;
      if (el.hasAttribute && el.hasAttribute('data-datum') && !el.value) el.type = 'text';
    });
    ['input', 'change', 'click'].forEach(function (t) {
      root.addEventListener(t, function () { setTimeout(naWijziging, 0); });
    });

    root.addEventListener('input', function (e) {
      var el = e.target;
      if (!f.huidig) return;
      if (el.hasAttribute('data-veld')) {
        var veld = el.getAttribute('data-veld');
        if (cfg.naInvoer) cfg.naInvoer(veld);
        if (veld === 'btw_id') { // alleen opslaan en controleren als het formaat klopt; anders na een pauze een melding
          clearTimeout(btwTimer);
          clearTimeout(timers.btw_id);
          delete wachtend.btw_id;
          var btw = el.value.trim();
          f.huidig.btw_id = btw;
          if (btw && !normaliseerBtwId(btw)) {
            btwTimer = setTimeout(function () { zetStatus('btw_id', BTW_FORMAAT, 'fout'); }, 900);
            return;
          }
          zetStatus('btw_id', '');
          bewaar('btw_id', btw);
          return;
        }
        controleerDirect(veld, el.value);
        f.huidig[veld] = el.value;
        planAdres(veld);
        if (veld === 'bsn' && el.value.replace(/\D/g, '').length < 9) return; // pas bewaren als het compleet is
        bewaar(veld, el.value);
      } else if (el.hasAttribute('data-pcregel')) {
        controleerPcRegels();
        f.huidig.postcodes_gewenst = pcRegelsUitScherm().filter(Boolean).join('\n');
        f.toonMarkering(f.huidig.markering); // oude melding van een gewiste/gewijzigde regel meteen weg
        bewaar('postcodes_gewenst', pcRegelsUitScherm());
        f.planAfstanden();
      } else if (el.hasAttribute('data-rij-nr')) {
        bewaar('bezorggebied', f.rijenUitScherm());
      }
    });

    root.addEventListener('change', function (e) {
      var el = e.target;
      if (!f.huidig) return;
      if (el.hasAttribute('data-vinkje')) {
        var v = el.getAttribute('data-vinkje');
        f.huidig[v] = el.checked ? 'ja' : 'nee';
        f.werkZichtbaarheidBij();
        bewaar(v, f.huidig[v], true);
      } else if (el.hasAttribute('data-veld')) {
        var veld = el.getAttribute('data-veld');
        if (veld === 'btw_id' && el.value.trim() && !normaliseerBtwId(el.value)) { // geen serveraanroep
          clearTimeout(btwTimer);
          zetStatus('btw_id', BTW_FORMAAT, 'fout');
          return;
        }
        if (veld === 'btw_id' && !wachtend.btw_id) return; // al opgeslagen (en gecontroleerd) tijdens het typen
        f.huidig[veld] = el.value;
        controleerDirect(veld, el.value, true);
        bewaar(veld, el.value, true); // half ingevuld ook bewaren; een melding blijft staan
      } else if (el.hasAttribute('data-pcregel')) {
        controleerPcRegels();
        f.huidig.postcodes_gewenst = pcRegelsUitScherm().filter(Boolean).join('\n');
        bewaar('postcodes_gewenst', pcRegelsUitScherm(), true);
      } else if (el.closest('[data-rooster]')) {
        roosterWijziging(el);
      } else if (el.hasAttribute('data-rij-nr')) {
        bewaar('bezorggebied', f.rijenUitScherm(), true);
      }
    });

    root.addEventListener('click', function (e) {
      if (!f.huidig) return;
      var keuze = e.target.closest('[data-keuze] button');
      if (keuze && !keuze.disabled) {
        var groep = keuze.closest('[data-keuze]');
        var veld = groep.getAttribute('data-keuze');
        var waarde = keuze.getAttribute('data-waarde');
        zetKeuze(groep, waarde);
        f.huidig[veld] = waarde;
        zetStatus(veld, '');
        f.werkZichtbaarheidBij();
        bewaar(veld, waarde, true);
        if (veld === 'afhalen') f.volgAfhaaltijden();
        return;
      }
      var rknop = e.target.closest('[data-rooster] [data-rkeuze] button, [data-rooster] [data-ractie]');
      if (rknop && !rknop.disabled) { roosterKlik(rknop); return; }
      var knop = e.target.closest('[data-actie]');
      if (!knop) return;
      var actie = knop.getAttribute('data-actie');
      if (actie === 'toon-bsn' && cfg.api.toonBsn) {
        if (knop.textContent === 'Verberg') { $('bsn-waarde').textContent = f.huidig.bsn_gemaskeerd; knop.textContent = 'Toon'; return; }
        cfg.api.toonBsn().then(function (r) {
          $('bsn-waarde').textContent = r.bsn;
          knop.textContent = 'Verberg';
        }).catch(function (err) { if (cfg.melding) cfg.melding(err.message, true); });
      } else if (actie === 'wijzig-bsn') {
        $('bsn-tonen').hidden = true; $('v-bsn').hidden = false; $('v-bsn').focus();
      } else if (actie === 'afstanden') {
        f.planAfstanden(true);

      } else if (actie === 'pc-erbij') {
        var aantal = qa('[data-pcregel]').length;
        if (aantal < MAX_POSTCODEREGELS) {
          $('pc-regels').insertAdjacentHTML('beforeend', postcodeRegelHtml(aantal, '', false));
          $('pc-' + aantal).focus();
        }
        knop.hidden = aantal + 1 >= MAX_POSTCODEREGELS;
      }
    });

    f.STORING = STORING;
    return f;
  };
})();
