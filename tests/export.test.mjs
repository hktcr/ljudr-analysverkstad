import test from "node:test";
import assert from "node:assert/strict";
import {
  exportInternals,
  exportWav,
  FADE_OVERLAP_POLICY
} from "../src/export-worker.js";
import { decodeInterleaved, inspectWav } from "../src/wav.js";

const ascii = (view, offset, text) => {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
};

const pcm16Wave = (samples, channels = 2, sampleRate = 48000) => {
  const blockAlign = channels * 2;
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  ascii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(view, 8, "WAVE");
  ascii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return new File([bytes], "fixture.wav", { type: "audio/wav", lastModified: 1 });
};

const pcmWideWave = (samples, bitsPerSample, channels = 1, sampleRate = 48000) => {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = samples.length * bytesPerSample;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  ascii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(view, 8, "WAVE");
  ascii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, index) => {
    const offset = 44 + index * bytesPerSample;
    if (bitsPerSample === 24) {
      const unsigned = sample < 0 ? sample + 0x1000000 : sample;
      view.setUint8(offset, unsigned & 0xff);
      view.setUint8(offset + 1, (unsigned >>> 8) & 0xff);
      view.setUint8(offset + 2, (unsigned >>> 16) & 0xff);
    } else {
      view.setInt32(offset, sample, true);
    }
  });
  return new File([bytes], `pcm${bitsPerSample}.wav`, { type: "audio/wav", lastModified: 3 });
};

const float32Wave = (samples, channels = 2, sampleRate = 96000) => {
  const blockAlign = channels * 4;
  const dataBytes = samples.length * 4;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  ascii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(view, 8, "WAVE");
  ascii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 32, true);
  ascii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, index) => view.setFloat32(44 + index * 4, sample, true));
  return new File([bytes], "float96.wav", { type: "audio/wav", lastModified: 2 });
};

const extensiblePcm32Valid24Wave = (samples, sampleRate = 48000) => {
  const dataBytes = samples.length * 4;
  const bytes = new Uint8Array(68 + dataBytes);
  const view = new DataView(bytes.buffer);
  ascii(view, 0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  ascii(view, 8, "WAVE");
  ascii(view, 12, "fmt ");
  view.setUint32(16, 40, true);
  view.setUint16(20, 0xfffe, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  view.setUint16(36, 22, true);
  view.setUint16(38, 24, true);
  view.setUint32(40, 4, true);
  view.setUint32(44, 1, true);
  bytes.set([0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 48);
  ascii(view, 60, "data");
  view.setUint32(64, dataBytes, true);
  samples.forEach((sample, index) => view.setInt32(68 + index * 4, sample << 8, true));
  return new File([bytes], "valid24-in-32.wav", { type: "audio/wav" });
};

const waveWithOddJunk = () => {
  const samples = [100, -100, 200, -200];
  const bytes = new Uint8Array(44 + 10 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  ascii(view, 0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  ascii(view, 8, "WAVE");
  ascii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 192000, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ascii(view, 36, "JUNK");
  view.setUint32(40, 1, true);
  view.setUint8(44, 123);
  view.setUint8(45, 0);
  ascii(view, 46, "data");
  view.setUint32(50, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(54 + index * 2, sample, true));
  return new File([bytes], "odd.wav", { type: "audio/wav" });
};

test("WAV-parsern läser ett vanligt stereo PCM-huvud", async () => {
  const file = pcm16Wave([1, -1, 2, -2, 3, -3, 4, -4]);
  const info = await inspectWav(file);
  assert.equal(info.format.encoding, "PCM");
  assert.equal(info.format.channels, 2);
  assert.equal(info.format.sampleRate, 48000);
  assert.equal(info.format.bitsPerSample, 16);
  assert.equal(info.frameCount, 4);
});

test("bearbetningsavkodningen använder 64 bit float och bevarar PCM32:s lägsta bitar", () => {
  const integers = [2147483647, 2147483646, 1, -1, -2147483648];
  const bytes = new Uint8Array(integers.length * 4);
  const view = new DataView(bytes.buffer);
  integers.forEach((value, index) => view.setInt32(index * 4, value, true));
  const decoded = decodeInterleaved(bytes, {
    channels: 1,
    bitsPerSample: 32,
    encoding: "PCM",
    blockAlign: 4,
  });
  assert.equal(decoded instanceof Float64Array, true);
  assert.deepEqual(Array.from(decoded, value => value * 2147483648), integers);
});

test("Ren trimning bevarar valda PCM-byte exakt", async () => {
  const samples = [100, -100, 200, -200, 300, -300, 400, -400, 500, -500];
  const file = pcm16Wave(samples);
  const { output, report } = await exportWav(file, {
    startFrame: 1,
    endFrame: 4,
    gainDb: 0,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    preferOpfs: false
  });
  const sourceInfo = await inspectWav(file);
  const outputInfo = await inspectWav(output);
  const sourceBytes = new Uint8Array(await file.slice(
    sourceInfo.data.dataOffset + sourceInfo.format.blockAlign,
    sourceInfo.data.dataOffset + 4 * sourceInfo.format.blockAlign
  ).arrayBuffer());
  const outputBytes = new Uint8Array(await output.slice(
    outputInfo.data.dataOffset,
    outputInfo.data.dataOffset + outputInfo.data.completeDataBytes
  ).arrayBuffer());
  assert.deepEqual(outputBytes, sourceBytes);
  assert.equal(report.edit.bitExactSamplePayload, true);
  assert.equal(report.output.dither.applied, false);
  assert.equal(report.output.pcmClampingRisk.detected, false);
  assert.equal(outputInfo.frameCount, 3);
});

for (const bitsPerSample of [24, 32]) {
  test(`Ren trimning bevarar PCM${bitsPerSample} exakt`, async () => {
    const limit = bitsPerSample === 24 ? 0x7fffff : 0x7fffffff;
    const file = pcmWideWave([100, -100, limit / 4 | 0, -(limit / 4 | 0), 7, -7], bitsPerSample);
    const sourceInfo = await inspectWav(file);
    const { output, report } = await exportWav(file, {
      startFrame: 1,
      endFrame: 5,
      preferOpfs: false,
    });
    const outputInfo = await inspectWav(output);
    const sourcePayload = new Uint8Array(await file.slice(
      sourceInfo.data.dataOffset + sourceInfo.format.blockAlign,
      sourceInfo.data.dataOffset + 5 * sourceInfo.format.blockAlign,
    ).arrayBuffer());
    const outputPayload = new Uint8Array(await output.slice(outputInfo.data.dataOffset).arrayBuffer());
    assert.deepEqual(outputPayload, sourcePayload);
    assert.equal(report.edit.bitExactSamplePayload, true);
    assert.equal(outputInfo.format.bitsPerSample, bitsPerSample);
  });
}

test("Gain gör exporten explicit icke bitidentisk", async () => {
  const file = pcm16Wave([1000, -1000, 2000, -2000]);
  const { output, report } = await exportWav(file, {
    startFrame: 0,
    endFrame: 2,
    gainDb: -6,
    preferOpfs: false
  });
  assert.equal(report.edit.bitExactSamplePayload, false);
  assert.equal(report.output.dither.applied, true);
  assert.equal(report.output.dither.type, "TPDF");
  assert.equal((await inspectWav(output)).frameCount, 2);
});

test("gain och linjära fades ger exakt förväntad float32-export", async () => {
  const source = [0.75, -0.5, 0.25, -0.125, 0.6];
  const file = float32Wave(source, 1, 96000);
  const gainDb = -3;
  const multiplier = 10 ** (gainDb / 20);
  const fadeInFrames = 3;
  const fadeOutFrames = 2;
  const { output, report } = await exportWav(file, {
    gainDb,
    fadeInFrames,
    fadeOutFrames,
    preferOpfs: false,
  });
  const info = await inspectWav(output);
  const view = new DataView(await output.slice(info.data.dataOffset).arrayBuffer());
  const expected = source.map((sample, index) => {
    const fadeIn = index < fadeInFrames ? index / (fadeInFrames - 1) : 1;
    const fromEnd = source.length - 1 - index;
    const fadeOut = fromEnd < fadeOutFrames ? fromEnd / (fadeOutFrames - 1) : 1;
    return Math.fround(sample * multiplier * Math.min(fadeIn, fadeOut));
  });
  const actual = expected.map((_, index) => view.getFloat32(index * 4, true));
  assert.deepEqual(actual, expected);
  assert.equal(report.output.dither.applied, false);
  assert.equal(report.edit.bitExactSamplePayload, false);
});

test("bekräftad toppkontroll som inte behöver stoppa bevarar ren trimning bitidentiskt", async () => {
  const file = pcm16Wave([1000, -1000, 2000, -2000, 3000, -3000]);
  const { output, report } = await exportWav(file, {
    startFrame: 0,
    endFrame: 3,
    globalGainDb: 0,
    enforceTruePeakCeiling: true,
    truePeakCeilingDbtp: 0,
    preferOpfs: false
  });
  const sourceInfo = await inspectWav(file);
  const outputInfo = await inspectWav(output);
  const sourcePayload = new Uint8Array(await file.slice(sourceInfo.data.dataOffset).arrayBuffer());
  const outputPayload = new Uint8Array(await output.slice(outputInfo.data.dataOffset).arrayBuffer());
  assert.deepEqual(outputPayload, sourcePayload);
  assert.equal(report.edit.peakAdjustmentDb, 0);
  assert.equal(report.edit.effectiveGainDb, 0);
  assert.equal(report.edit.bitExactSamplePayload, true);
  assert.equal(report.edit.peakHandling.mode, "verify-only-no-hidden-adjustment");
  assert.equal(report.output.ditherApplied, false);
  assert.equal(report.verifiedOutput.samplePayloadIdentity.identical, true);
});

test("export gör ingen dold toppsänkning utan blockerar det bekräftade gainvärdet", async () => {
  const samples = [28000, -14000, 21000, -7000, 14000, -3500, 7000, -1750];
  const file = pcm16Wave(samples);
  await assert.rejects(
    () => exportWav(file, {
      globalGainDb: 3,
      truePeakCeilingDbtp: -6,
      preferOpfs: false,
    }),
    error => error.code === "TRUE_PEAK_CEILING_EXCEEDED",
  );

  const { output, fileName, report, verifiedOutput } = await exportWav(file, {
    globalGainDb: -5.5,
    truePeakCeilingDbtp: -6,
    fileName: "TMH_E008_har_MASTER.wav",
    preferOpfs: false,
  });
  assert.equal(report.edit.globalGainDb, -5.5);
  assert.equal(report.edit.effectiveGainDb, -5.5);
  assert.equal(report.edit.peakAdjustmentDb, 0);
  assert.equal(report.edit.peakHandling.dynamicProcessing, false);
  assert.equal(report.edit.truePeakValidationStatus, "ebu-minimum-requirements-validated");
  assert.equal(report.output.pcmClampingRisk.detected, false);
  assert.equal(report.output.dither.applied, true);
  assert.equal(fileName, "TMH_E008_har_MASTER.wav");
  assert.ok(verifiedOutput.summary.truePeakEstimateDbtp <= -6);
  assert.ok(Array.isArray(verifiedOutput.markersSuggested));
  assert.equal(verifiedOutput.validation.engineVersion, "1.0.0-rc.9");

  const info = await inspectWav(output);
  const view = new DataView(await output.slice(info.data.dataOffset).arrayBuffer());
  const multiplier = 10 ** (-5.5 / 20);
  for (let index = 0; index < samples.length; index += 1) {
    const actual = view.getInt16(index * 2, true);
    const expected = samples[index] * multiplier;
    assert.ok(Math.abs(actual - expected) <= 2);
  }
});

test("Positiv gain som skulle klampa PCM blockeras före export", async () => {
  const file = pcm16Wave([30000, -30000, 28000, -28000]);
  await assert.rejects(
    () => exportWav(file, { globalGainDb: 1, enforceTruePeakCeiling: false, preferOpfs: false }),
    error => {
      assert.equal(error.name, "PcmClampingRiskError");
      assert.equal(error.code, "PCM_CLAMPING_RISK");
      assert.equal(error.details.detected, true);
      assert.equal(error.details.blocked, true);
      return true;
    }
  );
});

test("TPDF-marginalrisk blockeras även utan positiv gain", async () => {
  const file = pcm16Wave([32767, 0, 1000, 0]);
  await assert.rejects(
    () => exportWav(file, {
      fadeOutFrames: 1,
      enforceTruePeakCeiling: false,
      preferOpfs: false,
    }),
    error => {
      assert.equal(error.code, "PCM_CLAMPING_RISK");
      assert.equal(error.details.rawClampingRisk, false);
      assert.equal(error.details.ditherClampingRisk, true);
      assert.equal(error.details.blocked, true);
      return true;
    },
  );
});

test("Toppförkontrollen använder markerat intervall efter fades", async () => {
  const file = float32Wave([1, 1, 0.1, 0.1, 1], 1, 96000);
  const { report } = await exportWav(file, {
    startFrame: 1,
    endFrame: 4,
    fadeInFrames: 2,
    preferOpfs: false
  });
  assert.ok(report.edit.selectionTruePeakEstimateDbtp < -15);
  assert.equal(report.validation.selectionBased, true);
  assert.equal(report.validation.measuredAfterFadesBeforeGain, true);
  assert.equal(report.output.dither.applied, false);
});

test("Överlappande fades använder den lägsta linjära enveloppen", () => {
  const { fadeFactor } = exportInternals;
  assert.equal(FADE_OVERLAP_POLICY, "minimum-envelope");
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => fadeFactor(index, 4, 4, 4)),
    [0, 1 / 3, 1 / 3, 0]
  );
});

test("Avklippt WAV upptäcks", async () => {
  const file = pcm16Wave([1, -1, 2, -2]);
  const truncated = new File([await file.slice(0, file.size - 2).arrayBuffer()], "kort.wav");
  const info = await inspectWav(truncated);
  assert.equal(info.isTruncated, true);
  assert.ok(info.warnings.some(item => item.includes("avklippt")));
});

test("32 bit float vid 96 kHz behåller overrange vid ren trimning", async () => {
  const file = float32Wave([0.25, -0.25, 1.2, -1.1, 0.5, -0.5]);
  const sourceInfo = await inspectWav(file);
  assert.equal(sourceInfo.format.encoding, "IEEE_FLOAT");
  assert.equal(sourceInfo.format.sampleRate, 96000);
  const { output, report } = await exportWav(file, {
    startFrame: 1,
    endFrame: 3,
    preferOpfs: false
  });
  const outputInfo = await inspectWav(output);
  const payload = new DataView(await output.slice(outputInfo.data.dataOffset).arrayBuffer());
  assert.ok(Math.abs(payload.getFloat32(0, true) - 1.2) < 1e-6);
  assert.ok(Math.abs(payload.getFloat32(4, true) + 1.1) < 1e-6);
  assert.equal(report.edit.bitExactSamplePayload, true);
});

test("Parsern respekterar padding efter ett udda chunk", async () => {
  const info = await inspectWav(waveWithOddJunk());
  assert.equal(info.data.dataOffset, 54);
  assert.equal(info.frameCount, 2);
});

test("mono PCM24 med udda data får korrekt avslutande RIFF-padding", async () => {
  const file = pcmWideWave([123456], 24, 1);
  const { output, verifiedOutput } = await exportWav(file, { preferOpfs: false });
  const bytes = new Uint8Array(await output.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(output.size % 2, 0);
  assert.equal(view.getUint32(4, true), output.size - 8);
  assert.equal(bytes.at(-1), 0);
  assert.equal(verifiedOutput.format.riffPaddingBytes, 1);
  assert.equal((await inspectWav(output)).data.declaredSize, 3);
});

test("invalid float blockerar bearbetad export men får sample-identiskt trimmas", async () => {
  const file = float32Wave([0.1, Number.NaN, 0.2], 1, 96000);
  await assert.rejects(
    () => exportWav(file, { globalGainDb: -1, preferOpfs: false }),
    error => error.code === "INVALID_FLOAT_TRANSFORM_BLOCKED",
  );
  const { verifiedOutput } = await exportWav(file, { preferOpfs: false });
  assert.equal(verifiedOutput.samplePayloadIdentity.identical, true);
  assert.equal(verifiedOutput.invalidFloatSamples, 1);
});

test("Extensible PCM med avvikande validBits får trimmas men inte räknas om", async () => {
  const file = extensiblePcm32Valid24Wave([1000, -1000, 500]);
  const clean = await exportWav(file, { startFrame: 0, endFrame: 2, preferOpfs: false });
  assert.equal(clean.verifiedOutput.samplePayloadIdentity.identical, true);
  await assert.rejects(
    () => exportWav(file, { globalGainDb: -1, preferOpfs: false }),
    error => error.code === "VALID_BITS_REENCODE_BLOCKED",
  );
});
