import { test } from "node:test";
import assert from "node:assert/strict";
import { checkImageMeta, sniffImageType, isCid, MAX_IMAGE_BYTES } from "../lib/metadata/validate.ts";

test("image validation by declared type and size", () => {
  assert.equal(checkImageMeta("image/png", 1000), null);
  assert.match(checkImageMeta("image/svg+xml", 1000)!, /PNG, JPEG, WebP or GIF/);
  assert.match(checkImageMeta("image/png", MAX_IMAGE_BYTES + 1)!, /2 MB/);
  assert.match(checkImageMeta("image/png", 0)!, /empty/);
});

test("image type sniffing ignores the declared MIME type", () => {
  assert.equal(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(new TextEncoder().encode("GIF89a")), "image/gif");
  assert.equal(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
});

test("CID validation", () => {
  assert.ok(isCid("bafkreibwjuzzns6yf4wytfr5nk6vujb4yja4iejff2k76nshn2z5jkmiy4"));
  assert.ok(isCid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"));
  assert.equal(isCid("../etc/passwd"), false);
  assert.equal(isCid("bafy/../../x"), false);
});
