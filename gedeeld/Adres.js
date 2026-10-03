/**
 * Adressen via de PDOK Locatieserver (Kadaster, BAG; gratis, geen API-sleutel). Overgenomen uit personeelsflow.
 * Gedeeld: de beheerpagina (straat en plaats automatisch invullen) en de server (afstanden). Alleen pure functies;
 * het ophalen zelf doet de aanroeper. Naar PDOK gaan alleen postcode en huisnummer.
 */

var PDOK_ZOEK_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';

/** Zoek-URL voor postcode + huisnummer; '' als die nog niet compleet/geldig zijn. */
function pdokUrl(postcode, huisnummer) {
  var pc = String(postcode || '').replace(/\s+/g, '').toUpperCase();
  var nr = String(huisnummer || '').trim();
  if (!/^[1-9]\d{3}[A-Z]{2}$/.test(pc) || !/^\d{1,5}$/.test(nr)) return '';
  return PDOK_ZOEK_URL + '?q=*&fq=type:adres&fq=postcode:' + pc + '&fq=huisnummer:' + Number(nr) +
    '&fl=straatnaam,woonplaatsnaam,huisletter,huisnummertoevoeging,centroide_ll&rows=50';
}

/** PDOK geeft maximaal 100 resultaten per aanvraag; meer ophalen gaat per pagina (start). */
var PDOK_MAX_ROWS = 100;

/** De 6-cijferige postcodes binnen een 4-cijferig gebied (voor het middelpunt), pagina vanaf `start`. */
function pdokPc4Url(pc4, start) {
  return /^[1-9]\d{3}$/.test(String(pc4)) ? PDOK_ZOEK_URL + '?q=*&fq=type:postcode&fq=postcode:' + pc4 +
    '*&fl=centroide_ll&rows=' + PDOK_MAX_ROWS + '&start=' + (Number(start) || 0) : '';
}

function adresSleutel_(t) {
  return String(t || '').toUpperCase().replace(/[\s\-.]/g, '');
}

/**
 * Vergelijkt de invoer met de PDOK-resultaten (response.docs). adres: {toevoeging}.
 * Geeft {gevonden (postcode+huisnummer+toevoeging bestaan), nummerBestaat, straat, woonplaats, punt: {lat, lng}|null}.
 */
function bagOordeel(docs, adres) {
  docs = docs || [];
  var uit = { gevonden: false, nummerBestaat: docs.length > 0, straat: '', woonplaats: '', punt: null };
  if (!docs.length) return uit;
  var t = adresSleutel_(adres && adres.toevoeging);
  var passend = docs.filter(function (d) { return adresSleutel_((d.huisletter || '') + (d.huisnummertoevoeging || '')) === t; })[0];
  var d = passend || docs[0];
  uit.gevonden = !!passend;
  uit.straat = String(d.straatnaam || '');
  uit.woonplaats = String(d.woonplaatsnaam || '');
  uit.punt = puntUitWkt(d.centroide_ll);
  return uit;
}

/** "POINT(5.46 52.50)" → {lat: 52.50, lng: 5.46}; ongeldig → null. */
function puntUitWkt(wkt) {
  var m = /POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(String(wkt || ''));
  return m ? { lat: Number(m[2]), lng: Number(m[1]) } : null;
}

/** Gemiddelde van punten (middelpunt van een postcodegebied); geen punten → null. */
function middelpunt(punten) {
  var p = (punten || []).filter(Boolean);
  if (!p.length) return null;
  var som = p.reduce(function (a, b) { return { lat: a.lat + b.lat, lng: a.lng + b.lng }; }, { lat: 0, lng: 0 });
  return { lat: som.lat / p.length, lng: som.lng / p.length };
}

/** Hemelsbrede afstand in km (haversine). */
function hemelsbreedKm(a, b) {
  var r = Math.PI / 180;
  var dLat = (b.lat - a.lat) * r;
  var dLng = (b.lng - a.lng) * r;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Huisnummer met toevoeging zoals op een adres: "12a", "12A", "12bis"; begint de toevoeging met een cijfer,
 * dan met een streepje ("12-2") om verwarring met "122" te voorkomen.
 */
function huisnummerMetToevoeging(huisnummer, toevoeging) {
  var nr = String(huisnummer == null ? '' : huisnummer).trim();
  var t = String(toevoeging == null ? '' : toevoeging).trim().replace(/^[-\s]+/, '');
  if (!t) return nr;
  return nr + (/^\d/.test(t) ? '-' : '') + t;
}

/**
 * Bereik van een postcodegebied gezien vanaf `van`: dichtstbijzijnde en verste punt (6-cijferige postcodes),
 * hemelsbreed × factor (schatting van de rijafstand). Geeft {min, max} in km met 1 decimaal, of null zonder punten.
 */
function bereikKm(van, punten, factor) {
  var km = (punten || []).filter(Boolean).map(function (p) { return hemelsbreedKm(van, p) * (factor || 1.3); });
  if (!km.length) return null;
  var r = function (x) { return Math.round(x * 10) / 10; };
  return { min: r(Math.min.apply(null, km)), max: r(Math.max.apply(null, km)) };
}
