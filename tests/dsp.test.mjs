import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeWav,
  parseWavHeader,
  calculateIntegratedLufs,
  calculateLoudnessRange,
  FirTruePeakEstimator,
  analyzeRegion,
  analyzeSpectralDiagnostics,
  analyzeWaveformDetail,
} from "../src/dsp-core.js";

function fourCc(value) {
  return [...value].map((character) => character.charCodeAt(0));
}

function makeWav({ sampleRate = 48000, channels = 2, bits = 16, validBits = bits, format = 1, frames, junk = false, extensible = false }) {
  const bytesPerSample = bits / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames.length * blockAlign;
  const junkSize = junk ? 3 : 0;
  const junkChunkSize = junk ? 8 + junkSize + 1 : 0;
  const formatSize = extensible ? 40 : 16;
  const totalSize = 12 + 8 + formatSize + junkChunkSize + 8 + dataSize;
  const buffer = new ArrayBuffer(totalSize);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes.set(fourCc("RIFF"), 0);
  view.setUint32(4, totalSize - 8, true);
  bytes.set(fourCc("WAVE"), 8);
  let offset = 12;
  bytes.set(fourCc("fmt "), offset);
  view.setUint32(offset + 4, formatSize, true);
  view.setUint16(offset + 8, extensible ? 0xfffe : format, true);
  view.setUint16(offset + 10, channels, true);
  view.setUint32(offset + 12, sampleRate, true);
  view.setUint32(offset + 16, sampleRate * blockAlign, true);
  view.setUint16(offset + 20, blockAlign, true);
  view.setUint16(offset + 22, bits, true);
  if (extensible) {
    view.setUint16(offset + 24, 22, true);
    view.setUint16(offset + 26, validBits, true);
    view.setUint32(offset + 28, channels === 1 ? 4 : 3, true);
    view.setUint32(offset + 32, format, true);
    bytes.set([0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], offset + 36);
  }
  offset += 8 + formatSize;
  if (junk) {
    bytes.set(fourCc("JUNK"), offset);
    view.setUint32(offset + 4, junkSize, true);
    bytes.set([1, 2, 3], offset + 8);
    offset += 8 + junkSize + 1;
  }
  bytes.set(fourCc("data"), offset);
  view.setUint32(offset + 4, dataSize, true);
  offset += 8;
  for (const frame of frames) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = frame[channel] ?? frame[0];
      if (format === 3) view.setFloat32(offset, value, true);
      else if (bits === 16) view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(value * 32768))), true);
      else if (bits === 24) {
        let integer = Math.max(-8388608, Math.min(8388607, Math.round(value * 8388608)));
        if (integer < 0) integer += 0x1000000;
        bytes[offset] = integer & 0xff;
        bytes[offset + 1] = (integer >>> 8) & 0xff;
        bytes[offset + 2] = (integer >>> 16) & 0xff;
      } else view.setInt32(offset, Math.max(-2147483648, Math.min(2147483647, Math.round(value * 2147483648))), true);
      offset += bytesPerSample;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

test("tolkar PCM16 och hoppar över ett udda okänt chunk", async () => {
  const frames = Array.from({ length: 480 }, (_, index) => [index % 2 ? 0.25 : -0.25, 0.1]);
  const blob = makeWav({ frames, junk: true });
  const header = await parseWavHeader(blob);
  assert.equal(header.channels, 2);
  assert.equal(header.sampleRate, 48000);
  assert.equal(header.bitsPerSample, 16);
  assert.equal(header.frameCount, 480);
  assert.equal(header.chunks.some((chunk) => chunk.id === "JUNK"), true);
});

test("analyserar en sammanhängande stereosinus med rimliga råmått", async () => {
  const sampleRate = 48000;
  const duration = 4;
  const frames = Array.from({ length: sampleRate * duration }, (_, index) => {
    const value = 0.5 * Math.sin(2 * Math.PI * 1000 * index / sampleRate);
    return [value, value];
  });
  const progress = [];
  const result = await analyzeWav(makeWav({ sampleRate, frames }), {
    readBlockBytes: 128 * 1024,
    waveformBins: 256,
  }, (event) => progress.push(event));
  assert.equal(result.format.frameCount, sampleRate * duration);
  assert.ok(Math.abs(result.duration - duration) < 1e-9);
  assert.ok(Math.abs(result.summary.samplePeakDbfs + 6.0206) < 0.02);
  assert.ok(Math.abs(result.summary.rmsDbfs + 9.0309) < 0.03);
  assert.ok(Math.abs(result.summary.channelBalanceDb) < 0.001);
  assert.ok(result.summary.correlation > 0.99999);
  assert.ok(result.summary.midSideRatioDb === null || result.summary.midSideRatioDb > 100);
  assert.ok(Number.isFinite(result.summary.integratedLufs));
  assert.ok(Number.isFinite(result.summary.plrEstimateLu));
  assert.ok(result.timelines.momentaryLufs.some(Number.isFinite));
  assert.ok(result.markersSuggested.some((marker) => marker.label === "Högsta Momentary loudness"));
  assert.ok(result.markersSuggested.some((marker) => marker.label === "Högsta Short-term loudness"));
  assert.equal(result.markersSuggested.filter((marker) => marker.label.startsWith("Högsta sample peak")).length, 2);
  assert.equal(result.waveform.channels.length, 2);
  assert.equal(progress.at(-1).fraction, 1);
});

test("läser PCM24 med korrekt tecken och nivå", async () => {
  const frames = [[-0.75], [0.5], [0], [0.25]];
  const result = await analyzeWav(makeWav({ channels: 1, bits: 24, frames }), { waveformBins: 64 });
  assert.ok(Math.abs(result.summary.channels[0].minimum + 0.75) < 1e-6);
  assert.ok(Math.abs(result.summary.channels[0].maximum - 0.5) < 1e-6);
  assert.equal(result.summary.channels[0].zeroSamples, 1);
});

test("analyserar 96 kHz float32 med tvåfaldig intersample-estimering", async () => {
  const sampleRate = 96000;
  const frames = Array.from({ length: sampleRate / 2 }, (_, index) => {
    const left = 0.2 + 0.7 * Math.sin(2 * Math.PI * 997 * index / sampleRate);
    const right = -0.1 + 0.35 * Math.sin(2 * Math.PI * 997 * index / sampleRate);
    return [left, right];
  });
  const result = await analyzeWav(makeWav({ sampleRate, format: 3, bits: 32, frames }), {
    readBlockBytes: 96 * 1024,
    waveformBins: 128,
  });
  assert.equal(result.format.sampleRate, 96000);
  assert.equal(result.format.encoding, "IEEE float");
  assert.match(result.validation.truePeakMethod, /^2x/);
  assert.ok(result.summary.truePeakEstimate >= result.summary.samplePeak);
  assert.ok(Math.abs(result.summary.channels[0].dcOffset - 0.2) < 0.001);
  assert.ok(result.summary.channelBalanceDb > 5.5 && result.summary.channelBalanceDb < 6.5);
});

test("stöder WAVE_FORMAT_EXTENSIBLE float32 vid 96 kHz", async () => {
  const frames = Array.from({ length: 9600 }, (_, index) => {
    const value = 0.4 * Math.sin(2 * Math.PI * 440 * index / 96000);
    return [value, -value];
  });
  const blob = makeWav({ sampleRate: 96000, format: 3, bits: 32, frames, extensible: true });
  const header = await parseWavHeader(blob);
  assert.equal(header.extensible, true);
  assert.equal(header.encoding, "IEEE float");
  const result = await analyzeWav(blob, { waveformBins: 64 });
  assert.ok(result.summary.correlation < -0.9999);
});

test("läser PCM32 utan att förlora tecken", async () => {
  const result = await analyzeWav(makeWav({ channels: 1, bits: 32, frames: [[-0.9], [0.8], [0]] }), {
    waveformBins: 64,
  });
  assert.ok(Math.abs(result.summary.channels[0].minimum + 0.9) < 1e-8);
  assert.ok(Math.abs(result.summary.channels[0].maximum - 0.8) < 1e-8);
});

test("redovisar float-overrange och icke ändliga värden utan att kalla dem klippning", async () => {
  const frames = [[0, 0], [1.2, -1.1], [Number.NaN, 0.2], [Number.POSITIVE_INFINITY, 0.3]];
  const result = await analyzeWav(makeWav({ format: 3, bits: 32, frames }), { waveformBins: 64 });
  assert.equal(result.summary.overrangeSamples, 2);
  assert.equal(result.summary.nonFiniteSamples, 2);
  assert.ok(result.observations.some((item) => item.id === "overrange"));
  assert.ok(result.observations.some((item) => item.id === "non-finite"));
  const invalidMarkers = result.markersSuggested.filter(item => item.label === "Ogiltigt floatvärde");
  assert.equal(invalidMarkers.length, 1);
  assert.equal(invalidMarkers[0].severity, "critical");
  assert.equal(invalidMarkers[0].channel, 1);
  assert.ok(invalidMarkers[0].endSeconds > invalidMarkers[0].startSeconds);
  assert.match(result.validation.truePeakStatus, /klarar EBU Tech 3341/);
});

test("filbaserade M- och S-maxima är oberoende av signalens startläge", async () => {
  const sampleRate = 48000;
  const tone = seconds => Array.from({ length: sampleRate * seconds }, (_, index) => {
    const value = 0.1 * Math.sin(2 * Math.PI * 1000 * index / sampleRate);
    return [value, value];
  });
  const silence = seconds => Array.from({ length: sampleRate * seconds }, () => [0, 0]);

  const momentaryReference = await analyzeWav(makeWav({ sampleRate, frames: tone(0.4) }), { waveformBins: 64 });
  const momentaryShifted = await analyzeWav(makeWav({
    sampleRate,
    frames: [...silence(0.04), ...tone(0.4), ...silence(0.36)],
  }), { waveformBins: 64 });
  assert.ok(Math.abs(momentaryReference.summary.momentaryMaxLufs - momentaryShifted.summary.momentaryMaxLufs) < 0.01);

  const shortReference = await analyzeWav(makeWav({ sampleRate, frames: tone(3) }), { waveformBins: 64 });
  const shortShifted = await analyzeWav(makeWav({
    sampleRate,
    frames: [...silence(0.15), ...tone(3), ...silence(0.85)],
  }), { waveformBins: 64 });
  assert.ok(Math.abs(shortReference.summary.shortTermMaxLufs - shortShifted.summary.shortTermMaxLufs) < 0.01);
});

test("49 taps FIR fångar ett kraftigt intersample-mönster omkring plus 3 dBTP", () => {
  const estimator = new FirTruePeakEstimator(1, 48000);
  const pattern = [0.99, 0.99, -0.99, -0.99];
  for (let index = 0; index < 1000; index += 1) {
    estimator.push(0, pattern[index % pattern.length]);
  }
  estimator.finish();
  const peakDbtp = 20 * Math.log10(estimator.peaks[0]);
  assert.ok(peakDbtp >= 2.6 && peakDbtp <= 3.2, `${peakDbtp} dBTP`);
});

test("FIR True Peak återger den analytiska toppen för en högfrekvent sinus", () => {
  const sampleRate = 48000;
  const amplitude = 0.9;
  const estimator = new FirTruePeakEstimator(1, sampleRate);
  for (let frame = 0; frame < sampleRate / 5; frame += 1) {
    estimator.push(0, amplitude * Math.sin(2 * Math.PI * 18000 * frame / sampleRate));
  }
  estimator.finish();
  const expectedDbtp = 20 * Math.log10(amplitude);
  const measuredDbtp = 20 * Math.log10(estimator.peaks[0]);
  assert.ok(Math.abs(measuredDbtp - expectedDbtp) < 0.05);
});

test("gatingfunktionerna ger null för tystnad och positiv LRA för varierande energi", () => {
  assert.equal(calculateIntegratedLufs([0, 0, 0]), null);
  const energies = [0.0001, 0.0001, 0.001, 0.001, 0.01, 0.01];
  assert.ok(Number.isFinite(calculateIntegratedLufs(energies)));
  assert.ok(calculateLoudnessRange(energies) > 0);
});

test("den gemensamma parsern avvisar RF64 och frekvenser utanför den diskreta matrisen", async () => {
  const ordinary = makeWav({ frames: [[0, 0], [0, 0]] });
  const rf64Bytes = new Uint8Array(await ordinary.arrayBuffer());
  rf64Bytes.set(fourCc("RF64"), 0);
  await assert.rejects(() => parseWavHeader(new Blob([rf64Bytes])), /RF64 och BW64/);
  await assert.rejects(
    () => parseWavHeader(makeWav({ sampleRate: 32000, frames: [[0, 0], [0, 0]] })),
    /32000 Hz stöds inte/,
  );
});

test("hela den diskreta samplingsfrekvensmatrisen accepteras", async () => {
  for (const sampleRate of [44100, 48000, 88200, 96000, 176400, 192000]) {
    const header = await parseWavHeader(makeWav({ sampleRate, frames: [[0, 0], [0, 0]] }));
    assert.equal(header.sampleRate, sampleRate);
  }
});

test("Extensible PCM med 24 giltiga vänsterjusterade bitar avkodas korrekt", async () => {
  const result = await analyzeWav(makeWav({
    channels: 1,
    bits: 32,
    validBits: 24,
    format: 1,
    extensible: true,
    frames: [[-0.5], [0.25], [0]],
  }), { waveformBins: 64 });
  assert.equal(result.format.validBitsPerSample, 24);
  assert.ok(Math.abs(result.summary.channels[0].minimum + 0.5) < 1e-7);
  assert.ok(Math.abs(result.summary.channels[0].maximum - 0.25) < 1e-7);
});

test("regionskedjan mäter exakt urval efter fades och enda globala gain", async () => {
  const sampleRate = 48000;
  const frames = Array.from({ length: sampleRate * 4 }, (_, index) => {
    const value = 0.1 * Math.sin(2 * Math.PI * 997 * index / sampleRate);
    return [value, value];
  });
  const result = await analyzeRegion(makeWav({ sampleRate, frames }), {
    startFrame: sampleRate / 2,
    endFrame: sampleRate * 3.5,
    fadeInFrames: 480,
    fadeOutFrames: 480,
    globalGainDb: 6,
  });
  assert.equal(result.range.selectedFrames, sampleRate * 3);
  assert.equal(result.edit.globalGainDb, 6);
  assert.equal(result.edit.dynamicProcessing, false);
  assert.ok(result.processed.summary.integratedLufs - result.source.summary.integratedLufs > 5.8);
  assert.ok(result.processed.summary.truePeakEstimateDbtp - result.source.summary.truePeakEstimateDbtp > 5.8);
});

test("adaptiv vågformsdetalj ger L och R min max RMS samt sampel vid djup zoom", async () => {
  const frames = Array.from({ length: 100 }, (_, index) => [index / 100, -index / 200]);
  const result = await analyzeWaveformDetail(makeWav({ frames }), {
    startFrame: 10,
    endFrame: 30,
    pixelWidth: 100,
    includeSamples: true,
  });
  assert.equal(result.framesPerBin, 1);
  assert.equal(result.channels.length, 2);
  assert.equal(result.channels[0].samples.length, 20);
  assert.ok(result.channels[0].max[0] > 0);
  assert.ok(result.channels[1].min[0] < 0);
});

test("True Peak får kanal och gruppfördröjningskorrigerad tid", async () => {
  const frames = Array.from({ length: 1000 }, () => [0, 0]);
  frames[400] = [0.9, 0.1];
  const result = await analyzeWav(makeWav({ frames }), { waveformBins: 64 });
  assert.ok(Math.abs(result.summary.channels[0].truePeakTimeSeconds - 400 / 48000) <= 1 / 48000);
  const marker = result.markersSuggested.find(item => item.label === "Högsta True Peak, kanal 1");
  assert.equal(marker.channel, 1);
  assert.equal(marker.objective, true);
  assert.equal(marker.heuristic, false);
  assert.ok(marker.timePrecisionSeconds <= 1 / 48000);
});

test("mono fold-down mäts och varaktig negativ korrelation blir navigerbar", async () => {
  const sampleRate = 48000;
  const frames = Array.from({ length: sampleRate * 2 }, (_, index) => {
    const value = 0.25 * Math.sin(2 * Math.PI * 997 * index / sampleRate);
    return [value, -value];
  });
  const result = await analyzeWav(makeWav({ sampleRate, frames }), { waveformBins: 64 });
  assert.ok(result.summary.monoCompatibility.energyDeltaDb < -40);
  assert.ok(result.summary.monoCompatibility.negativeCorrelationPercent > 90);
  assert.ok(result.summary.monoCompatibility.negativeCorrelationRegions.length >= 1);
  assert.ok(result.markersSuggested.some(marker => marker.machineKind === "negative-stereo-correlation"));
});

test("spektral diagnostik samplar deterministiskt utan EQ-beslut", async () => {
  const sampleRate = 48000;
  const frames = Array.from({ length: sampleRate }, (_, index) => {
    const value = 0.2 * Math.sin(2 * Math.PI * 50 * index / sampleRate);
    return [value, value];
  });
  const result = await analyzeSpectralDiagnostics(makeWav({ sampleRate, frames }), { windowCount: 3 });
  assert.equal(result.scope, "deterministic-sampled-windows");
  assert.equal(result.windowCount, 1);
  assert.equal(result.sampledSeconds, 1);
  assert.ok(Number.isFinite(result.mainsHum50RelativeDbMedian));
  assert.match(result.interpretation, /Inte full spektralanalys/);
  assert.doesNotMatch(JSON.stringify(result), /equaliz|auto.?eq/i);
});
