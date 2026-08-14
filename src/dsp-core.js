/*
 * LjudR Analysverkstad, lokal DSP-kärna.
 *
 * Motorn läser WAVE-data i block och behåller aldrig hela ljudfilen i minnet.
 * Ljudfilen ändras inte. Mätvärdena är avsedda som sakliga beslutsunderlag.
 */

export const ENGINE_VERSION = "0.11.0";

export const DEFAULT_PEAK_HANDLING = Object.freeze({
  enabled: false,
  mode: "global-attenuation",
  ceilingDbtp: -2,
  sourceTruePeakDbtp: null,
});

export function normalizePeakHandling(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const enabled = input.enabled === true;
  const mode = input.mode || DEFAULT_PEAK_HANDLING.mode;
  if (mode !== "global-attenuation") {
    throw new Error("Endast global toppanpassning utan dynamisk limitering stöds.");
  }
  const ceilingCandidate = Number(input.ceilingDbtp ?? DEFAULT_PEAK_HANDLING.ceilingDbtp);
  if (!Number.isFinite(ceilingCandidate) || ceilingCandidate < -60 || ceilingCandidate > 0) {
    throw new Error("Toppgränsen måste vara ett ändligt värde mellan -60 och 0 dBTP.");
  }
  const sourceCandidate = input.sourceTruePeakDbtp == null
    ? Number.NaN
    : Number(input.sourceTruePeakDbtp);
  return {
    enabled,
    mode,
    ceilingDbtp: ceilingCandidate,
    sourceTruePeakDbtp: Number.isFinite(sourceCandidate) ? sourceCandidate : null,
  };
}

const DEFAULTS = Object.freeze({
  readBlockBytes: 4 * 1024 * 1024,
  waveformBins: 4096,
  timelineStepSeconds: 0.1,
  lowLevelThresholdDbfs: -80,
  lowLevelMinimumSeconds: 1,
  zeroMinimumSeconds: 0.1,
  discontinuityThreshold: 0.8,
  flatTopThreshold: 0.999,
  flatTopMinimumSamples: 3,
  maxMarkersPerKind: 100,
});

const textDecoder = new TextDecoder("ascii");

function ascii(bytes, offset, length) {
  return textDecoder.decode(bytes.subarray(offset, offset + length));
}

function finiteDb(value, floor = -Infinity) {
  return value > 0 && Number.isFinite(value) ? 20 * Math.log10(value) : floor;
}

function energyToLufs(value) {
  return value > 0 && Number.isFinite(value)
    ? -0.691 + 10 * Math.log10(value)
    : -Infinity;
}

function lufsToEnergy(value) {
  return 10 ** ((value + 0.691) / 10);
}

function percentile(sorted, probability) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

function mean(values, end = values.length) {
  if (!end) return 0;
  let sum = 0;
  for (let index = 0; index < end; index += 1) sum += values[index];
  return sum / end;
}

export function calculateIntegratedLufs(blockEnergies, end = blockEnergies.length) {
  if (!end) return null;
  const absoluteGate = lufsToEnergy(-70);
  let absoluteSum = 0;
  let absoluteCount = 0;
  for (let index = 0; index < end; index += 1) {
    const value = blockEnergies[index];
    if (value >= absoluteGate && Number.isFinite(value)) {
      absoluteSum += value;
      absoluteCount += 1;
    }
  }
  if (!absoluteCount) return null;
  const relativeGate = (absoluteSum / absoluteCount) * 0.1;
  const gate = Math.max(absoluteGate, relativeGate);
  let gatedSum = 0;
  let gatedCount = 0;
  for (let index = 0; index < end; index += 1) {
    const value = blockEnergies[index];
    if (value >= gate && Number.isFinite(value)) {
      gatedSum += value;
      gatedCount += 1;
    }
  }
  return gatedCount ? energyToLufs(gatedSum / gatedCount) : null;
}

export function calculateLoudnessRange(shortTermEnergies) {
  const absoluteGate = lufsToEnergy(-70);
  const aboveAbsolute = shortTermEnergies.filter(
    (value) => value >= absoluteGate && Number.isFinite(value),
  );
  if (!aboveAbsolute.length) return null;
  const relativeGate = mean(aboveAbsolute) * 0.01;
  const gate = Math.max(absoluteGate, relativeGate);
  const loudness = shortTermEnergies
    .filter((value) => value >= gate && Number.isFinite(value))
    .map(energyToLufs)
    .sort((left, right) => left - right);
  if (!loudness.length) return null;
  return percentile(loudness, 0.95) - percentile(loudness, 0.1);
}

async function readBytes(blob, offset, length) {
  const safeLength = Math.max(0, Math.min(length, blob.size - offset));
  return new Uint8Array(await blob.slice(offset, offset + safeLength).arrayBuffer());
}

function parseFormat(bytes, chunkSize) {
  if (chunkSize < 16 || bytes.byteLength < 16) {
    throw new Error("WAVE-filens fmt-block är ofullständigt.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let formatTag = view.getUint16(0, true);
  const channels = view.getUint16(2, true);
  const sampleRate = view.getUint32(4, true);
  const byteRate = view.getUint32(8, true);
  const blockAlign = view.getUint16(12, true);
  const bitsPerSample = view.getUint16(14, true);
  let validBitsPerSample = bitsPerSample;
  let channelMask = null;
  let extensible = false;

  if (formatTag === 0xfffe) {
    if (chunkSize < 40 || bytes.byteLength < 40) {
      throw new Error("WAVE_FORMAT_EXTENSIBLE-blocket är ofullständigt.");
    }
    const extensionSize = view.getUint16(16, true);
    if (extensionSize < 22) {
      throw new Error("WAVE_FORMAT_EXTENSIBLE saknar obligatoriska fält.");
    }
    validBitsPerSample = view.getUint16(18, true) || bitsPerSample;
    channelMask = view.getUint32(20, true);
    const subFormatTail = [0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
    const canonicalTail = subFormatTail.every((value, index) => view.getUint8(28 + index) === value);
    formatTag = view.getUint32(24, true);
    if (!canonicalTail) {
      throw new Error("WAVE_FORMAT_EXTENSIBLE använder en subformat-GUID som inte stöds.");
    }
    extensible = true;
  }

  if (![1, 3].includes(formatTag)) {
    throw new Error(`Ljudformatet ${formatTag} stöds inte. Använd PCM eller IEEE float WAVE.`);
  }
  if (channels < 1 || channels > 2) {
    throw new Error(`Filen har ${channels} kanaler. Denna version stöder mono och stereo.`);
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
    throw new Error(`Samplingsfrekvensen ${sampleRate} Hz stöds inte.`);
  }
  if (formatTag === 3 && bitsPerSample !== 32) {
    throw new Error("IEEE float stöds för 32 bitar.");
  }
  if (formatTag === 1 && ![16, 24, 32].includes(bitsPerSample)) {
    throw new Error("PCM stöds för 16, 24 och 32 bitar.");
  }
  const expectedBlockAlign = channels * (bitsPerSample / 8);
  if (blockAlign !== expectedBlockAlign) {
    throw new Error("WAVE-filens blockstorlek stämmer inte med kanal- och bitdjup.");
  }

  return {
    formatTag,
    encoding: formatTag === 3 ? "IEEE float" : "PCM",
    channels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    validBitsPerSample,
    channelMask,
    extensible,
    byteRateConsistent: byteRate === sampleRate * blockAlign,
  };
}

export async function parseWavHeader(blob) {
  if (!blob || typeof blob.slice !== "function" || typeof blob.size !== "number") {
    throw new TypeError("En fil eller Blob krävs.");
  }
  if (blob.size < 44) throw new Error("Filen är för liten för att vara en WAVE-fil.");
  const root = await readBytes(blob, 0, 12);
  const rootId = ascii(root, 0, 4);
  if (rootId === "RF64" || rootId === "BW64") {
    throw new Error("RF64 och BW64 är ännu inte aktiverade i denna version.");
  }
  if (rootId !== "RIFF" || ascii(root, 8, 4) !== "WAVE") {
    throw new Error("Filen är inte en RIFF/WAVE-fil med little endian byteordning.");
  }

  let offset = 12;
  let format = null;
  let data = null;
  const chunks = [];
  while (offset + 8 <= blob.size) {
    const header = await readBytes(blob, offset, 8);
    if (header.byteLength < 8) break;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const id = ascii(header, 0, 4);
    const declaredSize = view.getUint32(4, true);
    const payloadOffset = offset + 8;
    const availableSize = Math.max(0, Math.min(declaredSize, blob.size - payloadOffset));
    chunks.push({ id, offset: payloadOffset, declaredSize, availableSize });

    if (id === "fmt ") {
      const formatBytes = await readBytes(blob, payloadOffset, Math.min(declaredSize, 64));
      format = parseFormat(formatBytes, declaredSize);
    } else if (id === "data" && !data) {
      data = { offset: payloadOffset, declaredSize, availableSize };
    }

    if (format && data) break;
    const next = payloadOffset + declaredSize + (declaredSize & 1);
    if (!Number.isSafeInteger(next) || next <= offset || next > blob.size + 1) break;
    offset = next;
  }

  if (!format) throw new Error("WAVE-filen saknar fmt-block.");
  if (!data) throw new Error("WAVE-filen saknar data-block.");
  const completeBytes = data.availableSize - (data.availableSize % format.blockAlign);
  if (completeBytes <= 0) throw new Error("WAVE-filens data-block innehåller inga hela ljudramar.");
  const frameCount = completeBytes / format.blockAlign;
  return {
    container: "RIFF/WAVE",
    ...format,
    dataOffset: data.offset,
    dataBytes: completeBytes,
    declaredDataBytes: data.declaredSize,
    truncated: data.availableSize < data.declaredSize || completeBytes !== data.availableSize,
    frameCount,
    durationSeconds: frameCount / format.sampleRate,
    chunks,
  };
}

class Biquad {
  constructor({ b0, b1, b2, a1, a2 }) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }

  process(value) {
    const result = this.b0 * value + this.b1 * this.x1 + this.b2 * this.x2
      - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = value;
    this.y2 = this.y1;
    this.y1 = result;
    return result;
  }
}

function highShelf(sampleRate) {
  const frequency = 1681.974450955533;
  const gain = 3.999843853973347;
  const quality = 0.7071752369554196;
  const k = Math.tan(Math.PI * frequency / sampleRate);
  const vh = 10 ** (gain / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / quality + k * k;
  return {
    b0: (vh + vb * k / quality + k * k) / a0,
    b1: 2 * (k * k - vh) / a0,
    b2: (vh - vb * k / quality + k * k) / a0,
    a1: 2 * (k * k - 1) / a0,
    a2: (1 - k / quality + k * k) / a0,
  };
}

function highPass(sampleRate) {
  const frequency = 38.13547087602444;
  const quality = 0.5003270373238773;
  const k = Math.tan(Math.PI * frequency / sampleRate);
  const a0 = 1 + k / quality + k * k;
  return {
    b0: 1 / a0,
    b1: -2 / a0,
    b2: 1 / a0,
    a1: 2 * (k * k - 1) / a0,
    a2: (1 - k / quality + k * k) / a0,
  };
}

class KWeightingFilter {
  constructor(sampleRate) {
    this.shelf = new Biquad(highShelf(sampleRate));
    this.pass = new Biquad(highPass(sampleRate));
  }

  process(value) {
    return this.pass.process(this.shelf.process(value));
  }
}

export const TRUE_PEAK_ORIENTATION = Object.freeze({
  status: "orientational-not-standard-validated",
  statement: "Kubisk intersample-estimering för orientering. Resultatet är inte en standardvaliderad dBTP-mätning.",
});

export class CubicTruePeakEstimator {
  constructor(channels, sampleRate) {
    this.factor = sampleRate >= 96000 ? 2 : 4;
    this.states = Array.from({ length: channels }, () => ({
      p0: 0,
      p1: 0,
      p2: 0,
      count: 0,
    }));
    this.peaks = new Float64Array(channels);
  }

  interpolate(channel, p0, p1, p2, p3) {
    for (let phase = 1; phase < this.factor; phase += 1) {
      const t = phase / this.factor;
      const t2 = t * t;
      const t3 = t2 * t;
      const estimate = 0.5 * ((2 * p1) + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      const candidate = Math.abs(estimate);
      if (candidate > this.peaks[channel]) this.peaks[channel] = candidate;
    }
  }

  push(channel, sample) {
    const state = this.states[channel];
    const absolute = Math.abs(sample);
    if (absolute > this.peaks[channel]) this.peaks[channel] = absolute;
    if (state.count === 0) {
      state.p0 = sample;
      state.count = 1;
      return;
    }
    if (state.count === 1) {
      state.p1 = sample;
      state.count = 2;
      return;
    }
    if (state.count === 2) {
      state.p2 = sample;
      state.count = 3;
      this.interpolate(channel, state.p0, state.p0, state.p1, state.p2);
      return;
    }
    this.interpolate(channel, state.p0, state.p1, state.p2, sample);
    state.p0 = state.p1;
    state.p1 = state.p2;
    state.p2 = sample;
  }

  finish() {
    for (let channel = 0; channel < this.states.length; channel += 1) {
      const state = this.states[channel];
      if (state.count === 2) {
        for (let phase = 1; phase < this.factor; phase += 1) {
          const t = phase / this.factor;
          const value = state.p0 + (state.p1 - state.p0) * t;
          const absolute = Math.abs(value);
          if (absolute > this.peaks[channel]) this.peaks[channel] = absolute;
        }
      } else if (state.count >= 3) {
        this.interpolate(channel, state.p0, state.p1, state.p2, state.p2);
      }
    }
  }
}

function decodeSample(view, offset, format) {
  if (format.formatTag === 3) return view.getFloat32(offset, true);
  if (format.bitsPerSample === 16) return view.getInt16(offset, true) / 32768;
  if (format.bitsPerSample === 24) {
    let value = view.getUint8(offset)
      | (view.getUint8(offset + 1) << 8)
      | (view.getUint8(offset + 2) << 16);
    if (value & 0x800000) value -= 0x1000000;
    return value / 8388608;
  }
  return view.getInt32(offset, true) / 2147483648;
}

function createChannelStats() {
  return {
    sum: 0,
    sumCompensation: 0,
    sumSquares: 0,
    peak: 0,
    peakFrame: 0,
    maximum: -Infinity,
    minimum: Infinity,
    zeroSamples: 0,
    overrangeSamples: 0,
    nonFiniteSamples: 0,
    flatRuns: 0,
    flatSamples: 0,
    previous: null,
    repeatedAtRail: 0,
    maxDelta: 0,
  };
}

function kahanAdd(stats, value) {
  const adjusted = value - stats.sumCompensation;
  const total = stats.sum + adjusted;
  stats.sumCompensation = (total - stats.sum) - adjusted;
  stats.sum = total;
}

function regionCollector(minimumFrames, maximumStoredRegions = 1000) {
  let start = null;
  const regions = [];
  let count = 0;
  return {
    push(frame, active) {
      if (active && start === null) start = frame;
      if (!active && start !== null) {
        if (frame - start >= minimumFrames) {
          count += 1;
          if (regions.length < maximumStoredRegions) regions.push([start, frame]);
        }
        start = null;
      }
    },
    finish(frame) {
      if (start !== null && frame - start >= minimumFrames) {
        count += 1;
        if (regions.length < maximumStoredRegions) regions.push([start, frame]);
      }
      return { regions, count };
    },
  };
}

function frameRegionsToSeconds(regions, sampleRate, limit = 50) {
  return regions.slice(0, limit).map(([start, end]) => ({
    startSeconds: start / sampleRate,
    endSeconds: end / sampleRate,
    durationSeconds: (end - start) / sampleRate,
  }));
}

function rollingWindowEnergy(values, windowLength, output) {
  let sum = 0;
  let valid = 0;
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (current !== null && Number.isFinite(current)) {
      sum += current;
      valid += 1;
    }
    if (index >= windowLength) {
      const leaving = values[index - windowLength];
      if (leaving !== null && Number.isFinite(leaving)) {
        sum -= leaving;
        valid -= 1;
      }
    }
    output[index] = index >= windowLength - 1 && valid === windowLength ? sum / windowLength : null;
  }
}

function maxFiniteEntry(values) {
  let value = null;
  let index = null;
  for (let candidateIndex = 0; candidateIndex < values.length; candidateIndex += 1) {
    const candidate = values[candidateIndex];
    if (candidate !== null && Number.isFinite(candidate) && (value === null || candidate > value)) {
      value = candidate;
      index = candidateIndex;
    }
  }
  return { value, index };
}

function createObservation(id, severity, title, message, objective, regions = []) {
  return { id, severity, title, message, objective, regions };
}

function buildObservations(context) {
  const { format, channelResults, global, zeroRegions, overrangeRegions, discontinuities,
    zeroRegionCount, overrangeRegionCount, discontinuityCount, lowLevelRegions,
    flatTopCount, integratedLufs, loudnessRangeLu } = context;
  const observations = [];
  if (format.truncated) {
    observations.push(createObservation(
      "truncated-data", "warning", "Ofullständigt data-block",
      "Data-blocket är kortare än storleken som anges i filhuvudet. Analysen använder endast hela tillgängliga ljudramar.", true,
    ));
  }
  const nonFinite = channelResults.reduce((sum, channel) => sum + channel.nonFiniteSamples, 0);
  if (nonFinite) {
    observations.push(createObservation(
      "non-finite", "warning", "Icke ändliga flyttal",
      `${nonFinite} sampel innehåller NaN eller oändlighet och har uteslutits ur numeriska mått.`, true,
    ));
  }
  const overrange = channelResults.reduce((sum, channel) => sum + channel.overrangeSamples, 0);
  if (overrange) {
    observations.push(createObservation(
      "overrange", "notice", "Flyttal över full skala",
      `${overrange} sampel har absolutvärde över 1,0. Det är mätbara överrange-värden i floatdata, inte i sig bevis på klippning.`, true,
      overrangeRegions,
    ));
  }
  if (flatTopCount) {
    observations.push(createObservation(
      "flat-top", "notice", "Möjlig platå nära full skala",
      `${flatTopCount} sekvenser uppfyller en enkel platåheuristik. Kontrollera dem med lyssning och förstoring innan slutsats.`, false,
    ));
  }
  if (discontinuityCount) {
    observations.push(createObservation(
      "discontinuity", "notice", "Snabba nivåsprång",
      `${discontinuityCount} nivåsprång passerar den valda tekniska tröskeln. De kan vara naturliga transienter.`, false,
    ));
  }
  if (zeroRegionCount) {
    observations.push(createObservation(
      "digital-zero", "info", "Digital noll",
      `${zeroRegionCount} sammanhängande perioder består av exakt digital noll.`, true,
      zeroRegions,
    ));
  }
  if (lowLevelRegions.length) {
    observations.push(createObservation(
      "low-level", "info", "Perioder under vald nivå",
      `${lowLevelRegions.length} perioder ligger under användarens RMS-tröskel. Detta är inte en bedömning av brus eller innehåll.`, true,
      lowLevelRegions,
    ));
  }
  if (overrangeRegionCount > overrangeRegions.length) {
    observations.push(createObservation(
      "overrange-region-limit", "info", "Många överrange-perioder",
      `${overrangeRegionCount} perioder hittades. Rapporten visar ett begränsat urval för att hålla projektfilen liten.`, true,
    ));
  }
  if (format.durationSeconds < 60 && loudnessRangeLu !== null) {
    observations.push(createObservation(
      "lra-short", "info", "LRA för kort material",
      "Loudness Range är statistiskt mindre stabilt när materialet är kortare än 60 sekunder.", true,
    ));
  }
  if (!format.byteRateConsistent) {
    observations.push(createObservation(
      "byte-rate", "info", "Avvikande byte rate",
      "Byte rate i filhuvudet stämmer inte med samplingsfrekvens och blockstorlek. Ljudramarna kan ändå analyseras.", true,
    ));
  }
  if (integratedLufs === null) {
    observations.push(createObservation(
      "below-gate", "info", "Ingen integrerad loudness",
      "Ingen del passerade den absoluta loudness-grinden vid -70 LUFS.", true,
    ));
  }
  if (global.validFrames === 0) {
    observations.push(createObservation(
      "no-valid-frames", "warning", "Inga giltiga ljudramar",
      "Filen innehöll inga ljudramar där alla kanaler hade ändliga värden.", true,
    ));
  }
  return observations;
}

function suggestedMarkers(discontinuities, flatTopEvents, zeroRegions, overrangeRegions, limit) {
  const markers = [];
  for (const item of discontinuities.slice(0, limit)) {
    markers.push({
      timeSeconds: item.timeSeconds,
      type: "technical",
      severity: "notice",
      label: "Snabbt nivåsprång",
      detail: `Skillnad ${item.delta.toFixed(3)} i kanal ${item.channel + 1}.`,
    });
  }
  for (const item of flatTopEvents.slice(0, limit)) {
    markers.push({
      timeSeconds: item.timeSeconds,
      type: "technical",
      severity: "notice",
      label: "Möjlig platå",
      detail: `Sekvens nära full skala i kanal ${item.channel + 1}.`,
    });
  }
  for (const item of zeroRegions.slice(0, limit)) {
    markers.push({
      timeSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      type: "technical",
      severity: "info",
      label: "Digital noll",
      detail: `${item.durationSeconds.toFixed(3)} sekunder.`,
    });
  }
  for (const item of overrangeRegions.slice(0, limit)) {
    markers.push({
      timeSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      type: "technical",
      severity: "notice",
      label: "Över full skala",
      detail: `${item.durationSeconds.toFixed(3)} sekunder med minst ett floatvärde över 1,0.`,
    });
  }
  return markers.sort((left, right) => left.timeSeconds - right.timeSeconds).slice(0, limit * 2);
}

export async function analyzeWav(blob, suppliedOptions = {}, onProgress = () => {}) {
  const options = { ...DEFAULTS, ...suppliedOptions };
  onProgress({ phase: "header", fraction: 0, message: "Läser filhuvud" });
  const header = await parseWavHeader(blob);
  const { channels, sampleRate, blockAlign, bitsPerSample, frameCount } = header;
  const bytesPerSample = bitsPerSample / 8;
  const channelStats = Array.from({ length: channels }, createChannelStats);
  const kFilters = Array.from({ length: channels }, () => new KWeightingFilter(sampleRate));
  const truePeak = new CubicTruePeakEstimator(channels, sampleRate);

  const waveformBins = Math.max(64, Math.min(options.waveformBins, frameCount));
  const framesPerWaveformBin = Math.max(1, Math.ceil(frameCount / waveformBins));
  const waveform = Array.from({ length: channels }, () => ({
    min: new Float32Array(waveformBins).fill(Infinity),
    max: new Float32Array(waveformBins).fill(-Infinity),
    sumSquares: new Float64Array(waveformBins),
    count: new Uint32Array(waveformBins),
  }));

  const stepFrames = Math.max(1, Math.round(sampleRate * options.timelineStepSeconds));
  const loudnessStepEnergies = [];
  const rawStepEnergies = [];
  const channelStepEnergies = Array.from({ length: channels }, () => []);
  const stepSamplePeaks = [];
  const stepBalance = [];
  const stepCorrelation = [];
  const stepMidSideRatio = [];
  let stepKSum = new Float64Array(channels);
  let stepRawSum = new Float64Array(channels);
  let stepPeak = 0;
  let stepSumL = 0;
  let stepSumR = 0;
  let stepSumLR = 0;
  let stepSumL2 = 0;
  let stepSumR2 = 0;
  let stepMid = 0;
  let stepSide = 0;
  let stepCount = 0;
  let stepValidStereoFrames = 0;

  const global = {
    validFrames: 0,
    sumL: 0,
    sumR: 0,
    sumLR: 0,
    sumL2: 0,
    sumR2: 0,
    midEnergy: 0,
    sideEnergy: 0,
  };
  const zeroCollector = regionCollector(Math.round(sampleRate * options.zeroMinimumSeconds));
  const overrangeCollector = regionCollector(1);
  const discontinuities = [];
  const flatTopEvents = [];
  let discontinuityCount = 0;
  let frameIndex = 0;

  function finishStep(complete = true) {
    if (!stepCount) return;
    let kEnergy = 0;
    let rawEnergy = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const kValue = stepKSum[channel] / stepCount;
      const rawValue = stepRawSum[channel] / stepCount;
      kEnergy += kValue;
      rawEnergy += rawValue;
      channelStepEnergies[channel].push(rawValue);
    }
    loudnessStepEnergies.push(complete ? kEnergy : null);
    rawStepEnergies.push(rawEnergy / channels);
    stepSamplePeaks.push(stepPeak);
    if (channels === 2) {
      const count = stepValidStereoFrames;
      const covariance = stepSumLR - (stepSumL * stepSumR / count);
      const varianceL = stepSumL2 - (stepSumL * stepSumL / count);
      const varianceR = stepSumR2 - (stepSumR * stepSumR / count);
      const denominator = Math.sqrt(Math.max(0, varianceL * varianceR));
      stepCorrelation.push(count > 0 && denominator > 0 ? Math.max(-1, Math.min(1, covariance / denominator)) : null);
      stepBalance.push(count > 0 && stepSumR2 > 0 ? 10 * Math.log10(stepSumL2 / stepSumR2) : null);
      stepMidSideRatio.push(count > 0 && stepSide > 0 ? 10 * Math.log10(stepMid / stepSide) : null);
    }
    stepKSum = new Float64Array(channels);
    stepRawSum = new Float64Array(channels);
    stepPeak = 0;
    stepSumL = 0;
    stepSumR = 0;
    stepSumLR = 0;
    stepSumL2 = 0;
    stepSumR2 = 0;
    stepMid = 0;
    stepSide = 0;
    stepCount = 0;
    stepValidStereoFrames = 0;
  }

  const alignedBlockBytes = Math.max(
    blockAlign,
    Math.floor(options.readBlockBytes / blockAlign) * blockAlign,
  );
  let consumedBytes = 0;
  const samples = new Float64Array(channels);
  while (consumedBytes < header.dataBytes) {
    if (options.shouldCancel?.()) throw new DOMException("Analysen avbröts.", "AbortError");
    const length = Math.min(alignedBlockBytes, header.dataBytes - consumedBytes);
    const bytes = await readBytes(blob, header.dataOffset + consumedBytes, length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const blockFrames = Math.floor(bytes.byteLength / blockAlign);
    for (let localFrame = 0; localFrame < blockFrames; localFrame += 1) {
      let allFinite = true;
      let allZero = true;
      let anyOverrange = false;
      for (let channel = 0; channel < channels; channel += 1) {
        const byteOffset = localFrame * blockAlign + channel * bytesPerSample;
        const sample = decodeSample(view, byteOffset, header);
        samples[channel] = sample;
        const stats = channelStats[channel];
        if (!Number.isFinite(sample)) {
          stats.nonFiniteSamples += 1;
          allFinite = false;
          allZero = false;
          const weighted = kFilters[channel].process(0);
          stepKSum[channel] += weighted * weighted;
          continue;
        }
        kahanAdd(stats, sample);
        stats.sumSquares += sample * sample;
        if (sample === 0) stats.zeroSamples += 1;
        else allZero = false;
        const absolute = Math.abs(sample);
        if (absolute > stats.peak) {
          stats.peak = absolute;
          stats.peakFrame = frameIndex;
        }
        if (sample > stats.maximum) stats.maximum = sample;
        if (sample < stats.minimum) stats.minimum = sample;
        if (absolute > 1) {
          stats.overrangeSamples += 1;
          anyOverrange = true;
        }
        if (stats.previous !== null) {
          const delta = Math.abs(sample - stats.previous);
          if (delta > stats.maxDelta) stats.maxDelta = delta;
          if (delta >= options.discontinuityThreshold) {
            discontinuityCount += 1;
            if (discontinuities.length < options.maxMarkersPerKind) {
              discontinuities.push({ frame: frameIndex, timeSeconds: frameIndex / sampleRate, channel, delta });
            }
          }
          if (absolute >= options.flatTopThreshold
            && Math.abs(sample - stats.previous) <= 1e-7) {
            stats.repeatedAtRail += 1;
          } else {
            if (stats.repeatedAtRail + 1 >= options.flatTopMinimumSamples) {
              stats.flatRuns += 1;
              stats.flatSamples += stats.repeatedAtRail + 1;
              if (flatTopEvents.length < options.maxMarkersPerKind) {
                flatTopEvents.push({
                  frame: Math.max(0, frameIndex - stats.repeatedAtRail),
                  timeSeconds: Math.max(0, frameIndex - stats.repeatedAtRail) / sampleRate,
                  channel,
                  samples: stats.repeatedAtRail + 1,
                });
              }
            }
            stats.repeatedAtRail = 0;
          }
        }
        stats.previous = sample;
        truePeak.push(channel, sample);

        const bin = Math.min(waveformBins - 1, Math.floor(frameIndex / framesPerWaveformBin));
        const envelope = waveform[channel];
        if (sample < envelope.min[bin]) envelope.min[bin] = sample;
        if (sample > envelope.max[bin]) envelope.max[bin] = sample;
        envelope.sumSquares[bin] += sample * sample;
        envelope.count[bin] += 1;

        const weighted = kFilters[channel].process(sample);
        stepKSum[channel] += weighted * weighted;
        stepRawSum[channel] += sample * sample;
        if (absolute > stepPeak) stepPeak = absolute;
      }

      zeroCollector.push(frameIndex, allZero && allFinite);
      overrangeCollector.push(frameIndex, anyOverrange);
      if (allFinite) {
        global.validFrames += 1;
        if (channels === 2) {
          const left = samples[0];
          const right = samples[1];
          const mid = (left + right) * 0.5;
          const side = (left - right) * 0.5;
          global.sumL += left;
          global.sumR += right;
          global.sumLR += left * right;
          global.sumL2 += left * left;
          global.sumR2 += right * right;
          global.midEnergy += mid * mid;
          global.sideEnergy += side * side;
          stepSumL += left;
          stepSumR += right;
          stepSumLR += left * right;
          stepSumL2 += left * left;
          stepSumR2 += right * right;
          stepMid += mid * mid;
          stepSide += side * side;
          stepValidStereoFrames += 1;
        }
      }
      stepCount += 1;
      if (stepCount >= stepFrames) finishStep(true);
      frameIndex += 1;
    }
    consumedBytes += blockFrames * blockAlign;
    onProgress({
      phase: "analysis",
      fraction: consumedBytes / header.dataBytes,
      message: `Analyserar ljud ${(100 * consumedBytes / header.dataBytes).toFixed(0)} %`,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  finishStep(false);
  truePeak.finish();

  for (const stats of channelStats) {
    if (stats.repeatedAtRail + 1 >= options.flatTopMinimumSamples) {
      stats.flatRuns += 1;
      stats.flatSamples += stats.repeatedAtRail + 1;
    }
  }
  const zeroRegionCollection = zeroCollector.finish(frameCount);
  const overrangeRegionCollection = overrangeCollector.finish(frameCount);
  const zeroRegions = frameRegionsToSeconds(zeroRegionCollection.regions, sampleRate);
  const overrangeRegions = frameRegionsToSeconds(overrangeRegionCollection.regions, sampleRate);

  onProgress({ phase: "statistics", fraction: 0.96, message: "Beräknar loudness och observationer" });
  const momentaryEnergies = new Array(loudnessStepEnergies.length);
  const shortTermEnergies = new Array(loudnessStepEnergies.length);
  const momentarySteps = Math.max(1, Math.round(0.4 / options.timelineStepSeconds));
  const shortTermSteps = Math.max(1, Math.round(3 / options.timelineStepSeconds));
  rollingWindowEnergy(loudnessStepEnergies, momentarySteps, momentaryEnergies);
  rollingWindowEnergy(loudnessStepEnergies, shortTermSteps, shortTermEnergies);
  const momentaryLufs = momentaryEnergies.map((value) => value === null ? null : energyToLufs(value));
  const shortTermLufs = shortTermEnergies.map((value) => value === null ? null : energyToLufs(value));
  const integratedLufs = calculateIntegratedLufs(momentaryEnergies.filter((value) => value !== null));
  const loudnessRangeLu = calculateLoudnessRange(shortTermEnergies.filter((value) => value !== null));
  const runningIntegratedLufs = new Array(loudnessStepEnergies.length).fill(null);
  const completeMomentary = momentaryEnergies.filter((value) => value !== null);
  let latestIntegrated = null;
  for (let index = 0; index < runningIntegratedLufs.length; index += 1) {
    const completeIndex = index - (momentarySteps - 1);
    if (completeIndex >= 0 && (completeIndex % 10 === 0 || index === runningIntegratedLufs.length - 1)) {
      latestIntegrated = calculateIntegratedLufs(completeMomentary, completeIndex + 1);
    }
    runningIntegratedLufs[index] = latestIntegrated;
  }

  const channelResults = channelStats.map((stats, channel) => {
    const validSamples = frameCount - stats.nonFiniteSamples;
    const rms = validSamples > 0 ? Math.sqrt(stats.sumSquares / validSamples) : null;
    return {
      channel: channel + 1,
      samplePeak: stats.peak,
      samplePeakDbfs: finiteDb(stats.peak),
      samplePeakTimeSeconds: stats.peakFrame / sampleRate,
      truePeakEstimate: truePeak.peaks[channel],
      truePeakEstimateDbtp: finiteDb(truePeak.peaks[channel]),
      rms,
      rmsDbfs: rms === null ? null : finiteDb(rms),
      crestFactorDb: rms > 0 ? 20 * Math.log10(stats.peak / rms) : null,
      dcOffset: validSamples > 0 ? stats.sum / validSamples : null,
      maximum: stats.maximum === -Infinity ? null : stats.maximum,
      minimum: stats.minimum === Infinity ? null : stats.minimum,
      zeroSamples: stats.zeroSamples,
      overrangeSamples: stats.overrangeSamples,
      nonFiniteSamples: stats.nonFiniteSamples,
      flatTopRuns: stats.flatRuns,
      flatTopSamples: stats.flatSamples,
      maximumAdjacentDelta: stats.maxDelta,
    };
  });

  let correlation = null;
  let channelBalanceDb = null;
  let midSideRatioDb = null;
  if (channels === 2 && global.validFrames > 0) {
    const covariance = global.sumLR - global.sumL * global.sumR / global.validFrames;
    const varianceL = global.sumL2 - global.sumL * global.sumL / global.validFrames;
    const varianceR = global.sumR2 - global.sumR * global.sumR / global.validFrames;
    const denominator = Math.sqrt(Math.max(0, varianceL * varianceR));
    correlation = denominator > 0 ? Math.max(-1, Math.min(1, covariance / denominator)) : null;
    channelBalanceDb = global.sumR2 > 0 ? 10 * Math.log10(global.sumL2 / global.sumR2) : null;
    midSideRatioDb = global.sideEnergy > 0 ? 10 * Math.log10(global.midEnergy / global.sideEnergy) : null;
  }

  const lowLevelThresholdEnergy = 10 ** (options.lowLevelThresholdDbfs / 10);
  const minimumLowSteps = Math.max(1, Math.ceil(options.lowLevelMinimumSeconds / options.timelineStepSeconds));
  const lowRegions = [];
  let lowStart = null;
  rawStepEnergies.forEach((value, index) => {
    if (value <= lowLevelThresholdEnergy && lowStart === null) lowStart = index;
    if (value > lowLevelThresholdEnergy && lowStart !== null) {
      if (index - lowStart >= minimumLowSteps) lowRegions.push([lowStart, index]);
      lowStart = null;
    }
  });
  if (lowStart !== null && rawStepEnergies.length - lowStart >= minimumLowSteps) {
    lowRegions.push([lowStart, rawStepEnergies.length]);
  }
  const lowLevelRegions = lowRegions.slice(0, 50).map(([start, end]) => ({
    startSeconds: start * options.timelineStepSeconds,
    endSeconds: Math.min(header.durationSeconds, end * options.timelineStepSeconds),
    durationSeconds: (end - start) * options.timelineStepSeconds,
    thresholdDbfs: options.lowLevelThresholdDbfs,
  }));

  const highestSamplePeak = Math.max(...channelResults.map((channel) => channel.samplePeak));
  const highestTruePeak = Math.max(...channelResults.map((channel) => channel.truePeakEstimate));
  const combinedRms = Math.sqrt(channelResults.reduce(
    (sum, channel) => sum + (channel.rms ?? 0) ** 2,
    0,
  ) / channels);
  const observations = buildObservations({
    format: header,
    channelResults,
    global,
    zeroRegions,
    overrangeRegions,
    zeroRegionCount: zeroRegionCollection.count,
    overrangeRegionCount: overrangeRegionCollection.count,
    discontinuities,
    discontinuityCount,
    lowLevelRegions,
    flatTopCount: channelResults.reduce((sum, item) => sum + item.flatTopRuns, 0),
    integratedLufs,
    loudnessRangeLu,
  });
  const timeSeconds = loudnessStepEnergies.map((_, index) => Math.min(
    header.durationSeconds,
    (index + 1) * options.timelineStepSeconds,
  ));
  const momentaryMaximum = maxFiniteEntry(momentaryLufs);
  const shortTermMaximum = maxFiniteEntry(shortTermLufs);
  const importantMarkers = suggestedMarkers(
    discontinuities,
    flatTopEvents,
    zeroRegions,
    overrangeRegions,
    options.maxMarkersPerKind,
  );
  for (const channel of channelResults) {
    if (Number.isFinite(channel.samplePeakDbfs)) {
      importantMarkers.push({
        timeSeconds: channel.samplePeakTimeSeconds,
        type: "technical",
        severity: "info",
        label: `Högsta sample peak, kanal ${channel.channel}`,
        detail: `${channel.samplePeakDbfs.toFixed(2)} dBFS.`,
      });
    }
  }
  if (momentaryMaximum.index !== null) {
    importantMarkers.push({
      timeSeconds: timeSeconds[momentaryMaximum.index],
      type: "technical",
      severity: "info",
      label: "Högsta Momentary loudness",
      detail: `${momentaryMaximum.value.toFixed(2)} LUFS, fönstret slutar vid denna tid.`,
    });
  }
  if (shortTermMaximum.index !== null) {
    importantMarkers.push({
      timeSeconds: timeSeconds[shortTermMaximum.index],
      type: "technical",
      severity: "info",
      label: "Högsta Short-term loudness",
      detail: `${shortTermMaximum.value.toFixed(2)} LUFS, fönstret slutar vid denna tid.`,
    });
  }
  importantMarkers.sort((left, right) => left.timeSeconds - right.timeSeconds);

  const result = {
    format: {
      fileName: blob.name || "Namnlös WAVE-fil",
      fileSizeBytes: blob.size,
      container: header.container,
      encoding: header.encoding,
      channels,
      sampleRate,
      bitsPerSample,
      validBitsPerSample: header.validBitsPerSample,
      blockAlign,
      dataBytes: header.dataBytes,
      frameCount,
      durationSeconds: header.durationSeconds,
      extensible: header.extensible,
      truncated: header.truncated,
    },
    duration: header.durationSeconds,
    summary: {
      integratedLufs,
      loudnessRangeLu,
      momentaryMaxLufs: momentaryMaximum.value,
      momentaryMaxTimeSeconds: momentaryMaximum.index === null ? null : timeSeconds[momentaryMaximum.index],
      shortTermMaxLufs: shortTermMaximum.value,
      shortTermMaxTimeSeconds: shortTermMaximum.index === null ? null : timeSeconds[shortTermMaximum.index],
      samplePeak: highestSamplePeak,
      samplePeakDbfs: finiteDb(highestSamplePeak),
      truePeakEstimate: highestTruePeak,
      truePeakEstimateDbtp: finiteDb(highestTruePeak),
      plrEstimateLu: integratedLufs === null || !Number.isFinite(highestTruePeak)
        ? null
        : finiteDb(highestTruePeak) - integratedLufs,
      rms: combinedRms,
      rmsDbfs: finiteDb(combinedRms),
      crestFactorDb: combinedRms > 0 ? 20 * Math.log10(highestSamplePeak / combinedRms) : null,
      channelBalanceDb,
      correlation,
      midSideRatioDb,
      overrangeSamples: channelResults.reduce((sum, item) => sum + item.overrangeSamples, 0),
      nonFiniteSamples: channelResults.reduce((sum, item) => sum + item.nonFiniteSamples, 0),
      channels: channelResults,
    },
    waveform: {
      bins: waveformBins,
      framesPerBin: framesPerWaveformBin,
      channels: waveform.map((channel) => ({
        min: Array.from(channel.min, (value) => value === Infinity ? 0 : value),
        max: Array.from(channel.max, (value) => value === -Infinity ? 0 : value),
        rms: Array.from(channel.sumSquares, (value, index) => channel.count[index]
          ? Math.sqrt(value / channel.count[index]) : 0),
      })),
    },
    timelines: {
      intervalSeconds: options.timelineStepSeconds,
      timeSeconds,
      momentaryLufs,
      shortTermLufs,
      integratedLufs: runningIntegratedLufs,
      rmsDbfs: rawStepEnergies.map((value) => finiteDb(Math.sqrt(value))),
      samplePeakDbfs: stepSamplePeaks.map(finiteDb),
      channelRmsDbfs: channelStepEnergies.map((series) => series.map((value) => finiteDb(Math.sqrt(value)))),
      channelBalanceDb: channels === 2 ? stepBalance : [],
      correlation: channels === 2 ? stepCorrelation : [],
      midSideRatioDb: channels === 2 ? stepMidSideRatio : [],
    },
    observations,
    markersSuggested: importantMarkers,
    analysisSettings: {
      lowLevelThresholdDbfs: options.lowLevelThresholdDbfs,
      discontinuityThreshold: options.discontinuityThreshold,
      flatTopThreshold: options.flatTopThreshold,
    },
    validation: {
      engineVersion: ENGINE_VERSION,
      loudnessModel: "ITU-R BS.1770-5 och EBU Tech 3341/3342",
      loudnessStatus: "Beräkningsmodellen är implementerad. Officiell EBU-testsvit återstår innan den kallas compliance-validerad.",
      truePeakMethod: `${truePeak.factor}x kubisk intersample-estimering`,
      truePeakValidationStatus: TRUE_PEAK_ORIENTATION.status,
      truePeakStatus: "Försiktig orienteringsmätning, inte en standardvaliderad dBTP-mätare.",
      lraStatus: header.durationSeconds < 60
        ? "Beräknad enligt gatingmodellen men statistiskt instabil för material under 60 sekunder."
        : "Beräknad enligt EBU Tech 3342-modellen. Officiell testsvit återstår.",
      immutableSource: true,
    },
  };
  onProgress({ phase: "complete", fraction: 1, message: "Analysen är klar" });
  return result;
}
