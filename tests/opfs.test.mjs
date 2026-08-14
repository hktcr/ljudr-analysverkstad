import test from "node:test";
import assert from "node:assert/strict";
import {
  clearStoredExports,
  exportInternals,
  getStoredExport,
  listStoredExports,
  removeStoredExport,
} from "../src/export-worker.js";

class FakeFileHandle {
  constructor(name) {
    this.name = name;
    this.bytes = new Uint8Array();
  }

  async getFile() {
    return new File([this.bytes], this.name, { type: this.name.endsWith(".wav") ? "audio/wav" : "application/json" });
  }

  async createWritable() {
    const handle = this;
    return {
      async write(input) {
        if (typeof input === "string") {
          handle.bytes = new TextEncoder().encode(input);
          return;
        }
        const position = input?.type === "write" ? Number(input.position) || 0 : 0;
        const data = input?.type === "write" ? input.data : input;
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const output = new Uint8Array(Math.max(handle.bytes.length, position + bytes.length));
        output.set(handle.bytes);
        output.set(bytes, position);
        handle.bytes = output;
      },
      async close() {},
      async abort() {},
    };
  }
}

class FakeDirectory {
  constructor() { this.files = new Map(); }
  async getFileHandle(name, options = {}) {
    if (!this.files.has(name)) {
      if (!options.create) throw new DOMException("saknas", "NotFoundError");
      this.files.set(name, new FakeFileHandle(name));
    }
    return this.files.get(name);
  }
  async removeEntry(name) {
    if (!this.files.delete(name)) throw new DOMException("saknas", "NotFoundError");
  }
  async *entries() { yield* this.files.entries(); }
}

const withFakeOpfs = async callback => {
  const root = new FakeDirectory();
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      storage: {
        getDirectory: async () => root,
        estimate: async () => ({ usage: 0, quota: 64 * 1024 * 1024 }),
      },
    },
  });
  try { await callback(root); }
  finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
};

test("OPFS registrerar bara complete-exporter och stöder hämta och radera", async () => {
  await withFakeOpfs(async () => {
    const writer = await exportInternals.OpfsWriter.create("fält.wav", 3, "jobb-1");
    await writer.write(new Uint8Array([1, 2, 3]));
    await writer.finish("fält.wav");
    assert.deepEqual(await listStoredExports(), []);
    const record = await writer.markComplete();
    const listed = await listStoredExports();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, record.id);
    const retrieved = await getStoredExport(record.id);
    assert.equal(retrieved.fileName, "fält.wav");
    assert.deepEqual(Array.from(new Uint8Array(await retrieved.file.arrayBuffer())), [1, 2, 3]);
    assert.deepEqual(await removeStoredExport(record.id), { removed: 1 });
    assert.deepEqual(await listStoredExports(), []);
  });
});

test("OPFS cleanup tar bort partial och clear tar bara registrerade LjudR-exporter", async () => {
  await withFakeOpfs(async root => {
    const partial = await exportInternals.OpfsWriter.create("avbruten.wav", 3, "jobb-2");
    await partial.write(new Uint8Array([9, 9, 9]));
    await partial.cleanup();
    assert.equal([...root.files.keys()].some(name => name.includes("jobb-2")), false);

    const complete = await exportInternals.OpfsWriter.create("klar.wav", 2, "jobb-3");
    await complete.write(new Uint8Array([4, 5]));
    await complete.finish("klar.wav");
    await complete.markComplete();
    root.files.set("annat-program.bin", new FakeFileHandle("annat-program.bin"));
    root.files.set(".ljudr-partial-krasch.wav", new FakeFileHandle(".ljudr-partial-krasch.wav"));
    const listed = await listStoredExports();
    assert.equal(listed.some(item => item.status === "partial"), true);
    assert.deepEqual(await clearStoredExports(), { removed: 2 });
    assert.equal(root.files.has("annat-program.bin"), true);
  });
});
