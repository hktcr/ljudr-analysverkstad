import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = await readFile(resolve(import.meta.dirname, "..", "sw.js"), "utf8");

function response(label) {
  return { label, ok: true, type: "basic", clone() { return response(label); } };
}

function workerHarness(fetchImplementation, initialCache = new Map()) {
  const handlers = new Map();
  const writes = [];
  const key = request => typeof request === "string" ? request : request.url;
  const cache = {
    async addAll() {},
    async put(request, value) { writes.push({ url: key(request), value }); initialCache.set(key(request), value); },
    async match(request) { return initialCache.get(key(request)); },
  };
  const self = {
    location: { origin: "https://hktcr.github.io" },
    registration: { scope: "https://hktcr.github.io/ljudr-analysverkstad/" },
    clients: { claim: async () => {} },
    addEventListener(type, handler) { handlers.set(type, handler); },
    skipWaiting() {},
  };
  vm.runInNewContext(source, {
    self,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: fetchImplementation,
    URL,
    Request,
  });
  return { handlers, writes };
}

async function dispatchFetch(handler, request) {
  let result;
  handler({ request, respondWith(value) { result = value; } });
  return result ? await result : null;
}

test("service workern prioriterar nätet och uppdaterar versionscachen", async () => {
  const network = response("network");
  const { handlers, writes } = workerHarness(async () => network);
  const request = { method: "GET", mode: "same-origin", url: "https://hktcr.github.io/ljudr-analysverkstad/src/app.js" };
  const result = await dispatchFetch(handlers.get("fetch"), request);
  assert.equal(result, network);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, request.url);
});

test("service workern använder endast aktuell versionscache som offlinefallback", async () => {
  const url = "https://hktcr.github.io/ljudr-analysverkstad/src/app.js";
  const cached = response("rc5-cache");
  const currentCache = new Map([[url, cached]]);
  const { handlers, writes } = workerHarness(async () => { throw new Error("offline"); }, currentCache);
  const result = await dispatchFetch(handlers.get("fetch"), { method: "GET", mode: "same-origin", url });
  assert.equal(result, cached);
  assert.equal(writes.length, 0);
});
