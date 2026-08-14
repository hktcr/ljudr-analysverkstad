import {
  attachBlob,
  createTpdf,
  createWaveHeader,
  decodeInterleaved,
  encodeInterleaved,
  inspectWav
} from "./wav.js";
import {
  FirTruePeakEstimator,
  normalizePeakHandling,
  TRUE_PEAK_ORIENTATION
} from "./dsp-core.js";

const ENGINE_VERSION = "0.12.0";
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
const MEMORY_WARNING_BYTES = 512 * 1024 * 1024;
const GAIN_EPSILON_DB = 1e-9;
export const FADE_OVERLAP_POLICY = "minimum-envelope";

const cleanName = name => (name || "ljudr-export")
  .replace(/\.[^.]+$/, "")
  .replace(/[^a-zA-Z0-9åäöÅÄÖ_-]+/g, "_")
  .replace(/^_+|_+$/g, "") || "ljudr-export";

const clampFrame = (value, maximum) => Math.min(maximum, Math.max(0, Math.round(Number(value) || 0)));
const dbToLinear = value => 10 ** (value / 20);
const amplitudeToDb = value => value > 0 && Number.isFinite(value)
  ? 20 * Math.log10(value)
  : null;
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
}

class OpfsWriter {
  constructor(handle, access, mode) {
    this.handle = handle;
    this.access = access;
    this.mode = mode;
    this.position = 0;
  }

  static async create(fileName) {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName, { create: true });
    if (typeof handle.createSyncAccessHandle === "function") {
      const access = await handle.createSyncAccessHandle();
      access.truncate(0);
      return new OpfsWriter(handle, access, "opfs-sync");
    }
    const access = await handle.createWritable({ keepExistingData: false });
    return new OpfsWriter(handle, access, "opfs-async");
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
    const file = await this.handle.getFile();
    return new File([file], fileName, { type: "audio/wav", lastModified: Date.now() });
  }
}

async function chooseWriter(fileName, outputBytes, preferOpfs) {
  const opfsAvailable = typeof navigator !== "undefined"
    && navigator.storage
    && typeof navigator.storage.getDirectory === "function";
  if (preferOpfs !== false && opfsAvailable) {
    try {
      return await OpfsWriter.create(fileName);
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
  const { startFrame, selectedFrames, fadeInFrames, fadeOutFrames } = selection;
  const { format } = inspected;
  const chunkFrames = Math.max(1, Math.floor(DEFAULT_CHUNK_BYTES / format.blockAlign));
  const truePeak = new FirTruePeakEstimator(format.channels, format.sampleRate);
  let processedFrames = 0;
  let samplePeak = 0;
  let maximum = -Infinity;
  let minimum = Infinity;
  let invalidSamples = 0;

  while (processedFrames < selectedFrames) {
    if (shouldCancel?.()) throw new DOMException("Exporten avbröts.", "AbortError");
    const frames = Math.min(chunkFrames, selectedFrames - processedFrames);
    const sourceFrame = startFrame + processedFrames;
    const byteStart = inspected.data.dataOffset + sourceFrame * format.blockAlign;
    const bytes = new Uint8Array(await file.slice(
      byteStart,
      byteStart + frames * format.blockAlign
    ).arrayBuffer());
    const samples = decodeInterleaved(bytes, format);

    for (let frame = 0; frame < frames; frame += 1) {
      const selectionFrame = processedFrames + frame;
      const envelope = fadeFactor(
        selectionFrame,
        selectedFrames,
        fadeInFrames,
        fadeOutFrames
      );
      for (let channel = 0; channel < format.channels; channel += 1) {
        const index = frame * format.channels + channel;
        let sample = samples[index];
        if (!Number.isFinite(sample)) {
          sample = 0;
          invalidSamples += 1;
        }
        sample *= envelope;
        truePeak.push(channel, sample);
        const absolute = Math.abs(sample);
        if (absolute > samplePeak) samplePeak = absolute;
        if (sample > maximum) maximum = sample;
        if (sample < minimum) minimum = sample;
      }
    }

    processedFrames += frames;
    onProgress({
      phase: "peak-preflight",
      fraction: processedFrames / selectedFrames,
      processedFrames,
      selectedFrames,
      message: `Kontrollerar toppar ${Math.round(100 * processedFrames / selectedFrames)} %`
    });
  }

  truePeak.finish();
  const truePeakEstimate = Math.max(...truePeak.peaks);
  return {
    samplePeak,
    samplePeakDbfs: amplitudeToDb(samplePeak),
    maximum: Number.isFinite(maximum) ? maximum : 0,
    minimum: Number.isFinite(minimum) ? minimum : 0,
    invalidSamples,
    truePeakEstimate,
    truePeakEstimateDbtp: amplitudeToDb(truePeakEstimate),
    truePeakFactor: truePeak.factor,
    truePeakMethod: truePeak.factor === 1
      ? "Sample peak vid minst 192 kHz"
      : `${truePeak.factor}x polyfas FIR-oversampling med 49 tappar`,
    validationStatus: TRUE_PEAK_ORIENTATION.status
  };
}

function calculatePeakAdjustment(selectionTruePeakDbtp, intendedGainDb, peakHandling) {
  if (selectionTruePeakDbtp === null) {
    return {
      peakAdjustmentDb: 0,
      effectiveGainDb: intendedGainDb,
      predictedTruePeakDbtp: null,
      unadjustedTruePeakDbtp: null
    };
  }
  const unadjustedTruePeakDbtp = selectionTruePeakDbtp + intendedGainDb;
  const excessDb = unadjustedTruePeakDbtp - peakHandling.ceilingDbtp;
  const peakAdjustmentDb = peakHandling.enabled && excessDb > GAIN_EPSILON_DB
    ? -excessDb
    : 0;
  const effectiveGainDb = cleanNearZero(intendedGainDb + peakAdjustmentDb);
  return {
    peakAdjustmentDb: cleanNearZero(peakAdjustmentDb),
    effectiveGainDb,
    predictedTruePeakDbtp: selectionTruePeakDbtp + effectiveGainDb,
    unadjustedTruePeakDbtp
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

  const intendedGainDb = Number.isFinite(Number(options.gainDb)) ? Number(options.gainDb) : 0;
  const fadeInFrames = Math.min(selectedFrames, clampFrame(options.fadeInFrames, selectedFrames));
  const fadeOutFrames = Math.min(selectedFrames, clampFrame(options.fadeOutFrames, selectedFrames));
  const fadeOverlapFrames = Math.max(0, fadeInFrames + fadeOutFrames - selectedFrames);
  const peakHandling = normalizePeakHandling(options.peakHandling);
  const preflight = await preflightSelection(file, inspected, {
    startFrame,
    selectedFrames,
    fadeInFrames,
    fadeOutFrames
  }, onProgress, options.shouldCancel);
  const peakResult = calculatePeakAdjustment(
    preflight.truePeakEstimateDbtp,
    intendedGainDb,
    peakHandling
  );
  const { peakAdjustmentDb, effectiveGainDb, predictedTruePeakDbtp,
    unadjustedTruePeakDbtp } = peakResult;
  const gainLinear = dbToLinear(effectiveGainDb);
  const bitExactPayload = effectiveGainDb === 0 && fadeInFrames === 0 && fadeOutFrames === 0;
  const ditherApplied = !bitExactPayload && inspected.format.encoding === "PCM";
  const pcmClampingRisk = pcmClampingAssessment(
    inspected.format,
    preflight,
    effectiveGainDb,
    ditherApplied
  );
  if (pcmClampingRisk.detected && effectiveGainDb > GAIN_EPSILON_DB) {
    const error = new Error(
      "Den valda positiva gainen skulle klampa PCM-sampel. Sänk gainen eller aktivera global toppanpassning med en lägre dBTP-gräns."
    );
    error.name = "PcmClampingRiskError";
    error.code = "PCM_CLAMPING_RISK";
    error.details = { ...pcmClampingRisk, blocked: true };
    throw error;
  }
  const fileName = `${cleanName(options.fileName || file.name)}_trim.wav`;
  const { header, dataBytes, droppedChunks } = await createWaveHeader(inspected, selectedFrames, startFrame);
  const writer = await chooseWriter(fileName, header.byteLength + dataBytes, options.preferOpfs);
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

  const output = await writer.finish(fileName);
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
      frameCount: inspected.frameCount
    },
    edit: {
      range: "[startFrame,endFrame)",
      startFrame,
      endFrame,
      selectedFrames,
      gainDb: intendedGainDb,
      intendedGainDb,
      peakAdjustmentDb,
      effectiveGainDb,
      fadeInFrames,
      fadeOutFrames,
      fadeOverlapFrames,
      fadeOverlapPolicy: FADE_OVERLAP_POLICY,
      peakHandling: {
        ...peakHandling,
        selectionTruePeakEstimateDbtp: preflight.truePeakEstimateDbtp,
        unadjustedTruePeakDbtp,
        predictedTruePeakDbtp,
        truePeakMethod: preflight.truePeakMethod,
        validationStatus: preflight.validationStatus,
        dynamicProcessing: false
      },
      selectionTruePeakEstimateDbtp: preflight.truePeakEstimateDbtp,
      predictedTruePeakDbtp,
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
      pcmClampingRisk
    },
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
      ...(startFrame > 0 && inspected.chunks.some(chunk => chunk.id === "iXML")
        ? ["iXML-blocket bevarades oförändrat. Kontrollera eventuella tidsreferenser i metadata efter trimning."]
        : []),
      ...(writer.mode === "memory" && output.size > MEMORY_WARNING_BYTES ? ["Stor export skapades i arbetsminnet. Kontrollera filen noggrant efter sparande på iPad."] : []),
      ...(fadeOverlapFrames > 0 ? ["Fade in och fade out överlappar. Den lägsta av de två linjära envelopperna används i överlappet."] : []),
      ...(peakAdjustmentDb < 0 ? [`Global toppanpassning sänkte hela urvalet med ${Math.abs(peakAdjustmentDb).toFixed(2)} dB. Ingen dynamisk limitering användes.`] : []),
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

  return { output, fileName, report };
}

const runningInWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
if (runningInWorker) {
  self.addEventListener("message", async event => {
    if (event.data?.type !== "export") return;
    try {
      const { file, options } = event.data;
      const result = await exportWav(file, options, progress => self.postMessage({ type: "progress", ...progress }));
      self.postMessage({ type: "result", ...result });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error?.message || String(error),
        code: error?.code || null,
        details: error?.details || null
      });
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
  calculatePeakAdjustment,
  pcmClampingAssessment
};
