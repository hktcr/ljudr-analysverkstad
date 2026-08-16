/*
 * LjudR Analysverkstad, lokal DSP-kärna.
 *
 * Motorn läser WAVE-data i block och behåller aldrig hela ljudfilen i minnet.
 * Ljudfilen ändras inte. Mätvärdena är avsedda som sakliga beslutsunderlag.
 */

import { decodeSampleAt, inspectWav, parseWavHeader as parseSharedWavHeader } from "./wav.js";
import { sha256Blob } from "./sha256.js";
import { localGainFactorAtFrame, normalizeLocalGainRegions } from "./local-gain.js";

export const ENGINE_VERSION = "1.0.0-rc.18";

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

export async function parseWavHeader(blob) {
  return parseSharedWavHeader(blob);
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
  status: "ebu-minimum-requirements-validated",
  statement: "Polyfas FIR-oversampling som klarar EBU Tech 3341:s officiella minimum requirements för True Peak.",
});

const sinc = value => Math.abs(value) < 1e-12
  ? 1
  : Math.sin(Math.PI * value) / (Math.PI * value);

// 49 taps sinc med Hanningfönster och polyfasindelning. Strukturen följer
// den MIT-licensierade libebur128-motorns etablerade True Peak-interpolator.
const createTruePeakPhases = (factor, taps) => {
  const delay = Math.ceil(taps / factor);
  const phases = Array.from({ length: factor }, () => ({
    coefficients: [],
    indices: [],
  }));
  for (let tap = 0; tap < taps; tap += 1) {
    const centered = tap - (taps - 1) / 2;
    const coefficient = sinc(centered / factor)
      * 0.5 * (1 - Math.cos(2 * Math.PI * tap / (taps - 1)));
    if (Math.abs(coefficient) <= 1e-6) continue;
    const phase = tap % factor;
    phases[phase].coefficients.push(coefficient);
    phases[phase].indices.push(Math.floor(tap / factor));
  }
  return { delay, phases };
};

export class FirTruePeakEstimator {
  constructor(channels, sampleRate) {
    this.sampleRate = sampleRate;
    this.factor = sampleRate >= 192000 ? 1 : sampleRate >= 96000 ? 2 : 4;
    this.tapCount = this.factor === 1 ? 1 : 49;
    const interpolation = createTruePeakPhases(this.factor, this.tapCount);
    this.delay = interpolation.delay;
    this.phases = interpolation.phases;
    this.states = Array.from({ length: channels }, () => {
      const buffer = new Float64Array(this.delay);
      return {
        buffer,
        writePosition: 0,
        finished: false,
      };
    });
    this.peaks = new Float64Array(channels);
    this.peakFrames = new Float64Array(channels).fill(Number.NaN);
    this.framesSeen = new Uint32Array(channels);
    this.groupDelayFrames = this.factor === 1 ? 0 : (this.tapCount - 1) / (2 * this.factor);
  }

  process(channel, sample, includeSamplePeak = true, frame = this.framesSeen[channel]) {
    const state = this.states[channel];
    if (includeSamplePeak) {
      const absolute = Math.abs(sample);
      if (absolute > this.peaks[channel]) {
        this.peaks[channel] = absolute;
        this.peakFrames[channel] = frame;
      }
    }
    if (this.factor === 1) return;
    state.buffer[state.writePosition] = sample;
    for (let phaseIndex = 0; phaseIndex < this.phases.length; phaseIndex += 1) {
      const phase = this.phases[phaseIndex];
      let estimate = 0;
      for (let tap = 0; tap < phase.coefficients.length; tap += 1) {
        let position = state.writePosition - phase.indices[tap];
        if (position < 0) position += this.delay;
        estimate += state.buffer[position] * phase.coefficients[tap];
      }
      const candidate = Math.abs(estimate);
      if (candidate > this.peaks[channel]) {
        this.peaks[channel] = candidate;
        this.peakFrames[channel] = frame - this.groupDelayFrames + phaseIndex / this.factor;
      }
    }
    state.writePosition += 1;
    if (state.writePosition === this.delay) state.writePosition = 0;
  }

  push(channel, sample) {
    const frame = this.framesSeen[channel];
    this.process(channel, sample, true, frame);
    this.framesSeen[channel] += 1;
  }

  finish() {
    for (let channel = 0; channel < this.states.length; channel += 1) {
      const state = this.states[channel];
      if (state.finished) continue;
      for (let index = 0; index < this.delay; index += 1) {
        this.process(channel, 0, false, this.framesSeen[channel] + index);
      }
      state.finished = true;
    }
  }

  peakTimeSeconds(channel, maximumFrames = Infinity) {
    const frame = this.peakFrames[channel];
    if (!Number.isFinite(frame)) return null;
    return Math.min(maximumFrames, Math.max(0, frame)) / this.sampleRate;
  }
}

function decodeSample(view, offset, format) {
  return decodeSampleAt(view, offset, format);
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
  return regions.map(([start, end]) => ({
    startSeconds: start / sampleRate,
    endSeconds: end / sampleRate,
    durationSeconds: (end - start) / sampleRate,
  })).sort((left, right) => right.durationSeconds - left.durationSeconds)
    .slice(0, limit)
    .sort((left, right) => left.startSeconds - right.startSeconds);
}

function retainLargest(items, item, score, limit) {
  if (items.length < limit) {
    items.push(item);
    return;
  }
  let smallestIndex = 0;
  let smallestScore = score(items[0]);
  for (let index = 1; index < items.length; index += 1) {
    const candidate = score(items[index]);
    if (candidate < smallestScore) {
      smallestScore = candidate;
      smallestIndex = index;
    }
  }
  if (score(item) > smallestScore) items[smallestIndex] = item;
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
    invalidRegions, flatTopCount, integratedLufs, loudnessRangeLu } = context;
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
      `${nonFinite} sampel innehåller NaN eller oändlighet. De utesluts ur rå statistik och ersätts med digital noll i loudness- och toppfiltren.`, true,
      invalidRegions,
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

const markerBase = (id, severity, objective, heuristic, detail) => ({
  id,
  type: "technical",
  severity,
  objective,
  heuristic,
  detail,
  origin: "analysis",
  reviewStatus: "unreviewed",
});

function suggestedMarkers(discontinuities, flatTopEvents, zeroRegions, overrangeRegions, invalidRegions, limit) {
  const markers = [];
  for (const item of [...discontinuities].sort((left, right) => right.delta - left.delta).slice(0, limit)) {
    markers.push({
      ...markerBase(`discontinuity-${item.channel}-${item.frame}`, "review", false, true,
        `Skillnad ${item.delta.toFixed(3)} i kanal ${item.channel + 1}.`),
      timeSeconds: item.timeSeconds,
      startSeconds: item.timeSeconds,
      endSeconds: item.timeSeconds,
      channel: item.channel + 1,
      label: "Snabbt nivåsprång",
    });
  }
  for (const item of [...flatTopEvents].sort((left, right) => right.samples - left.samples).slice(0, limit)) {
    markers.push({
      ...markerBase(`flat-top-${item.channel}-${item.frame}`, "review", false, true,
        `Sekvens nära full skala i kanal ${item.channel + 1}.`),
      timeSeconds: item.timeSeconds,
      startSeconds: item.timeSeconds,
      endSeconds: item.endSeconds ?? item.timeSeconds,
      channel: item.channel + 1,
      label: "Möjlig platå",
    });
  }
  for (const [index, item] of [...zeroRegions].sort((left, right) => right.durationSeconds - left.durationSeconds).slice(0, limit).entries()) {
    markers.push({
      ...markerBase(`digital-zero-${index}-${Math.round(item.startSeconds * 1000)}`, "info", true, false,
        `${item.durationSeconds.toFixed(3)} sekunder.`),
      timeSeconds: item.startSeconds,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      channel: null,
      label: "Digital noll",
    });
  }
  for (const [index, item] of [...overrangeRegions].sort((left, right) => right.durationSeconds - left.durationSeconds).slice(0, limit).entries()) {
    markers.push({
      ...markerBase(`overrange-${index}-${Math.round(item.startSeconds * 1000)}`, "review", true, false,
        `${item.durationSeconds.toFixed(3)} sekunder med minst ett floatvärde över 1,0.`),
      timeSeconds: item.startSeconds,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      channel: null,
      label: "Över full skala",
    });
  }
  for (const [index, item] of [...invalidRegions]
    .sort((left, right) => right.durationSeconds - left.durationSeconds)
    .slice(0, limit).entries()) {
    markers.push({
      ...markerBase(`invalid-${item.channel}-${index}-${Math.round(item.startSeconds * 1000)}`, "critical", true, false,
        `NaN eller Infinity i kanal ${item.channel}.`),
      timeSeconds: item.startSeconds,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      channel: item.channel,
      label: "Ogiltigt floatvärde",
    });
  }
  return markers.sort((left, right) => left.timeSeconds - right.timeSeconds);
}

export async function analyzeWav(blob, suppliedOptions = {}, onProgress = () => {}) {
  const options = { ...DEFAULTS, ...suppliedOptions };
  onProgress({ phase: "header", fraction: 0, message: "Läser filhuvud" });
  const sourceHeader = await parseWavHeader(blob);
  const sourceFrameCount = sourceHeader.frameCount;
  const analysisStartFrame = Math.min(sourceFrameCount, Math.max(0, Math.round(Number(options.startFrame) || 0)));
  const analysisEndFrame = Math.min(sourceFrameCount, Math.max(
    analysisStartFrame,
    Math.round(Number(options.endFrame ?? sourceFrameCount) || 0),
  ));
  if (analysisEndFrame <= analysisStartFrame) throw new Error("Analysregionen innehåller inga ljudbildrutor.");
  const selectedFrames = analysisEndFrame - analysisStartFrame;
  const fadeInFrames = Math.min(selectedFrames, Math.max(0, Math.round(Number(options.fadeInFrames) || 0)));
  const fadeOutFrames = Math.min(selectedFrames, Math.max(0, Math.round(Number(options.fadeOutFrames) || 0)));
  const globalGainDb = Number(options.globalGainDb ?? 0);
  if (!Number.isFinite(globalGainDb) || globalGainDb < -60 || globalGainDb > 24) {
    throw new Error("Global gain måste vara ett ändligt värde mellan -60 och +24 dB.");
  }
  const globalGain = 10 ** (globalGainDb / 20);
  const localGainRegions = normalizeLocalGainRegions(options.localGainRegions || [], sourceFrameCount);
  const regionFade = frame => {
    let factor = 1;
    if (fadeInFrames > 0 && frame < fadeInFrames) {
      factor = Math.min(factor, fadeInFrames === 1 ? 0 : frame / (fadeInFrames - 1));
    }
    const fromEnd = selectedFrames - 1 - frame;
    if (fadeOutFrames > 0 && fromEnd < fadeOutFrames) {
      factor = Math.min(factor, fadeOutFrames === 1 ? 0 : fromEnd / (fadeOutFrames - 1));
    }
    return factor;
  };
  const header = {
    ...sourceHeader,
    frameCount: selectedFrames,
    dataBytes: selectedFrames * sourceHeader.blockAlign,
    durationSeconds: selectedFrames / sourceHeader.sampleRate,
  };
  const { channels, sampleRate, blockAlign, bitsPerSample, frameCount } = header;
  const bytesPerSample = bitsPerSample / 8;
  const channelStats = Array.from({ length: channels }, createChannelStats);
  const kFilters = Array.from({ length: channels }, () => new KWeightingFilter(sampleRate));
  const truePeak = new FirTruePeakEstimator(channels, sampleRate);

  const waveformBins = Math.max(64, Math.min(options.waveformBins, frameCount));
  const framesPerWaveformBin = Math.max(1, Math.ceil(frameCount / waveformBins));
  const waveform = Array.from({ length: channels }, () => ({
    min: new Float32Array(waveformBins).fill(Infinity),
    max: new Float32Array(waveformBins).fill(-Infinity),
    sumSquares: new Float64Array(waveformBins),
    count: new Uint32Array(waveformBins),
  }));

  const stepFrames = Math.max(1, Math.round(sampleRate * options.timelineStepSeconds));
  const maximumStepSeconds = 0.01;
  const maximumStepFrames = Math.max(1, Math.round(sampleRate * maximumStepSeconds));
  const loudnessStepEnergies = [];
  const maximumStepEnergies = [];
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
  let maximumStepKSum = 0;
  let maximumStepCount = 0;

  const global = {
    validFrames: 0,
    sumL: 0,
    sumR: 0,
    sumLR: 0,
    sumL2: 0,
    sumR2: 0,
    midEnergy: 0,
    sideEnergy: 0,
    monoEnergy: 0,
    monoPeak: 0,
    monoPeakFrame: 0,
  };
  const zeroCollector = regionCollector(Math.round(sampleRate * options.zeroMinimumSeconds));
  const overrangeCollector = regionCollector(1);
  const invalidCollectors = Array.from({ length: channels }, () => regionCollector(1));
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

  function finishMaximumStep(complete = true) {
    if (!maximumStepCount) return;
    maximumStepEnergies.push(complete ? maximumStepKSum / maximumStepCount : null);
    maximumStepKSum = 0;
    maximumStepCount = 0;
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
    const bytes = await readBytes(
      blob,
      sourceHeader.dataOffset + analysisStartFrame * blockAlign + consumedBytes,
      length,
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const blockFrames = Math.floor(bytes.byteLength / blockAlign);
    for (let localFrame = 0; localFrame < blockFrames; localFrame += 1) {
      let allFinite = true;
      let allZero = true;
      let anyOverrange = false;
      for (let channel = 0; channel < channels; channel += 1) {
        const byteOffset = localFrame * blockAlign + channel * bytesPerSample;
        const decoded = decodeSample(view, byteOffset, header);
        const localGain = localGainFactorAtFrame(localGainRegions, analysisStartFrame + frameIndex);
        const sample = Number.isFinite(decoded) ? decoded * globalGain * regionFade(frameIndex) * localGain : decoded;
        invalidCollectors[channel].push(frameIndex, !Number.isFinite(sample));
        samples[channel] = sample;
        const stats = channelStats[channel];
        if (!Number.isFinite(sample)) {
          stats.nonFiniteSamples += 1;
          allFinite = false;
          allZero = false;
          truePeak.push(channel, 0);
          const weighted = kFilters[channel].process(0);
          stepKSum[channel] += weighted * weighted;
          maximumStepKSum += weighted * weighted;
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
            retainLargest(
              discontinuities,
              { frame: frameIndex, timeSeconds: frameIndex / sampleRate, channel, delta },
              item => item.delta,
              options.maxMarkersPerKind,
            );
          }
          if (absolute >= options.flatTopThreshold
            && Math.abs(sample - stats.previous) <= 1e-7) {
            stats.repeatedAtRail += 1;
          } else {
            if (stats.repeatedAtRail + 1 >= options.flatTopMinimumSamples) {
              stats.flatRuns += 1;
              stats.flatSamples += stats.repeatedAtRail + 1;
              retainLargest(flatTopEvents, {
                frame: Math.max(0, frameIndex - stats.repeatedAtRail),
                timeSeconds: Math.max(0, frameIndex - stats.repeatedAtRail) / sampleRate,
                endSeconds: frameIndex / sampleRate,
                channel,
                samples: stats.repeatedAtRail + 1,
              }, item => item.samples, options.maxMarkersPerKind);
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
        maximumStepKSum += weighted * weighted;
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
          global.monoEnergy += mid * mid;
          if (Math.abs(mid) > global.monoPeak) {
            global.monoPeak = Math.abs(mid);
            global.monoPeakFrame = frameIndex;
          }
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
      maximumStepCount += 1;
      if (stepCount >= stepFrames) finishStep(true);
      if (maximumStepCount >= maximumStepFrames) finishMaximumStep(true);
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
  finishMaximumStep(false);
  truePeak.finish();

  for (const [channel, stats] of channelStats.entries()) {
    if (stats.repeatedAtRail + 1 >= options.flatTopMinimumSamples) {
      stats.flatRuns += 1;
      stats.flatSamples += stats.repeatedAtRail + 1;
      retainLargest(flatTopEvents, {
        frame: Math.max(0, frameCount - stats.repeatedAtRail - 1),
        timeSeconds: Math.max(0, frameCount - stats.repeatedAtRail - 1) / sampleRate,
        endSeconds: frameCount / sampleRate,
        channel,
        samples: stats.repeatedAtRail + 1,
      }, item => item.samples, options.maxMarkersPerKind);
    }
  }
  const zeroRegionCollection = zeroCollector.finish(frameCount);
  const overrangeRegionCollection = overrangeCollector.finish(frameCount);
  const zeroRegions = frameRegionsToSeconds(zeroRegionCollection.regions, sampleRate);
  const overrangeRegions = frameRegionsToSeconds(overrangeRegionCollection.regions, sampleRate);
  const invalidRegions = invalidCollectors.flatMap((collector, channel) => {
    const collection = collector.finish(frameCount);
    return frameRegionsToSeconds(collection.regions, sampleRate, 1000).map(region => ({ ...region, channel: channel + 1 }));
  }).sort((left, right) => left.startSeconds - right.startSeconds);

  onProgress({ phase: "statistics", fraction: 0.96, message: "Beräknar loudness och observationer" });
  const momentaryEnergies = new Array(loudnessStepEnergies.length);
  const shortTermEnergies = new Array(loudnessStepEnergies.length);
  const momentarySteps = Math.max(1, Math.round(0.4 / options.timelineStepSeconds));
  const shortTermSteps = Math.max(1, Math.round(3 / options.timelineStepSeconds));
  rollingWindowEnergy(loudnessStepEnergies, momentarySteps, momentaryEnergies);
  rollingWindowEnergy(loudnessStepEnergies, shortTermSteps, shortTermEnergies);
  const momentaryLufs = momentaryEnergies.map((value) => value === null ? null : energyToLufs(value));
  const shortTermLufs = shortTermEnergies.map((value) => value === null ? null : energyToLufs(value));
  const maximumMomentaryEnergies = new Array(maximumStepEnergies.length);
  const maximumShortTermEnergies = new Array(maximumStepEnergies.length);
  rollingWindowEnergy(maximumStepEnergies, Math.max(1, Math.round(0.4 / maximumStepSeconds)), maximumMomentaryEnergies);
  rollingWindowEnergy(maximumStepEnergies, Math.max(1, Math.round(3 / maximumStepSeconds)), maximumShortTermEnergies);
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
      truePeakTimeSeconds: truePeak.peakTimeSeconds(channel, Math.max(0, frameCount - 1)),
      truePeakSourceTimeSeconds: truePeak.peakTimeSeconds(channel, Math.max(0, frameCount - 1)) === null
        ? null
        : analysisStartFrame / sampleRate + truePeak.peakTimeSeconds(channel, Math.max(0, frameCount - 1)),
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
  let monoEnergyDeltaDb = null;
  if (channels === 2 && global.validFrames > 0) {
    const covariance = global.sumLR - global.sumL * global.sumR / global.validFrames;
    const varianceL = global.sumL2 - global.sumL * global.sumL / global.validFrames;
    const varianceR = global.sumR2 - global.sumR * global.sumR / global.validFrames;
    const denominator = Math.sqrt(Math.max(0, varianceL * varianceR));
    correlation = denominator > 0 ? Math.max(-1, Math.min(1, covariance / denominator)) : null;
    channelBalanceDb = global.sumR2 > 0 ? 10 * Math.log10(global.sumL2 / global.sumR2) : null;
    midSideRatioDb = global.sideEnergy > 0 ? 10 * Math.log10(global.midEnergy / global.sideEnergy) : null;
    const stereoReferenceEnergy = (global.sumL2 + global.sumR2) * 0.5;
    monoEnergyDeltaDb = stereoReferenceEnergy > 0
      ? (global.monoEnergy > 0 ? 10 * Math.log10(global.monoEnergy / stereoReferenceEnergy) : -300)
      : null;
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
  const highestTruePeakChannel = channelResults.reduce((best, channel) => (
    !best || channel.truePeakEstimate > best.truePeakEstimate ? channel : best
  ), null);
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
    invalidRegions,
    flatTopCount: channelResults.reduce((sum, item) => sum + item.flatTopRuns, 0),
    integratedLufs,
    loudnessRangeLu,
  });
  const timeSeconds = loudnessStepEnergies.map((_, index) => Math.min(
    header.durationSeconds,
    (index + 1) * options.timelineStepSeconds,
  ));
  const maximumMomentaryEnergy = maxFiniteEntry(maximumMomentaryEnergies);
  const maximumShortTermEnergy = maxFiniteEntry(maximumShortTermEnergies);
  const momentaryMaximum = {
    value: maximumMomentaryEnergy.value === null ? null : energyToLufs(maximumMomentaryEnergy.value),
    timeSeconds: maximumMomentaryEnergy.index === null
      ? null
      : Math.min(header.durationSeconds, (maximumMomentaryEnergy.index + 1) * maximumStepSeconds),
  };
  const shortTermMaximum = {
    value: maximumShortTermEnergy.value === null ? null : energyToLufs(maximumShortTermEnergy.value),
    timeSeconds: maximumShortTermEnergy.index === null
      ? null
      : Math.min(header.durationSeconds, (maximumShortTermEnergy.index + 1) * maximumStepSeconds),
  };
  const importantMarkers = suggestedMarkers(
    discontinuities,
    flatTopEvents,
    zeroRegions,
    overrangeRegions,
    invalidRegions,
    options.maxMarkersPerKind,
  );
  const negativeCorrelationRegions = [];
  if (channels === 2) {
    let negativeStart = null;
    stepCorrelation.forEach((value, index) => {
      if (Number.isFinite(value) && value < -0.25 && negativeStart === null) negativeStart = index;
      if ((!Number.isFinite(value) || value >= -0.25) && negativeStart !== null) {
        if ((index - negativeStart) * options.timelineStepSeconds >= 1) negativeCorrelationRegions.push([negativeStart, index]);
        negativeStart = null;
      }
    });
    if (negativeStart !== null && (stepCorrelation.length - negativeStart) * options.timelineStepSeconds >= 1) negativeCorrelationRegions.push([negativeStart, stepCorrelation.length]);
    negativeCorrelationRegions.slice(0, options.maxMarkersPerKind).forEach(([start, end], index) => {
      importantMarkers.push({
        ...markerBase(`negative-correlation-${index}-${start}`, "review", true, false, "Stereokorrelationen ligger under -0,25 i minst en sekund. Provlyssna mono fold-down."),
        machineKind: "negative-stereo-correlation",
        timeSeconds: start * options.timelineStepSeconds,
        startSeconds: start * options.timelineStepSeconds,
        endSeconds: Math.min(header.durationSeconds, end * options.timelineStepSeconds),
        sourceTimeSeconds: analysisStartFrame / sampleRate + start * options.timelineStepSeconds,
        channel: null,
        label: "Varaktigt negativ stereokorrelation",
      });
    });
  }
  for (const channel of channelResults) {
    if (Number.isFinite(channel.samplePeakDbfs)) {
      importantMarkers.push({
        ...markerBase(`sample-peak-${channel.channel}-${Math.round(channel.samplePeakTimeSeconds * sampleRate)}`,
          "info", true, false, `${channel.samplePeakDbfs.toFixed(2)} dBFS.`),
        timeSeconds: channel.samplePeakTimeSeconds,
        startSeconds: channel.samplePeakTimeSeconds,
        endSeconds: channel.samplePeakTimeSeconds,
        sourceTimeSeconds: analysisStartFrame / sampleRate + channel.samplePeakTimeSeconds,
        channel: channel.channel,
        label: `Högsta sample peak, kanal ${channel.channel}`,
      });
    }
  }
  for (const channel of channelResults) {
    if (Number.isFinite(channel.truePeakEstimateDbtp) && channel.truePeakTimeSeconds !== null) {
      importantMarkers.push({
        ...markerBase(`true-peak-${channel.channel}-${Math.round(channel.truePeakTimeSeconds * sampleRate)}`,
          "info", true, false, `${channel.truePeakEstimateDbtp.toFixed(2)} dBTP i kanal ${channel.channel}.`),
        timeSeconds: channel.truePeakTimeSeconds,
        startSeconds: channel.truePeakTimeSeconds,
        endSeconds: channel.truePeakTimeSeconds,
        sourceTimeSeconds: channel.truePeakSourceTimeSeconds,
        channel: channel.channel,
        label: `Högsta True Peak, kanal ${channel.channel}`,
        timePrecisionSeconds: 1 / (truePeak.factor * sampleRate),
      });
    }
  }
  if (momentaryMaximum.timeSeconds !== null) {
    importantMarkers.push({
      ...markerBase(`momentary-max-${Math.round(momentaryMaximum.timeSeconds * sampleRate)}`,
        "info", true, false, `${momentaryMaximum.value.toFixed(2)} LUFS, fönstret slutar vid denna tid.`),
      timeSeconds: momentaryMaximum.timeSeconds,
      startSeconds: Math.max(0, momentaryMaximum.timeSeconds - 0.4),
      endSeconds: momentaryMaximum.timeSeconds,
      sourceTimeSeconds: analysisStartFrame / sampleRate + momentaryMaximum.timeSeconds,
      channel: null,
      label: "Högsta Momentary loudness",
    });
  }
  if (shortTermMaximum.timeSeconds !== null) {
    importantMarkers.push({
      ...markerBase(`short-term-max-${Math.round(shortTermMaximum.timeSeconds * sampleRate)}`,
        "info", true, false, `${shortTermMaximum.value.toFixed(2)} LUFS, fönstret slutar vid denna tid.`),
      timeSeconds: shortTermMaximum.timeSeconds,
      startSeconds: Math.max(0, shortTermMaximum.timeSeconds - 3),
      endSeconds: shortTermMaximum.timeSeconds,
      sourceTimeSeconds: analysisStartFrame / sampleRate + shortTermMaximum.timeSeconds,
      channel: null,
      label: "Högsta Short-term loudness",
    });
  }
  for (const marker of importantMarkers) {
    marker.startSeconds ??= marker.timeSeconds;
    marker.endSeconds ??= marker.timeSeconds;
    marker.sourceTimeSeconds ??= analysisStartFrame / sampleRate + marker.timeSeconds;
    marker.origin ??= "analysis";
    marker.reviewStatus ??= "unreviewed";
    marker.objective ??= true;
    marker.heuristic ??= false;
    marker.channel ??= null;
  }
  importantMarkers.sort((left, right) => left.timeSeconds - right.timeSeconds);

  let sourceIdentity = null;
  if (options.includeSourceHash !== false) {
    onProgress({ phase: "hash", fraction: 0, message: "Beräknar lokal SHA-256" });
    sourceIdentity = await sha256Blob(blob, { shouldCancel: options.shouldCancel }, progress => {
      onProgress({ phase: "hash", fraction: progress.fraction, message: `Beräknar lokal SHA-256 ${Math.round(progress.fraction * 100)} %` });
    });
  }

  const result = {
    sourceIdentity,
    region: {
      range: "[startFrame,endFrame)",
      startFrame: analysisStartFrame,
      endFrame: analysisEndFrame,
      selectedFrames,
      fadeInFrames,
      fadeOutFrames,
      globalGainDb,
      localGainRegions,
      localGainPolicy: "minimum-linked-envelope",
      preQuantization: true,
    },
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
      momentaryMaxTimeSeconds: momentaryMaximum.timeSeconds,
      shortTermMaxLufs: shortTermMaximum.value,
      shortTermMaxTimeSeconds: shortTermMaximum.timeSeconds,
      samplePeak: highestSamplePeak,
      samplePeakDbfs: finiteDb(highestSamplePeak),
      truePeakEstimate: highestTruePeak,
      truePeakEstimateDbtp: finiteDb(highestTruePeak),
      truePeakTimeSeconds: highestTruePeakChannel?.truePeakTimeSeconds ?? null,
      truePeakSourceTimeSeconds: highestTruePeakChannel?.truePeakSourceTimeSeconds ?? null,
      truePeakChannel: highestTruePeakChannel?.channel ?? null,
      plrEstimateLu: integratedLufs === null || !Number.isFinite(highestTruePeak)
        ? null
        : finiteDb(highestTruePeak) - integratedLufs,
      rms: combinedRms,
      rmsDbfs: finiteDb(combinedRms),
      crestFactorDb: combinedRms > 0 ? 20 * Math.log10(highestSamplePeak / combinedRms) : null,
      channelBalanceDb,
      correlation,
      midSideRatioDb,
      monoCompatibility: channels === 2 ? {
        energyDeltaDb: monoEnergyDeltaDb,
        samplePeakDbfs: finiteDb(global.monoPeak),
        samplePeakTimeSeconds: global.monoPeakFrame / sampleRate,
        negativeCorrelationPercent: stepCorrelation.filter(Number.isFinite).length
          ? 100 * stepCorrelation.filter(value => Number.isFinite(value) && value < -0.25).length / stepCorrelation.filter(Number.isFinite).length
          : null,
        negativeCorrelationRegions: negativeCorrelationRegions.map(([start, end]) => ({
          startSeconds: start * options.timelineStepSeconds,
          endSeconds: Math.min(header.durationSeconds, end * options.timelineStepSeconds),
        })),
        interpretation: "Orienterande mono fold-down. Ingen automatisk stereokorrigering.",
      } : null,
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
      loudnessStatus: "Filbaserad mono/stereo-loudness klarar relevanta officiella EBU- och ITU-testfall.",
      truePeakMethod: truePeak.factor === 1
        ? "Sample peak vid minst 192 kHz"
        : `${truePeak.factor}x polyfas FIR-oversampling med 49 tappar`,
      truePeakValidationStatus: TRUE_PEAK_ORIENTATION.status,
      truePeakStatus: "FIR-mätningen klarar EBU Tech 3341:s officiella True Peak-minimikrav. Detta är inte en certifiering eller leveransgaranti.",
      lraStatus: header.durationSeconds < 60
        ? "Beräknad enligt gatingmodellen men statistiskt instabil för material under 60 sekunder."
        : "Beräknad enligt EBU Tech 3342-modellen och verifierad mot dess relevanta officiella mono/stereo-testfall.",
      immutableSource: true,
    },
  };
  onProgress({ phase: "complete", fraction: 1, message: "Analysen är klar" });
  return result;
}

export async function analyzeRegion(blob, suppliedOptions = {}, onProgress = () => {}) {
  const inspected = await inspectWav(blob);
  const startFrame = Math.min(inspected.frameCount, Math.max(0, Math.round(Number(suppliedOptions.startFrame) || 0)));
  const endFrame = Math.min(inspected.frameCount, Math.max(
    startFrame,
    Math.round(Number(suppliedOptions.endFrame ?? inspected.frameCount) || 0),
  ));
  if (endFrame <= startFrame) throw new Error("Analysregionen innehåller inga ljudbildrutor.");
  const common = {
    ...suppliedOptions,
    startFrame,
    endFrame,
    includeSourceHash: false,
  };
  const source = await analyzeWav(blob, {
    ...common,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    globalGainDb: 0,
    localGainRegions: [],
  }, progress => onProgress({ ...progress, stage: "source", fraction: progress.fraction * 0.45 }));
  const processed = await analyzeWav(blob, common, progress => onProgress({
    ...progress,
    stage: "processed",
    fraction: 0.45 + progress.fraction * 0.55,
  }));
  return {
    range: { range: "[startFrame,endFrame)", startFrame, endFrame, selectedFrames: endFrame - startFrame },
    edit: {
      fadeInFrames: processed.region.fadeInFrames,
      fadeOutFrames: processed.region.fadeOutFrames,
      globalGainDb: processed.region.globalGainDb,
      localGainRegions: processed.region.localGainRegions,
      localGainPolicy: processed.region.localGainPolicy,
      dynamicProcessing: false,
      preQuantization: true,
    },
    source,
    processed,
  };
}

function goertzelRelativeDb(samples, sampleRate, frequency) {
  if (!samples.length) return null;
  const omega = 2 * Math.PI * frequency / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previousTwo = 0;
  let totalEnergy = 0;
  for (const sample of samples) {
    const next = sample + coefficient * previous - previousTwo;
    previousTwo = previous;
    previous = next;
    totalEnergy += sample * sample;
  }
  if (totalEnergy <= 0) return null;
  const tonePower = Math.max(0, previousTwo * previousTwo + previous * previous - coefficient * previous * previousTwo);
  const relative = tonePower / (samples.length * totalEnergy);
  return relative > 0 ? 10 * Math.log10(relative) : null;
}

const medianFinite = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function lowFrequencyWindowMetrics(channelSamples, sampleRate) {
  const channels = channelSamples.filter(samples => samples.length);
  if (!channels.length) return {
    subsonicEnergyPercent: null,
    lowFrequencyEnergyPercent: null,
    contentAbove120HzPercent: null,
    lowFrequencyStereoCorrelation: null,
  };
  const filtered = channels.map(samples => {
    const below20 = new Float64Array(samples.length);
    const below120 = new Float64Array(samples.length);
    const alpha20 = 1 - Math.exp(-2 * Math.PI * 20 / sampleRate);
    const alpha120 = 1 - Math.exp(-2 * Math.PI * 120 / sampleRate);
    let low20 = 0;
    let low120 = 0;
    let totalEnergy = 0;
    let subsonicEnergy = 0;
    let lowFrequencyEnergy = 0;
    let contentAbove120HzEnergy = 0;
    samples.forEach((sample, index) => {
      low20 += alpha20 * (sample - low20);
      low120 += alpha120 * (sample - low120);
      below20[index] = low20;
      below120[index] = low120;
      totalEnergy += sample * sample;
      subsonicEnergy += low20 * low20;
      lowFrequencyEnergy += low120 * low120;
      const upper = sample - low120;
      contentAbove120HzEnergy += upper * upper;
    });
    return { below20, below120, totalEnergy, subsonicEnergy, lowFrequencyEnergy, contentAbove120HzEnergy };
  });
  const totalEnergy = filtered.reduce((sum, item) => sum + item.totalEnergy, 0);
  const percent = value => totalEnergy > 0 ? Math.min(100, Math.max(0, 100 * value / totalEnergy)) : null;
  let lowFrequencyStereoCorrelation = null;
  if (filtered.length === 2) {
    const left = filtered[0].below120;
    const right = filtered[1].below120;
    let sumLeft = 0;
    let sumRight = 0;
    let sumLeftSquared = 0;
    let sumRightSquared = 0;
    let sumProducts = 0;
    const count = Math.min(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      sumLeft += left[index];
      sumRight += right[index];
      sumLeftSquared += left[index] * left[index];
      sumRightSquared += right[index] * right[index];
      sumProducts += left[index] * right[index];
    }
    const covariance = sumProducts - sumLeft * sumRight / Math.max(1, count);
    const leftVariance = sumLeftSquared - sumLeft * sumLeft / Math.max(1, count);
    const rightVariance = sumRightSquared - sumRight * sumRight / Math.max(1, count);
    const denominator = Math.sqrt(Math.max(0, leftVariance) * Math.max(0, rightVariance));
    if (denominator > 0) lowFrequencyStereoCorrelation = Math.min(1, Math.max(-1, covariance / denominator));
  }
  return {
    subsonicEnergyPercent: percent(filtered.reduce((sum, item) => sum + item.subsonicEnergy, 0)),
    lowFrequencyEnergyPercent: percent(filtered.reduce((sum, item) => sum + item.lowFrequencyEnergy, 0)),
    contentAbove120HzPercent: percent(filtered.reduce((sum, item) => sum + item.contentAbove120HzEnergy, 0)),
    lowFrequencyStereoCorrelation,
  };
}

function rumbleLikelihood(metrics) {
  const low = metrics.lowFrequencyEnergyPercent;
  const subsonic = metrics.subsonicEnergyPercent;
  const upper = metrics.contentAbove120HzPercent;
  if (![low, subsonic, upper].every(Number.isFinite)) return { key: "unknown", label: "Otillräcklig signal", score: 0 };
  let score = low >= 55 ? 3 : low >= 35 ? 2 : low >= 20 ? 1 : 0;
  score += subsonic >= 12 ? 2 : subsonic >= 4 ? 1 : 0;
  if (upper >= 45) score -= 1;
  if (Number.isFinite(metrics.lowFrequencyStereoCorrelation) && metrics.lowFrequencyStereoCorrelation < 0.35) score += 1;
  if (score >= 4) return { key: "elevated", label: "Förhöjd sannolikhet", score };
  if (score >= 2) return { key: "moderate", label: "Måttlig sannolikhet", score };
  return { key: "low", label: "Låg sannolikhet", score };
}

export async function analyzeSpectralDiagnostics(blob, suppliedOptions = {}, onProgress = () => {}) {
  const inspected = await inspectWav(blob);
  const { format } = inspected;
  const startFrame = Math.min(inspected.frameCount, Math.max(0, Math.floor(Number(suppliedOptions.startFrame) || 0)));
  const endFrame = Math.min(inspected.frameCount, Math.max(startFrame, Math.ceil(Number(suppliedOptions.endFrame ?? inspected.frameCount) || 0)));
  if (endFrame <= startFrame) throw new Error("Spektral diagnostik kräver ett ljudintervall.");
  const windowCount = Math.max(1, Math.min(12, Math.round(Number(suppliedOptions.windowCount) || 12)));
  const windowFrames = Math.max(1, Math.min(endFrame - startFrame, Math.round(format.sampleRate * 5)));
  const stride = Math.max(1, Math.floor(format.sampleRate / 4_000));
  const sampledRate = format.sampleRate / stride;
  const starts = [...new Set(Array.from({ length: windowCount }, (_, index) => {
    if (windowCount === 1) return startFrame;
    return Math.round(startFrame + (endFrame - startFrame - windowFrames) * index / (windowCount - 1));
  }))];
  const windows = [];
  const bytesPerSample = format.bitsPerSample / 8;
  for (let windowIndex = 0; windowIndex < starts.length; windowIndex += 1) {
    if (suppliedOptions.shouldCancel?.()) throw new DOMException("Spektral diagnostik avbröts.", "AbortError");
    const frameStart = starts[windowIndex];
    const frames = Math.min(windowFrames, endFrame - frameStart);
    const byteStart = inspected.data.dataOffset + frameStart * format.blockAlign;
    const bytes = new Uint8Array(await blob.slice(byteStart, byteStart + frames * format.blockAlign).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const channelSamples = Array.from({ length: format.channels }, () => []);
    const mono = [];
    for (let frame = 0; frame < frames; frame += stride) {
      const frameSamples = [];
      for (let channel = 0; channel < format.channels; channel += 1) {
        const sample = decodeSampleAt(view, frame * format.blockAlign + channel * bytesPerSample, format);
        frameSamples.push(sample);
      }
      if (frameSamples.every(Number.isFinite)) {
        frameSamples.forEach((sample, channel) => channelSamples[channel].push(sample));
        mono.push(frameSamples.reduce((sum, sample) => sum + sample, 0) / frameSamples.length);
      }
    }
    const lowMetrics = lowFrequencyWindowMetrics(channelSamples, sampledRate);
    const likelihood = rumbleLikelihood(lowMetrics);
    const harmonics = [50, 100, 150, 200].map(frequency => goertzelRelativeDb(mono, sampledRate, frequency));
    windows.push({
      startSeconds: frameStart / format.sampleRate,
      sampledSeconds: frames / format.sampleRate,
      ...lowMetrics,
      rumbleLikelihood: likelihood.key,
      rumbleLikelihoodLabel: likelihood.label,
      rumbleScore: likelihood.score,
      mainsHum50RelativeDb: harmonics[0],
      mainsHarmonicMaximumRelativeDb: harmonics.filter(Number.isFinite).length ? Math.max(...harmonics.filter(Number.isFinite)) : null,
    });
    onProgress({ phase: "spectral-diagnostics", fraction: (windowIndex + 1) / starts.length, message: `Spektral orientering ${windowIndex + 1} av ${starts.length}` });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const lowValues = windows.map(item => item.lowFrequencyEnergyPercent);
  const subsonicValues = windows.map(item => item.subsonicEnergyPercent);
  const upperValues = windows.map(item => item.contentAbove120HzPercent);
  const humValues = windows.map(item => item.mainsHum50RelativeDb);
  const reviewRegions = windows
    .filter(item => ["moderate", "elevated"].includes(item.rumbleLikelihood))
    .map(item => ({
      startSeconds: item.startSeconds,
      endSeconds: item.startSeconds + item.sampledSeconds,
      likelihood: item.rumbleLikelihood,
      likelihoodLabel: item.rumbleLikelihoodLabel,
      lowFrequencyEnergyPercent: item.lowFrequencyEnergyPercent,
      subsonicEnergyPercent: item.subsonicEnergyPercent,
      contentAbove120HzPercent: item.contentAbove120HzPercent,
      lowFrequencyStereoCorrelation: item.lowFrequencyStereoCorrelation,
    }));
  return {
    scope: "deterministic-sampled-windows",
    windowCount: windows.length,
    sampledSeconds: windows.reduce((sum, item) => sum + item.sampledSeconds, 0),
    lowFrequencyEnergyPercentMedian: medianFinite(lowValues),
    lowFrequencyEnergyPercentMaximum: lowValues.filter(Number.isFinite).length ? Math.max(...lowValues.filter(Number.isFinite)) : null,
    subsonicEnergyPercentMedian: medianFinite(subsonicValues),
    contentAbove120HzPercentMedian: medianFinite(upperValues),
    mainsHum50RelativeDbMedian: medianFinite(humValues),
    mainsHum50RelativeDbMaximum: humValues.filter(Number.isFinite).length ? Math.max(...humValues.filter(Number.isFinite)) : null,
    windows,
    reviewRegions,
    interpretation: "Försiktig, deterministiskt samplad screening av möjlig lågfrekvent störning. Innehåll över 120 Hz vägs in för att minska risken att naturligt vindljud i grenar misstolkas. Inte full spektralanalys, källidentifiering, felbesked eller EQ-rekommendation.",
  };
}

function fftMagnitudes(samples) {
  const size = samples.length;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, size - 1));
    real[index] = (Number.isFinite(samples[index]) ? samples[index] : 0) * window;
  }
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    while (reversed & bit) { reversed ^= bit; bit >>= 1; }
    reversed ^= bit;
    if (index < reversed) {
      const value = real[index]; real[index] = real[reversed]; real[reversed] = value;
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const even = offset + index;
        const odd = even + length / 2;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
  const magnitudes = new Float32Array(size / 2);
  const scale = 4 / size;
  for (let index = 0; index < magnitudes.length; index += 1) {
    magnitudes[index] = finiteDb(Math.hypot(real[index], imaginary[index]) * scale, -140);
  }
  return magnitudes;
}

export async function analyzeSpectrogram(blob, suppliedOptions = {}, onProgress = () => {}) {
  const inspected = await inspectWav(blob);
  const { format } = inspected;
  const startFrame = Math.min(inspected.frameCount, Math.max(0, Math.floor(Number(suppliedOptions.startFrame) || 0)));
  const endFrame = Math.min(inspected.frameCount, Math.max(startFrame, Math.ceil(Number(suppliedOptions.endFrame ?? inspected.frameCount) || 0)));
  if (endFrame <= startFrame) throw new Error("Spektrogrammet kräver ett ljudintervall.");
  const fftSizeCandidate = Math.round(Number(suppliedOptions.fftSize) || 4096);
  const fftSize = [1024, 2048, 4096, 8192].includes(fftSizeCandidate) ? fftSizeCandidate : 4096;
  const columns = Math.max(32, Math.min(512, Math.round(Number(suppliedOptions.columns) || 320)));
  const binCount = fftSize / 2;
  const floorDb = Math.max(-140, Math.min(-40, Number(suppliedOptions.floorDb) || -100));
  const channels = Math.min(2, format.channels);
  const channelData = Array.from({ length: channels }, () => new Uint8Array(columns * binCount));
  const bytesPerSample = format.bitsPerSample / 8;
  const selectedFrames = endFrame - startFrame;
  for (let column = 0; column < columns; column += 1) {
    if (suppliedOptions.shouldCancel?.()) throw new DOMException("Spektrogrammet avbröts.", "AbortError");
    const center = startFrame + Math.round(((column + 0.5) / columns) * selectedFrames);
    const frameStart = Math.max(startFrame, Math.min(endFrame - fftSize, center - Math.floor(fftSize / 2)));
    const readableFrames = Math.max(0, Math.min(fftSize, endFrame - frameStart));
    const byteStart = inspected.data.dataOffset + frameStart * format.blockAlign;
    const bytes = new Uint8Array(await blob.slice(byteStart, byteStart + readableFrames * format.blockAlign).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let channel = 0; channel < channels; channel += 1) {
      const samples = new Float64Array(fftSize);
      for (let frame = 0; frame < readableFrames; frame += 1) {
        samples[frame] = decodeSampleAt(view, frame * format.blockAlign + channel * bytesPerSample, format);
      }
      const magnitudes = fftMagnitudes(samples);
      const target = channelData[channel];
      for (let bin = 0; bin < binCount; bin += 1) {
        const normalized = Math.max(0, Math.min(1, (magnitudes[bin] - floorDb) / -floorDb));
        target[column * binCount + bin] = Math.round(normalized * 255);
      }
    }
    if (column % 4 === 0 || column === columns - 1) {
      onProgress({ phase: "spectrogram", fraction: (column + 1) / columns, message: `Bygger lokal frekvensbild ${column + 1} av ${columns}` });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return {
    scope: "local-visible-range",
    startSeconds: startFrame / format.sampleRate,
    endSeconds: endFrame / format.sampleRate,
    sampleRate: format.sampleRate,
    channels,
    columns,
    binCount,
    fftSize,
    frequencyResolutionHz: format.sampleRate / fftSize,
    timeResolutionSeconds: selectedFrames / format.sampleRate / columns,
    floorDb,
    windowFunction: "Hann",
    channelData,
  };
}

export async function analyzeWaveformDetail(blob, suppliedOptions = {}, onProgress = () => {}) {
  const inspected = await inspectWav(blob);
  const { format } = inspected;
  const startFrame = Math.min(inspected.frameCount, Math.max(0, Math.floor(Number(suppliedOptions.startFrame) || 0)));
  const endFrame = Math.min(inspected.frameCount, Math.max(
    startFrame,
    Math.ceil(Number(suppliedOptions.endFrame ?? inspected.frameCount) || 0),
  ));
  const selectedFrames = endFrame - startFrame;
  if (!selectedFrames) throw new Error("Detaljintervallet innehåller inga ljudbildrutor.");
  const pixelWidth = Math.max(1, Math.round(Number(suppliedOptions.pixelWidth) || 1));
  const maxBinDurationSeconds = Math.min(0.01, Math.max(
    1 / format.sampleRate,
    Number(suppliedOptions.maxBinDurationSeconds) || 0.01,
  ));
  const framesPerPixel = selectedFrames / pixelWidth;
  const framesPerBin = Math.max(1, Math.floor(Math.min(
    framesPerPixel,
    maxBinDurationSeconds * format.sampleRate,
  )));
  const binCount = Math.ceil(selectedFrames / framesPerBin);
  const includeSamples = suppliedOptions.includeSamples === true
    && selectedFrames <= Math.max(pixelWidth * 8, 65536);
  const channels = Array.from({ length: format.channels }, (_, channel) => ({
    channel: channel + 1,
    min: new Float32Array(binCount).fill(Infinity),
    max: new Float32Array(binCount).fill(-Infinity),
    sumSquares: new Float64Array(binCount),
    count: new Uint32Array(binCount),
    samples: includeSamples ? new Float64Array(selectedFrames) : null,
  }));
  const chunkFrames = Math.max(1, Math.floor((4 * 1024 * 1024) / format.blockAlign));
  let processedFrames = 0;
  while (processedFrames < selectedFrames) {
    if (suppliedOptions.shouldCancel?.()) throw new DOMException("Detaljanalysen avbröts.", "AbortError");
    const frames = Math.min(chunkFrames, selectedFrames - processedFrames);
    const byteStart = inspected.data.dataOffset + (startFrame + processedFrames) * format.blockAlign;
    const bytes = new Uint8Array(await blob.slice(byteStart, byteStart + frames * format.blockAlign).arrayBuffer());
    const decoded = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const bytesPerSample = format.bitsPerSample / 8;
    for (let frame = 0; frame < frames; frame += 1) {
      const relativeFrame = processedFrames + frame;
      const bin = Math.min(binCount - 1, Math.floor(relativeFrame / framesPerBin));
      for (let channel = 0; channel < format.channels; channel += 1) {
        const sample = decodeSampleAt(decoded, frame * format.blockAlign + channel * bytesPerSample, format);
        if (!Number.isFinite(sample)) continue;
        const target = channels[channel];
        if (sample < target.min[bin]) target.min[bin] = sample;
        if (sample > target.max[bin]) target.max[bin] = sample;
        target.sumSquares[bin] += sample * sample;
        target.count[bin] += 1;
        if (target.samples) target.samples[relativeFrame] = sample;
      }
    }
    processedFrames += frames;
    onProgress({
      phase: "waveform-detail",
      fraction: processedFrames / selectedFrames,
      processedFrames,
      selectedFrames,
      message: `Läser vågformsdetalj ${Math.round(100 * processedFrames / selectedFrames)} %`,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return {
    range: "[startFrame,endFrame)",
    startFrame,
    endFrame,
    selectedFrames,
    sampleRate: format.sampleRate,
    framesPerBin,
    binDurationSeconds: framesPerBin / format.sampleRate,
    binCount,
    includesSamples: includeSamples,
    channels: channels.map(target => ({
      channel: target.channel,
      min: Array.from(target.min, value => value === Infinity ? null : value),
      max: Array.from(target.max, value => value === -Infinity ? null : value),
      rms: Array.from(target.sumSquares, (value, index) => target.count[index]
        ? Math.sqrt(value / target.count[index])
        : null),
      samples: target.samples ? Array.from(target.samples) : null,
    })),
  };
}
