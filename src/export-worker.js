import {
  attachBlob,
  createTpdf,
  createWaveHeader,
  decodeInterleaved,
  encodeInterleaved,
  inspectWav
} from "./wav.js";
import {
  analyzeRegion,
  analyzeWav,
  TRUE_PEAK_ORIENTATION
} from "./dsp-core.js";
import { sha256Blob } from "./sha256.js";

const ENGINE_VERSION = "1.0.0-rc.2";
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
const MEMORY_WARNING_BYTES = 512 * 1024 * 1024;
const GAIN_EPSILON_DB = 1e-9;
const OPFS_INDEX_NAME = ".ljudr-complete-index.json";
const OPFS_PARTIAL_PREFIX = ".ljudr-partial-";
const ACTIVE_PARTIALS = new Set();
export const FADE_OVERLAP_POLICY = "minimum-envelope";

const cleanName = name => (name || "ljudr-export")
  .replace(/\.[^.]+$/, "")
  .replace(/[^a-zA-Z0-9åäöÅÄÖ_-]+/g, "_")
  .replace(/^_+|_+$/g, "") || "ljudr-export";

const clampFrame = (value, maximum) => Math.min(maximum, Math.max(0, Math.round(Number(value) || 0)));
const dbToLinear = value => 10 ** (value / 20);
const cleanNearZero = value => Math.abs(value) <= GAIN_EPSILON_DB ? 0 : value;

class MemoryWriter {
  constructor(type = "audio/wav") {
    this.type = type;
    this.parts = [];
    this.position = 0;
    this.mode = "memory";
  }

  async write(bytes) {
    const copy = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
    this.parts.push(copy);
    this.position += copy.byteLength;
  }

  async finish(fileName) {
    return new File(this.parts, fileName, { type: this.type, lastModified: Date.now() });
  }

  async markComplete() {}
  async cleanup() {}
}

const opfsRoot = async () => {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
    throw new Error("OPFS är inte tillgängligt i denna webbläsare.");
  }
  return navigator.storage.getDirectory();
};

const readOpfsIndex = async root => {
  try {
    const handle = await root.getFileHandle(OPFS_INDEX_NAME);
    const file = await handle.getFile();
    const parsed = JSON.parse(await file.text());
    return Array.isArray(parsed?.items)
      ? parsed.items.filter(item => item && typeof item.id === "string"
        && typeof item.storageName === "string" && item.storageName.startsWith(OPFS_PARTIAL_PREFIX))
      : [];
  } catch (error) {
    if (error?.name === "NotFoundError") return [];
    throw error;
  }
};

const writeOpfsIndex = async (root, items) => {
  const handle = await root.getFileHandle(OPFS_INDEX_NAME, { create: true });
  const writer = await handle.createWritable({ keepExistingData: false });
  await writer.write(JSON.stringify({ schema: "se.gaia.ljudr.opfs-index/1", items }));
  await writer.close();
};

export async function listStoredExports() {
  const root = await opfsRoot();
  const items = await readOpfsIndex(root);
  const valid = [];
  for (const item of items) {
    try {
      const handle = await root.getFileHandle(item.storageName);
      const file = await handle.getFile();
      valid.push({ ...item, size: file.size });
    } catch (error) {
      if (error?.name !== "NotFoundError") throw error;
    }
  }
  if (valid.length !== items.length) await writeOpfsIndex(root, valid);
  const listed = valid.map(({ storageName: _storageName, ...item }) => ({ ...item, status: "complete" }));
  if (typeof root.entries === "function") {
    const registeredNames = new Set(valid.map(item => item.storageName));
    for await (const [name, handle] of root.entries()) {
      if (!name.startsWith(OPFS_PARTIAL_PREFIX) || registeredNames.has(name) || ACTIVE_PARTIALS.has(name)) continue;
      const file = await handle.getFile();
      listed.push({
        id: `partial:${name}`,
        fileName: name,
        size: file.size,
        createdAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
        status: "partial",
      });
    }
  }
  return listed;
}

export async function getStoredExport(id) {
  const root = await opfsRoot();
  const item = (await readOpfsIndex(root)).find(candidate => candidate.id === id);
  if (!item) throw new Error("Den sparade exporten finns inte längre.");
  const handle = await root.getFileHandle(item.storageName);
  const stored = await handle.getFile();
  return { ...item, file: new File([stored], item.fileName, { type: "audio/wav", lastModified: Date.parse(item.createdAt) || Date.now() }) };
}

export async function removeStoredExport(id) {
  const root = await opfsRoot();
  if (String(id).startsWith("partial:")) {
    const storageName = String(id).slice("partial:".length);
    if (!storageName.startsWith(OPFS_PARTIAL_PREFIX) || ACTIVE_PARTIALS.has(storageName)) return { removed: 0 };
    try { await root.removeEntry(storageName); return { removed: 1 }; }
    catch (error) { if (error?.name === "NotFoundError") return { removed: 0 }; throw error; }
  }
  const items = await readOpfsIndex(root);
  const item = items.find(candidate => candidate.id === id);
  if (!item) return { removed: 0 };
  try { await root.removeEntry(item.storageName); } catch (error) { if (error?.name !== "NotFoundError") throw error; }
  await writeOpfsIndex(root, items.filter(candidate => candidate.id !== id));
  return { removed: 1 };
}

export async function clearStoredExports() {
  const root = await opfsRoot();
  const items = await readOpfsIndex(root);
  let removed = 0;
  for (const item of items) {
    try { await root.removeEntry(item.storageName); removed += 1; } catch (error) { if (error?.name !== "NotFoundError") throw error; }
  }
  if (typeof root.entries === "function") {
    for await (const [name] of root.entries()) {
      if (!name.startsWith(OPFS_PARTIAL_PREFIX) || ACTIVE_PARTIALS.has(name)) continue;
      try { await root.removeEntry(name); removed += 1; } catch (error) { if (error?.name !== "NotFoundError") throw error; }
    }
  }
  await writeOpfsIndex(root, []);
  return { removed };
}

class OpfsWriter {
  constructor(root, handle, access, mode, storageName, id, fileName) {
    this.root = root;
    this.handle = handle;
    this.access = access;
    this.mode = mode;
    this.position = 0;
    this.storageName = storageName;
    this.id = id;
    this.fileName = fileName;
    this.closed = false;
    this.completed = false;
  }

  static async create(fileName, outputBytes, jobId = "export") {
    const root = await opfsRoot();
    if (typeof navigator.storage.estimate === "function") {
      const estimate = await navigator.storage.estimate();
      const available = Number(estimate.quota || 0) - Number(estimate.usage || 0);
      if (available > 0 && outputBytes + 16 * 1024 * 1024 > available) {
        const error = new Error("OPFS har inte tillräckligt ledigt utrymme för export och verifiering.");
        error.code = "OPFS_QUOTA_INSUFFICIENT";
        error.details = { requiredBytes: outputBytes + 16 * 1024 * 1024, availableBytes: available };
        throw error;
      }
    }
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const storageName = `${OPFS_PARTIAL_PREFIX}${cleanName(jobId)}-${id}.wav`;
    const handle = await root.getFileHandle(storageName, { create: true });
    try {
      if (typeof handle.createSyncAccessHandle === "function") {
        const access = await handle.createSyncAccessHandle();
        access.truncate(0);
        ACTIVE_PARTIALS.add(storageName);
        return new OpfsWriter(root, handle, access, "opfs-sync", storageName, id, fileName);
      }
      const access = await handle.createWritable({ keepExistingData: false });
      ACTIVE_PARTIALS.add(storageName);
      return new OpfsWriter(root, handle, access, "opfs-async", storageName, id, fileName);
    } catch (error) {
      try { await root.removeEntry(storageName); } catch {}
      throw error;
    }
  }

  async write(bytes) {
    if (this.mode === "opfs-sync") {
      const written = this.access.write(bytes, { at: this.position });
      if (written !== bytes.byteLength) throw new Error("OPFS skrev inte hela ljudblocket.");
    } else {
      await this.access.write({ type: "write", position: this.position, data: bytes });
    }
    this.position += bytes.byteLength;
  }

  async finish(fileName) {
    if (this.mode === "opfs-sync") {
      this.access.flush();
      this.access.close();
    } else {
      await this.access.close();
    }
    this.closed = true;
    const file = await this.handle.getFile();
    return new File([file], fileName, { type: "audio/wav", lastModified: Date.now() });
  }

  async markComplete() {
    if (!this.closed) throw new Error("OPFS-exporten måste stängas före registrering.");
    const stored = await this.handle.getFile();
    const items = await readOpfsIndex(this.root);
    const record = {
      id: this.id,
      storageName: this.storageName,
      fileName: this.fileName,
      size: stored.size,
      createdAt: new Date().toISOString(),
    };
    await writeOpfsIndex(this.root, [...items.filter(item => item.id !== this.id), record]);
    this.completed = true;
    ACTIVE_PARTIALS.delete(this.storageName);
    return record;
  }

  async cleanup() {
    if (!this.closed) {
      try {
        if (this.mode === "opfs-sync") this.access.close();
        else await this.access.abort?.();
      } catch {}
      this.closed = true;
    }
    if (!this.completed) {
      try { await this.root.removeEntry(this.storageName); } catch (error) { if (error?.name !== "NotFoundError") throw error; }
    }
    ACTIVE_PARTIALS.delete(this.storageName);
  }
}

async function chooseWriter(fileName, outputBytes, preferOpfs, jobId) {
  const opfsAvailable = typeof navigator !== "undefined"
    && navigator.storage
    && typeof navigator.storage.getDirectory === "function";
  if (preferOpfs !== false && opfsAvailable) {
    try {
      return await OpfsWriter.create(fileName, outputBytes, jobId);
    } catch (error) {
      if (outputBytes > MEMORY_WARNING_BYTES) {
        throw new Error(`OPFS kunde inte öppnas och exporten är ${Math.round(outputBytes / 1048576)} MiB. Försök installera appen på hemskärmen eller frigör lagringsutrymme. ${error.message}`);
      }
    }
  }
  return new MemoryWriter();
}

const fadeFactor = (index, total, fadeInFrames, fadeOutFrames) => {
  let factor = 1;
  if (fadeInFrames > 0 && index < fadeInFrames) {
    factor = Math.min(factor, fadeInFrames === 1 ? 0 : index / (fadeInFrames - 1));
  }
  const fromEnd = total - 1 - index;
  if (fadeOutFrames > 0 && fromEnd < fadeOutFrames) {
    factor = Math.min(factor, fadeOutFrames === 1 ? 0 : fromEnd / (fadeOutFrames - 1));
  }
  return factor;
};

async function preflightSelection(file, inspected, selection, onProgress, shouldCancel) {
  const { startFrame, selectedFrames, fadeInFrames, fadeOutFrames, globalGainDb = 0 } = selection;
  const regionAnalysis = await analyzeRegion(file, {
    startFrame,
    endFrame: startFrame + selectedFrames,
    fadeInFrames,
    fadeOutFrames,
    globalGainDb,
    shouldCancel,
    waveformBins: 256,
  }, progress => onProgress({ ...progress, phase: "region-preflight" }));
  const summary = regionAnalysis.processed.summary;
  const channelMetrics = summary.channels || [];
  const maximum = Math.max(...channelMetrics.map(channel => channel.maximum ?? -Infinity));
  const minimum = Math.min(...channelMetrics.map(channel => channel.minimum ?? Infinity));
  return {
    regionAnalysis,
    source: regionAnalysis.source,
    processed: regionAnalysis.processed,
    samplePeak: summary.samplePeak,
    samplePeakDbfs: summary.samplePeakDbfs,
    maximum: Number.isFinite(maximum) ? maximum : 0,
    minimum: Number.isFinite(minimum) ? minimum : 0,
    invalidSamples: summary.nonFiniteSamples || 0,
    truePeakEstimate: summary.truePeakEstimate,
    truePeakEstimateDbtp: summary.truePeakEstimateDbtp,
    truePeakFactor: inspected.format.sampleRate >= 192000 ? 1 : inspected.format.sampleRate >= 96000 ? 2 : 4,
    truePeakMethod: inspected.format.sampleRate >= 192000
      ? "Sample peak vid minst 192 kHz"
      : `${inspected.format.sampleRate >= 96000 ? 2 : 4}x polyfas FIR-oversampling med 49 tappar`,
    validationStatus: TRUE_PEAK_ORIENTATION.status
  };
}

function pcmClampingAssessment(format, preflight, effectiveGainDb, ditherApplied) {
  if (format.encoding !== "PCM") {
    return {
      applicable: false,
      detected: false,
      blocked: false,
      rawClampingRisk: false,
      ditherClampingRisk: false,
      ditherMargin: 0,
      policy: "PCM-klamprisk är inte tillämplig på IEEE float-export."
    };
  }
  const scale = 2 ** (format.bitsPerSample - 1);
  const positiveLimit = 1 - 1 / scale;
  const multiplier = dbToLinear(effectiveGainDb);
  const predictedMaximum = preflight.maximum * multiplier;
  const predictedMinimum = preflight.minimum * multiplier;
  const rawClampingRisk = predictedMaximum > positiveLimit + Number.EPSILON
    || predictedMinimum < -1 - Number.EPSILON;
  const ditherMargin = ditherApplied ? 1 / scale : 0;
  const ditherClampingRisk = ditherApplied && (
    predictedMaximum + ditherMargin > positiveLimit + Number.EPSILON
    || predictedMinimum - ditherMargin < -1 - Number.EPSILON
  );
  const detected = rawClampingRisk || ditherClampingRisk;
  return {
    applicable: true,
    detected,
    blocked: false,
    rawClampingRisk,
    ditherClampingRisk,
    ditherMargin,
    positiveLimit,
    negativeLimit: -1,
    predictedMaximum,
    predictedMinimum,
    policy: "Positiv gain som skulle klampa PCM blockeras före export."
  };
}

const validateFormat = format => {
  if (![1, 2].includes(format.channels)) throw new Error("WAV-export stöder för närvarande mono och stereo.");
  if (format.encoding === "IEEE_FLOAT" && format.bitsPerSample === 32) return;
  if (format.encoding === "PCM" && [16, 24, 32].includes(format.bitsPerSample)) return;
  throw new Error(`Export av ${format.encoding} ${format.bitsPerSample} bit stöds inte.`);
};

export async function exportWav(file, options = {}, onProgress = () => {}) {
  const inspected = attachBlob(await inspectWav(file), file);
  validateFormat(inspected.format);
  const startFrame = clampFrame(options.startFrame, inspected.frameCount);
  const endFrame = Math.max(startFrame, clampFrame(options.endFrame ?? inspected.frameCount, inspected.frameCount));
  const selectedFrames = endFrame - startFrame;
  if (selectedFrames <= 0) throw new Error("Det markerade intervallet innehåller inga ljudbildrutor.");

  const suppliedGlobalGain = options.globalGainDb ?? options.gainDb ?? 0;
  const globalGainDb = Number(suppliedGlobalGain);
  if (!Number.isFinite(globalGainDb) || globalGainDb < -60 || globalGainDb > 24) {
    throw new Error("Global gain måste vara ett ändligt värde mellan -60 och +24 dB.");
  }
  const fadeInFrames = Math.min(selectedFrames, clampFrame(options.fadeInFrames, selectedFrames));
  const fadeOutFrames = Math.min(selectedFrames, clampFrame(options.fadeOutFrames, selectedFrames));
  const fadeOverlapFrames = Math.max(0, fadeInFrames + fadeOutFrames - selectedFrames);
  const bitExactPayload = Math.abs(globalGainDb) <= GAIN_EPSILON_DB && fadeInFrames === 0 && fadeOutFrames === 0;
  const profile = options.profile || (bitExactPayload ? "sample-payload-identical-trim" : "edited-wav-master");
  if (["sample-payload-identical-trim", "sample-payload-trim"].includes(profile) && !bitExactPayload) {
    const error = new Error("Profilen Sample-payload-identiskt trimutdrag tillåter inte fade eller global gain.");
    error.code = "PROFILE_REQUIRES_BIT_EXACT_PAYLOAD";
    throw error;
  }
  if (!bitExactPayload && inspected.format.canReencode === false) {
    const error = new Error("Omräkning av Extensible PCM med avvikande validBitsPerSample är blockerad.");
    error.code = "VALID_BITS_REENCODE_BLOCKED";
    throw error;
  }
  const preflight = await preflightSelection(file, inspected, {
    startFrame,
    selectedFrames,
    fadeInFrames,
    fadeOutFrames,
    globalGainDb,
  }, onProgress, options.shouldCancel);
  const effectiveGainDb = cleanNearZero(globalGainDb);
  const gainLinear = dbToLinear(effectiveGainDb);
  const truePeakCeilingDbtp = Number(options.truePeakCeilingDbtp ?? options.peakHandling?.ceilingDbtp ?? -2);
  if (!Number.isFinite(truePeakCeilingDbtp) || truePeakCeilingDbtp < -60 || truePeakCeilingDbtp > 0) {
    throw new Error("True Peak-taket måste vara ett ändligt värde mellan -60 och 0 dBTP.");
  }
  const enforceTruePeakCeiling = options.enforceTruePeakCeiling ?? !bitExactPayload;
  if (enforceTruePeakCeiling && preflight.truePeakEstimateDbtp !== null
      && preflight.truePeakEstimateDbtp > truePeakCeilingDbtp + 1e-9) {
    const error = new Error(`Den bekräftade globala gainen ger ${preflight.truePeakEstimateDbtp.toFixed(2)} dBTP, över taket ${truePeakCeilingDbtp.toFixed(2)} dBTP. Ingen dold sänkning görs.`);
    error.name = "TruePeakCeilingError";
    error.code = "TRUE_PEAK_CEILING_EXCEEDED";
    error.details = { measuredDbtp: preflight.truePeakEstimateDbtp, ceilingDbtp: truePeakCeilingDbtp, globalGainDb };
    throw error;
  }
  if (preflight.invalidSamples > 0 && !bitExactPayload) {
    const error = new Error("Bearbetad export blockeras eftersom exportregionen innehåller NaN eller Infinity.");
    error.name = "InvalidFloatError";
    error.code = "INVALID_FLOAT_TRANSFORM_BLOCKED";
    error.details = { invalidSamples: preflight.invalidSamples };
    throw error;
  }
  const ditherApplied = !bitExactPayload && inspected.format.encoding === "PCM";
  const pcmClampingRisk = pcmClampingAssessment(
    inspected.format,
    preflight,
    0,
    ditherApplied
  );
  if (pcmClampingRisk.detected) {
    const error = new Error(
      "Den bekräftade bearbetningen riskerar att klampa PCM efter rå gain eller TPDF-dither. Exporten har blockerats."
    );
    error.name = "PcmClampingRiskError";
    error.code = "PCM_CLAMPING_RISK";
    error.details = { ...pcmClampingRisk, blocked: true };
    throw error;
  }
  const fileName = `${cleanName(options.fileName || file.name)}_trim.wav`;
  const { header, dataBytes, dataPadBytes, droppedChunks } = await createWaveHeader(inspected, selectedFrames, startFrame);
  const writer = await chooseWriter(
    fileName,
    header.byteLength + dataBytes + dataPadBytes,
    options.preferOpfs,
    options.jobId || "export",
  );
  try {
    await writer.write(header);

  const format = inspected.format;
  const chunkFrames = Math.max(1, Math.floor(DEFAULT_CHUNK_BYTES / format.blockAlign));
  const tpdf = createTpdf(0x4c6a7564);
  let processedFrames = 0;
  let replacedInvalid = 0;
  let outputSamplePeak = 0;

  while (processedFrames < selectedFrames) {
    if (options.shouldCancel?.()) throw new DOMException("Exporten avbröts.", "AbortError");
    const frames = Math.min(chunkFrames, selectedFrames - processedFrames);
    const sourceFrame = startFrame + processedFrames;
    const byteStart = inspected.data.dataOffset + sourceFrame * format.blockAlign;
    const byteLength = frames * format.blockAlign;
    const bytes = new Uint8Array(await file.slice(byteStart, byteStart + byteLength).arrayBuffer());

    if (bitExactPayload) {
      await writer.write(bytes);
    } else {
      const samples = decodeInterleaved(bytes, format);
      for (let frame = 0; frame < frames; frame += 1) {
        const selectionFrame = processedFrames + frame;
        const envelope = gainLinear * fadeFactor(selectionFrame, selectedFrames, fadeInFrames, fadeOutFrames);
        for (let channel = 0; channel < format.channels; channel += 1) {
          const index = frame * format.channels + channel;
          if (!Number.isFinite(samples[index])) {
            samples[index] = 0;
            replacedInvalid += 1;
          }
          samples[index] *= envelope;
          outputSamplePeak = Math.max(outputSamplePeak, Math.abs(samples[index]));
        }
      }
      const encoded = encodeInterleaved(samples, format, {
        dither: format.encoding === "PCM",
        ditherSource: tpdf
      });
      await writer.write(encoded);
    }

    processedFrames += frames;
    onProgress({
      phase: "export",
      fraction: processedFrames / selectedFrames,
      processedFrames,
      selectedFrames,
      message: `Exporterar ${Math.round(100 * processedFrames / selectedFrames)} %`
    });
  }

  if (dataPadBytes) await writer.write(new Uint8Array(dataPadBytes));

  const output = await writer.finish(fileName);
  onProgress({ phase: "verify-output", fraction: 0, message: "Verifierar den faktiskt kodade WAV-filen" });
  const verifiedInspection = await inspectWav(output);
  const verifiedAnalysis = await analyzeWav(output, {
    includeSourceHash: true,
    waveformBins: 256,
    shouldCancel: options.shouldCancel,
  }, progress => onProgress({ ...progress, phase: "verify-output" }));
  if (verifiedInspection.frameCount !== selectedFrames
      || verifiedInspection.format.channels !== format.channels
      || verifiedInspection.format.sampleRate !== format.sampleRate
      || verifiedInspection.format.bitsPerSample !== format.bitsPerSample) {
    const error = new Error("Den skrivna WAV-filen motsvarar inte den begärda format- eller längdstrukturen.");
    error.code = "OUTPUT_STRUCTURE_VERIFICATION_FAILED";
    throw error;
  }
  if (enforceTruePeakCeiling && verifiedAnalysis.summary.truePeakEstimateDbtp !== null
      && verifiedAnalysis.summary.truePeakEstimateDbtp > truePeakCeilingDbtp + 1e-9) {
    const error = new Error(`Den faktiskt kodade WAV-filen överskrider True Peak-taket: ${verifiedAnalysis.summary.truePeakEstimateDbtp.toFixed(2)} dBTP.`);
    error.code = "VERIFIED_TRUE_PEAK_CEILING_EXCEEDED";
    error.details = { measuredDbtp: verifiedAnalysis.summary.truePeakEstimateDbtp, ceilingDbtp: truePeakCeilingDbtp };
    throw error;
  }
  if (!bitExactPayload && verifiedAnalysis.summary.nonFiniteSamples > 0) {
    const error = new Error("Den faktiskt kodade WAV-filen innehåller ogiltiga floatvärden.");
    error.code = "VERIFIED_INVALID_FLOAT";
    throw error;
  }
  onProgress({ phase: "hash-source", fraction: 0, message: "Verifierar källfilens lokala SHA-256" });
  const sourceIdentity = await sha256Blob(file, { shouldCancel: options.shouldCancel }, progress => {
    onProgress({ phase: "hash-source", fraction: progress.fraction, message: `Verifierar källfilens SHA-256 ${Math.round(progress.fraction * 100)} %` });
  });
  let samplePayloadIdentity = null;
  if (bitExactPayload) {
    const sourcePayload = file.slice(
      inspected.data.dataOffset + startFrame * format.blockAlign,
      inspected.data.dataOffset + endFrame * format.blockAlign,
    );
    const outputPayload = output.slice(
      verifiedInspection.data.dataOffset,
      verifiedInspection.data.dataOffset + verifiedInspection.data.completeDataBytes,
    );
    const [sourceHash, outputHash] = await Promise.all([
      sha256Blob(sourcePayload, { shouldCancel: options.shouldCancel }),
      sha256Blob(outputPayload, { shouldCancel: options.shouldCancel }),
    ]);
    if (sourceHash.value !== outputHash.value) {
      const error = new Error("Sample-payloaden är inte identisk med valt källintervall.");
      error.code = "SAMPLE_PAYLOAD_IDENTITY_FAILED";
      throw error;
    }
    samplePayloadIdentity = {
      algorithm: "SHA-256",
      scope: "selected-sample-payload-bytes",
      source: sourceHash.value,
      output: outputHash.value,
      identical: true,
      bytes: sourcePayload.size,
    };
  }
  const verifiedOutput = {
    label: "Verifierad exportfil",
    format: {
      container: verifiedInspection.container,
      channels: verifiedInspection.format.channels,
      sampleRate: verifiedInspection.format.sampleRate,
      bitsPerSample: verifiedInspection.format.bitsPerSample,
      validBitsPerSample: verifiedInspection.format.validBitsPerSample,
      encoding: verifiedInspection.format.encoding,
      frameCount: verifiedInspection.frameCount,
      durationSeconds: verifiedInspection.durationSeconds,
      riffPaddingBytes: dataPadBytes,
    },
    summary: verifiedAnalysis.summary,
    sourceIdentity: verifiedAnalysis.sourceIdentity,
    samplePayloadIdentity,
    samplePayloadHash: samplePayloadIdentity?.output || null,
    invalidFloatSamples: verifiedAnalysis.summary.nonFiniteSamples,
    containerValid: !verifiedInspection.isTruncated,
  };
  const report = {
    schema: "se.gaia.ljudr.export-report/1",
    createdAt: new Date().toISOString(),
    engine: { name: "LjudR Analysverkstad", version: ENGINE_VERSION },
    source: {
      name: file.name || null,
      size: file.size,
      lastModified: file.lastModified || null,
      container: inspected.container,
      encoding: format.encoding,
      channels: format.channels,
      sampleRate: format.sampleRate,
      bitsPerSample: format.bitsPerSample,
      frameCount: inspected.frameCount,
      sourceIdentity,
    },
    edit: {
      range: "[startFrame,endFrame)",
      startFrame,
      endFrame,
      selectedFrames,
      profile,
      gainDb: globalGainDb,
      intendedGainDb: globalGainDb,
      globalGainDb,
      peakAdjustmentDb: 0,
      effectiveGainDb,
      fadeInFrames,
      fadeOutFrames,
      fadeOverlapFrames,
      fadeOverlapPolicy: FADE_OVERLAP_POLICY,
      peakHandling: {
        enabled: enforceTruePeakCeiling,
        mode: "verify-only-no-hidden-adjustment",
        ceilingDbtp: truePeakCeilingDbtp,
        selectionTruePeakEstimateDbtp: preflight.truePeakEstimateDbtp,
        unadjustedTruePeakDbtp: preflight.source.summary.truePeakEstimateDbtp,
        predictedTruePeakDbtp: preflight.truePeakEstimateDbtp,
        truePeakMethod: preflight.truePeakMethod,
        validationStatus: preflight.validationStatus,
        dynamicProcessing: false
      },
      selectionTruePeakEstimateDbtp: preflight.truePeakEstimateDbtp,
      predictedTruePeakDbtp: preflight.truePeakEstimateDbtp,
      truePeakValidationStatus: preflight.validationStatus,
      bitExactSamplePayload: bitExactPayload
    },
    output: {
      name: fileName,
      size: output.size,
      writer: writer.mode,
      outputSamplePeak: bitExactPayload ? null : outputSamplePeak,
      replacedInvalidSamples: replacedInvalid,
      dither: {
        applied: ditherApplied,
        type: ditherApplied ? "TPDF" : null,
        reason: ditherApplied
          ? "PCM-samplingarna räknades om."
          : bitExactPayload
            ? "Sample-payloaden kopierades bitidentiskt."
            : "IEEE float-export kräver inte kvantiseringsdither."
      },
      ditherApplied,
      pcmClampingRisk,
      samplePayloadHash: samplePayloadIdentity?.output || null,
    },
    calculatedExportSelection: {
      label: "Beräknat exporturval",
      source: preflight.source,
      processed: preflight.processed,
    },
    preflight: {
      label: "Beräknat exporturval",
      source: preflight.source,
      processed: preflight.processed,
    },
    verifiedOutput,
    validation: {
      truePeakStatus: preflight.validationStatus,
      truePeakStatement: TRUE_PEAK_ORIENTATION.statement,
      truePeakMethod: preflight.truePeakMethod,
      selectionBased: true,
      measuredAfterFadesBeforeGain: true,
      predictedTruePeakExcludesDither: true
    },
    warnings: [
      ...inspected.warnings,
      ...(droppedChunks.length ? [`Följande icke nödvändiga eller positionsberoende WAV-block kopierades inte: ${[...new Set(droppedChunks)].join(", ")}.`] : []),
      ...(writer.mode === "memory" && output.size > MEMORY_WARNING_BYTES ? ["Stor export skapades i arbetsminnet. Kontrollera filen noggrant efter sparande på iPad."] : []),
      ...(fadeOverlapFrames > 0 ? ["Fade in och fade out överlappar. Den lägsta av de två linjära envelopperna används i överlappet."] : []),
      ...(preflight.invalidSamples && bitExactPayload
        ? [`Förkontrollen hittade ${preflight.invalidSamples} icke ändliga float-sampel. De bevarades eftersom sample-payloaden kopierades bitidentiskt.`]
        : []),
      ...(pcmClampingRisk.detected
        ? ["PCM-förkontrollen visar risk för mättnad vid en kodningsgräns. Granska topparna och exportens rapport."]
        : []),
      ...(bitExactPayload ? [] : [
        ditherApplied
          ? "Ljudsamplingarna räknades om. PCM-export använder TPDF-dither."
          : "Ljudsamplingarna räknades om. IEEE float-export använder inte kvantiseringsdither."
      ])
    ]
  };

    if (options.shouldCancel?.()) throw new DOMException("Exporten avbröts.", "AbortError");
    const storageRecord = await writer.markComplete();
    if (options.shouldCancel?.()) {
      if (storageRecord?.id) await removeStoredExport(storageRecord.id);
      throw new DOMException("Exporten avbröts.", "AbortError");
    }
    return {
      output,
      fileName,
      report,
      preflight: report.preflight,
      verifiedOutput,
      storage: storageRecord ? {
        id: storageRecord.id,
        fileName: storageRecord.fileName,
        size: storageRecord.size,
        createdAt: storageRecord.createdAt,
      } : null,
    };
  } catch (error) {
    await writer.cleanup();
    throw error;
  }
}

const runningInWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
if (runningInWorker) {
  const cancelledJobs = new Set();
  let latestExportJobId = null;
  self.addEventListener("message", async event => {
    const message = event.data || {};
    const jobId = String(message.jobId || "");
    if (message.type === "cancel") {
      if (jobId) cancelledJobs.add(jobId);
      return;
    }
    if (!["export", "storage-list", "storage-get", "storage-remove", "storage-clear"].includes(message.type) || !jobId) return;
    const operation = message.type;
    try {
      if (operation === "storage-list") {
        const items = await listStoredExports();
        self.postMessage({ type: "storage-list", jobId, operation, items });
        return;
      }
      if (operation === "storage-get") {
        const result = await getStoredExport(message.id);
        self.postMessage({ type: "result", jobId, operation, result });
        return;
      }
      if (operation === "storage-remove") {
        const result = await removeStoredExport(message.id);
        self.postMessage({ type: "result", jobId, operation, result });
        return;
      }
      if (operation === "storage-clear") {
        const result = await clearStoredExports();
        self.postMessage({ type: "result", jobId, operation, result });
        return;
      }

      latestExportJobId = jobId;
      cancelledJobs.delete(jobId);
      const shouldCancel = () => cancelledJobs.has(jobId) || latestExportJobId !== jobId;
      const result = await exportWav(message.file, {
        ...(message.options || {}),
        jobId,
        shouldCancel,
      }, progress => {
        if (!shouldCancel()) self.postMessage({ type: "progress", jobId, operation, ...progress });
      });
      if (shouldCancel()) self.postMessage({ type: "cancelled", jobId, operation });
      else self.postMessage({ type: "result", jobId, operation, result });
    } catch (error) {
      if (error?.name === "AbortError" || cancelledJobs.has(jobId)) {
        self.postMessage({ type: "cancelled", jobId, operation });
      } else {
        self.postMessage({
          type: "error",
          jobId,
          operation,
          message: error?.message || String(error),
          code: error?.code || null,
          details: error?.details || null
        });
      }
    } finally {
      cancelledJobs.delete(jobId);
    }
  });
}

export const exportInternals = {
  MemoryWriter,
  OpfsWriter,
  fadeFactor,
  cleanName,
  validateFormat,
  preflightSelection,
  pcmClampingAssessment
};
