import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoryOf, elementToCandidate, isBusinessTags, nominatimToResult, parseSourceId, pickClicked, websiteOf, distanceM, type OverpassElement,
} from "../lib/osm/parse.ts";
import { dedupeKey } from "../lib/validation/normalize.ts";

test("business detection and categories", () => {
  assert.equal(categoryOf({ amenity: "cafe", name: "X" }), "Cafe");
  assert.equal(categoryOf({ shop: "clothes" }), "Clothes shop");
  assert.equal(categoryOf({ shop: "supermarket" }), "Supermarket");
  assert.equal(categoryOf({ shop: "convenience_store" }), "Convenience store");
  assert.equal(categoryOf({ amenity: "bench", name: "Memorial bench" }), null);
  assert.equal(categoryOf({ highway: "residential", name: "Jl. Cikini Raya" }), null);
  assert.ok(isBusinessTags({ name: "Warung Sari", amenity: "restaurant" }));
  assert.ok(!isBusinessTags({ amenity: "restaurant" })); // no name
});

test("website and source ids", () => {
  assert.equal(websiteOf({ website: "warung.id" }), "https://warung.id/");
  assert.equal(websiteOf({ "contact:website": "http://a.com/x" }), "http://a.com/x");
  assert.equal(websiteOf({ website: "javascript:alert(1)" }), null);
  assert.deepEqual(parseSourceId("node/123"), { type: "node", id: "123" });
  assert.deepEqual(parseSourceId("way/9"), { type: "way", id: "9" });
  assert.equal(parseSourceId("node/0"), null);
  assert.equal(parseSourceId("node/12;out"), null);
  assert.equal(parseSourceId("area/1"), null);
});

const els: OverpassElement[] = [
  { type: "node", id: 1, lat: -6.19, lon: 106.84, tags: { name: "Warung Sari Rasa", amenity: "restaurant", "addr:street": "Jl. Cikini Raya", "addr:housenumber": "12" } },
  { type: "way", id: 2, center: { lat: -6.1901, lon: 106.8401 }, tags: { name: "Kopi Kenangan", "name:en": "Kenangan Coffee", amenity: "cafe", website: "kopikenangan.com" } },
  { type: "node", id: 3, lat: -6.19, lon: 106.8403, tags: { name: "Jl. Cikini Raya", highway: "bus_stop" } },
];

test("overpass element → candidate", () => {
  const c = elementToCandidate(els[1]!);
  assert.ok(c);
  assert.equal(c!.sourceId, "way/2");
  assert.equal(c!.lat, -6.1901);
  assert.equal(c!.website, "https://kopikenangan.com/");
  assert.equal(elementToCandidate(els[2]!), null);
  assert.equal(elementToCandidate(els[0]!)!.address, "Jl. Cikini Raya 12");
});

test("pickClicked matches the map label in any language, nearest first", () => {
  assert.equal(pickClicked(els, -6.19, 106.84, "Kenangan Coffee")?.sourceId, "way/2");
  assert.equal(pickClicked(els, -6.19, 106.84, "warung sari rasa")?.sourceId, "node/1");
  assert.equal(pickClicked(els, -6.19, 106.84, "Jl. Cikini Raya"), null); // not a business
  assert.equal(pickClicked(els, -6.1901, 106.8401, null)?.sourceId, "way/2");
});

test("nominatim → search results", () => {
  const poi = nominatimToResult({
    osm_type: "node", osm_id: 55, lat: "48.8584", lon: "2.2945", name: "Café de l'Homme", display_name: "Café de l'Homme, 17, Place du Trocadéro, Paris, France",
    category: "amenity", type: "restaurant", address: { road: "Place du Trocadéro", house_number: "17", city: "Paris", country: "France", country_code: "fr" },
    extratags: { website: "https://cafedelhomme.com" },
  });
  assert.ok(poi?.place);
  assert.equal(poi!.place!.sourceId, "node/55");
  assert.equal(poi!.place!.city, "Paris");
  assert.equal(poi!.place!.countryCode, "FR");
  assert.equal(poi!.bbox, null);
  const city = nominatimToResult({
    osm_type: "relation", osm_id: 7, lat: "-6.2", lon: "106.8", name: "Jakarta", display_name: "Jakarta, Indonesia", category: "boundary", type: "administrative",
    boundingbox: ["-6.4", "-5.9", "106.6", "107.0"],
  });
  assert.equal(city?.place, null);
  assert.deepEqual(city?.bbox, [106.6, -6.4, 107.0, -5.9]);
});

test("distance and dedupe", () => {
  assert.ok(Math.abs(distanceM(0, 0, 0, 1) - 111_195) < 50);
  assert.equal(dedupeKey("Warung Bu Tini!", -6.123456, 106.987654), "warungbutini@-6.1235,106.9877");
});
