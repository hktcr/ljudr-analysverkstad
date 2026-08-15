import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalPeakRegion,
  localGainBreakpoints,
  localGainFactorAtFrame,
  monitorSafetyDecision,
  normalizeLocalGainRegions,
} from "../src/local-gain.js";

test("lokal gain använder linjära amplitudramper och full återgång", () => {
  const region = normalizeLocalGainRegions([{
    id: "one",
    startFrame: 10,
    attackEndFrame: 20,
    releaseStartFrame: 30,
    endFrame: 41,
    gainDb: -6.020599913,
  }], 100)[0];
  assert.equal(localGainFactorAtFrame([region], 9), 1);
  assert.equal(localGainFactorAtFrame([region], 10), 1);
  assert.ok(Math.abs(localGainFactorAtFrame([region], 20) - 0.5) < 1e-9);
  assert.ok(Math.abs(localGainFactorAtFrame([region], 30) - 0.5) < 1e-9);
  assert.equal(localGainFactorAtFrame([region], 40), 1);
  assert.equal(localGainFactorAtFrame([region], 41), 1);
});

test("överlapp använder starkaste sänkningen och staplas inte", () => {
  const regions = normalizeLocalGainRegions([
    { id: "a", startFrame: 0, attackEndFrame: 0, releaseStartFrame: 19, endFrame: 20, gainDb: -6 },
    { id: "b", startFrame: 5, attackEndFrame: 5, releaseStartFrame: 14, endFrame: 15, gainDb: -12 },
  ], 30);
  const factor = localGainFactorAtFrame(regions, 10);
  assert.ok(Math.abs(factor - 10 ** (-12 / 20)) < 1e-12);
});

test("toppförslag är stereolänkat, begränsat till filen och har spårbara brytpunkter", () => {
  const region = buildLocalPeakRegion({
    id: "peak",
    peakFrame: 5,
    eventStartFrame: 5,
    eventEndFrame: 6,
    gainDb: -10,
    sampleRate: 100,
    transitionSeconds: 0.2,
    paddingSeconds: 0.05,
    frameCount: 100,
    targetDbtp: -2,
  });
  assert.equal(region.startFrame, 0);
  assert.equal(region.channelMode, "linked");
  assert.equal(region.targetDbtp, -2);
  assert.deepEqual(localGainBreakpoints([region]), [...new Set([
    region.startFrame,
    region.attackEndFrame,
    region.releaseStartFrame,
    region.endFrame - 1,
    region.endFrame,
  ])].sort((a, b) => a - b));
});

test("ogiltiga och dubbla regioner avvisas", () => {
  assert.throws(() => normalizeLocalGainRegions([{ id: "x", startFrame: 0, endFrame: 1, gainDb: 1 }], 10), /Lokal gain/);
  assert.throws(() => normalizeLocalGainRegions([
    { id: "x", startFrame: 0, endFrame: 2, gainDb: -1 },
    { id: "x", startFrame: 2, endFrame: 4, gainDb: -1 },
  ], 10), /unika id/);
});

test("säker medhörning skapar exakt skyddsmarginal för höga floattoppar", () => {
  const decision = monitorSafetyDecision({
    analysis: { summary: { truePeakDbtp: 8.4 } },
    trustedSource: true,
  });
  assert.equal(decision.ready, true);
  assert.equal(decision.reason, "attenuated");
  assert.ok(Math.abs(decision.safetyDb - -11.4) < 1e-12);
  assert.ok(Math.abs(decision.projectedPeakDbtp - 8.4) < 1e-12);
  assert.ok(Math.abs(decision.totalDb - -11.4) < 1e-12);
});

test("säker medhörning lämnar redan säkra toppar oförändrade", () => {
  const decision = monitorSafetyDecision({
    analysis: { summary: { truePeakEstimateDbtp: -6 } },
    trustedSource: true,
  });
  assert.equal(decision.ready, true);
  assert.equal(decision.reason, "safe");
  assert.equal(decision.safetyDb, 0);
  assert.equal(decision.totalDb, 0);
});

test("nulltopp och importerad analys låser uppspelningen", () => {
  const missing = monitorSafetyDecision({ analysis: { summary: { truePeakDbtp: null, samplePeakDbfs: null } }, trustedSource: true });
  const imported = monitorSafetyDecision({ analysis: { summary: { truePeakDbtp: -40 } }, trustedSource: false });
  assert.deepEqual({ ready: missing.ready, reason: missing.reason, safetyDb: missing.safetyDb }, { ready: false, reason: "missing-peak", safetyDb: null });
  assert.deepEqual({ ready: imported.ready, reason: imported.reason, safetyDb: imported.safetyDb }, { ready: false, reason: "untrusted-analysis", safetyDb: null });
});
