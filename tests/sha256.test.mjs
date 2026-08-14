import test from "node:test";
import assert from "node:assert/strict";
import { IncrementalSha256, sha256Blob, sha256Hex } from "../src/sha256.js";

const encoder = new TextEncoder();

test("inkrementell SHA-256 klarar etablerade testvektorer", () => {
  assert.equal(
    sha256Hex(encoder.encode("")),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256Hex(encoder.encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const hash = new IncrementalSha256();
  hash.update(encoder.encode("a"));
  hash.update(encoder.encode("b"));
  hash.update(encoder.encode("c"));
  assert.equal(hash.digestHex(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("Blob-hashning är lokal, blockvis och redovisar hela filens scope", async () => {
  const blob = new Blob([encoder.encode("abc")]);
  const progress = [];
  const result = await sha256Blob(blob, { chunkBytes: 64 }, event => progress.push(event));
  assert.deepEqual(result, {
    algorithm: "SHA-256",
    scope: "full-file-bytes",
    value: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    bytes: 3,
  });
  assert.equal(progress.at(-1).fraction, 1);
});
