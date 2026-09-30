import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAddress, isHexAddress, addressesEqual, shortenAddress, normalizeTxHash,
  slugify, isValidSlug, suggestTicker, websiteDomain, marketPath, normalizeSymbol, normalizeTokenName,
  parseAmount, formatAmount, ValidationError,
} from "../lib/validation/normalize.ts";

test("address normalization lower-cases and validates", () => {
  assert.equal(
    normalizeAddress(" 0xE2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0 "),
    "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0",
  );
  assert.throws(() => normalizeAddress("0x123"), ValidationError);
  assert.throws(() => normalizeAddress("e2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0"), ValidationError);
  assert.equal(isHexAddress("0x" + "g".repeat(40)), false);
  assert.ok(addressesEqual("0xABCDEF0000000000000000000000000000000001", "0xabcdef0000000000000000000000000000000001"));
  assert.equal(addressesEqual(null, "0x0"), false);
  assert.equal(shortenAddress("0x1234567890abcdef1234567890abcdef1234abcd"), "0x1234…abcd");
  assert.throws(() => normalizeTxHash("0xabc"), ValidationError);
  assert.equal(normalizeTxHash("0x" + "AB".repeat(32)), "0x" + "ab".repeat(32));
});

test("place slugs, tickers and website domains", () => {
  assert.equal(slugify("Café Ñandú & Co."), "cafe-nandu-and-co");
  assert.equal(slugify("  ---  "), "place");
  assert.equal(slugify("東京"), "place");
  assert.ok(isValidSlug("new-york-city-a1b2c3"));
  assert.ok(!isValidSlug("NewYork"));
  assert.ok(!isValidSlug("a--b"));
  assert.equal(marketPath("new-york-city-a1b2c3"), "/p/new-york-city-a1b2c3");
  assert.equal(suggestTicker("New York City"), "NYC");
  assert.equal(suggestTicker("United States"), "US");
  assert.equal(suggestTicker("Indonesia"), "INDONESIA");
  assert.equal(suggestTicker("São Paulo"), "SP");
  assert.equal(suggestTicker("Brooklyn"), "BROOKLYN");
  assert.equal(suggestTicker("東京"), "PLACE");
  assert.equal(websiteDomain("https://www.Example.co.id/menu"), "example.co.id");
  assert.equal(websiteDomain("example.com"), "example.com");
  assert.equal(websiteDomain("javascript:alert(1)"), null);
  assert.equal(websiteDomain(null), null);
});

test("token field normalization", () => {
  assert.equal(normalizeSymbol("$code"), "CODE");
  assert.throws(() => normalizeSymbol("TOO-LONG-SYMBOL"), ValidationError);
  assert.throws(() => normalizeSymbol(""), ValidationError);
  assert.equal(normalizeTokenName("  My   Project "), "My Project");
  assert.throws(() => normalizeTokenName("a‮b"), ValidationError);
  assert.throws(() => normalizeTokenName("x".repeat(33)), ValidationError);
});

test("amount parsing is exact and strict", () => {
  assert.equal(parseAmount("1", 18), 10n ** 18n);
  assert.equal(parseAmount("0.1", 18), 10n ** 17n);
  assert.equal(parseAmount(".5", 6), 500_000n);
  assert.equal(parseAmount("1.", 6), 1_000_000n);
  assert.equal(parseAmount("123.456789", 6), 123_456_789n);
  assert.equal(parseAmount("0", 18), 0n);
  assert.throws(() => parseAmount("1.0000001", 6), ValidationError);
  assert.throws(() => parseAmount("-1", 18), ValidationError);
  assert.throws(() => parseAmount("1e18", 18), ValidationError);
  assert.throws(() => parseAmount("1,000", 18), ValidationError);
  assert.throws(() => parseAmount("", 18), ValidationError);
  assert.throws(() => parseAmount("1", 40), ValidationError);
  // no floating-point drift
  assert.equal(parseAmount("0.3", 18) - parseAmount("0.1", 18), parseAmount("0.2", 18));
});

test("amount formatting", () => {
  assert.equal(formatAmount(1_234_500_000_000_000_000_000n, 18), "1,234.5");
  assert.equal(formatAmount(1n, 18, 4), "0");
  assert.equal(formatAmount(123_456n, 6, 2), "0.12");
  assert.equal(formatAmount(0n, 0), "0");
});
