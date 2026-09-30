import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEVEL_ZOOM, bboxOf, englishName, isArea, levelChoices, levelForMapZoom, lookupIdOf, nominatimToResult, parseSourceId, placeTypeOf, regionOf,
  resultToPlace, type NominatimResult,
} from "../lib/osm/parse.ts";

const brooklyn: NominatimResult = {
  osm_type: "relation", osm_id: 369518, lat: "40.6526", lon: "-73.9497", name: "Brooklyn",
  display_name: "Brooklyn, Kings County, New York, United States", category: "boundary", type: "administrative",
  addresstype: "suburb", boundingbox: ["40.5707", "40.7395", "-74.0420", "-73.8334"],
  address: { suburb: "Brooklyn", county: "Kings County", city: "New York", state: "New York", country: "United States", country_code: "us" },
  namedetails: { name: "Brooklyn", "name:en": "Brooklyn" },
};

const tokyo: NominatimResult = {
  osm_type: "relation", osm_id: 1543125, lat: "35.6769", lon: "139.7639", name: "東京都",
  display_name: "東京都, 日本", category: "boundary", type: "administrative", addresstype: "province",
  boundingbox: ["20.2", "35.9", "135.8", "154.2"],
  address: { province: "Tokyo", country: "Japan", country_code: "jp" },
  namedetails: { name: "東京都", "name:en": "Tokyo" },
};

test("source ids", () => {
  assert.deepEqual(parseSourceId("relation/175905"), { type: "relation", id: "175905" });
  assert.equal(parseSourceId("relation/0"), null);
  assert.equal(parseSourceId("area/1"), null);
  assert.equal(lookupIdOf("relation/175905"), "R175905");
  assert.equal(lookupIdOf("node/42"), "N42");
});

test("only areas can be tokenized", () => {
  assert.ok(isArea(brooklyn));
  assert.ok(!isArea({ ...brooklyn, category: "highway", type: "residential", addresstype: "road" }));
  assert.ok(!isArea({ ...brooklyn, category: "amenity", type: "cafe", addresstype: "amenity" }));
  assert.ok(!isArea({ ...brooklyn, category: "boundary", type: "postal_code", addresstype: "postcode" }));
  assert.equal(placeTypeOf({ addresstype: "city", type: "administrative", category: "boundary" }), "City");
  assert.equal(placeTypeOf({ addresstype: "village", type: "village", category: "place" }), "Village");
});

test("English names, region and bbox", () => {
  assert.equal(englishName(tokyo), "Tokyo");
  assert.equal(regionOf("Brooklyn", brooklyn.address), "New York, Kings County, United States");
  assert.deepEqual(bboxOf(brooklyn), [-74.042, 40.5707, -73.8334, 40.7395]);
  const p = resultToPlace(tokyo)!;
  assert.equal(p.name, "Tokyo");
  assert.equal(p.placeType, "Province");
  assert.equal(p.country, "Japan");
  assert.equal(p.countryCode, "JP");
  assert.equal(p.sourceId, "relation/1543125");
  const us = resultToPlace({
    osm_type: "relation", osm_id: 148838, lat: "39.78", lon: "-100.44", name: "United States", display_name: "United States",
    category: "boundary", type: "administrative", addresstype: "country", address: { country: "United States", country_code: "us" },
  })!;
  assert.equal(us.placeType, "Country");
  assert.equal(us.region, null);
  assert.equal(us.country, "United States");
});

test("search results", () => {
  const r = nominatimToResult(brooklyn)!;
  assert.equal(r.label, "Brooklyn");
  assert.equal(r.sublabel, "Neighbourhood · New York, Kings County, United States");
  assert.ok(r.place);
  const street = nominatimToResult({ ...brooklyn, category: "highway", type: "primary", addresstype: "road", name: "Flatbush Avenue" })!;
  assert.equal(street.place, null);
});

test("zoom → level and level switcher", () => {
  assert.equal(levelForMapZoom(2), "country");
  assert.equal(levelForMapZoom(6), "state");
  assert.equal(levelForMapZoom(9), "city");
  assert.equal(levelForMapZoom(12), "town");
  assert.equal(levelForMapZoom(15), "suburb");
  assert.equal(LEVEL_ZOOM.suburb, 13);
  assert.equal(LEVEL_ZOOM.neighbourhood, 14);
  assert.deepEqual(levelChoices(brooklyn.address).map((l) => `${l.level}:${l.label}`), [
    "suburb:Brooklyn", "city:New York", "county:Kings County", "country:United States",
  ]);
});
