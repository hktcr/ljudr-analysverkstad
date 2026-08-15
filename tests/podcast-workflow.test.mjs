import test from "node:test";
import assert from "node:assert/strict";
import {
  TMH_SERIES_PROFILE,
  buildEditorialContext,
  buildEditorialCueSheet,
  buildEpisodeHandoff,
  publicationStatus,
  selectAnalysisStage,
  summarizeSeriesReports,
} from "../src/podcast-workflow.js";

test("signalsteg väljs uttryckligt och faller säkert tillbaka till källan", () => {
  const source = { id: "source" };
  const calculated = { id: "calculated" };
  assert.deepEqual(selectAnalysisStage({ source, calculated, stage: "calculated-export-selection" }), { stage: "calculated-export-selection", analysis: calculated });
  assert.deepEqual(selectAnalysisStage({ source, stage: "verified-output" }), { stage: "source", analysis: source });
});

test("Twenty Minutes Here-profilen är versionsstyrd redaktionell orientering", () => {
  const context = buildEditorialContext({ purpose: "distribution" });
  assert.equal(context.seriesProfileVersion, TMH_SERIES_PROFILE.version);
  assert.equal(context.loudnessOrientation.targetLufs, -19);
  assert.match(context.loudnessOrientation.rationale, /Inte en Spotify-standard/);
  assert.equal(context.classification, "editorial");
});

test("cue sheet är opt-in, urvalsrelativt och bara användarskrivet", () => {
  const cues = buildEditorialCueSheet([
    { origin: "analysis", type: "technical", seconds: 11, text: "maskin" },
    { origin: "user", type: "privacy", seconds: 12, endSeconds: 14, text: "granska namn", reviewStatus: "unreviewed" },
    { origin: "user", type: "privacy", seconds: 30, text: "utanför" },
  ], { selectionStartSeconds: 10, selectionEndSeconds: 20 });
  assert.equal(cues.length, 1);
  assert.deepEqual([cues[0].startSeconds, cues[0].endSeconds], [2, 4]);
  assert.equal(cues[0].classification, "editorial");
});

test("publiceringskortet använder mjuka spärrar och dokumenterad längdavvikelse", () => {
  const ready = publicationStatus({
    durationSeconds: 1199,
    verifiedCurrent: true,
    metadata: { title: "Plats", episode: "8", place: "Stockholm" },
    manual: { fullListen: true, boundaries: true, stereo: true, mono: true, privacy: true, archiveSaved: true },
    exceptionNote: "En sekund kort på grund av oönskat handhavandeljud.",
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.softGate, true);
  assert.equal(ready.checks.duration, true);
  const blocked = publicationStatus({ durationSeconds: 1200, verifiedCurrent: false, metadata: {} });
  assert.equal(blocked.status, "review-required");
  assert.ok(blocked.incomplete.includes("verifiedWav"));
  const privacyBlocked = publicationStatus({
    durationSeconds: 1200,
    verifiedCurrent: true,
    editorialUnreviewed: 1,
    metadata: { title: "Plats", episode: "8", place: "Stockholm" },
    manual: { fullListen: true, boundaries: true, stereo: true, mono: true, privacy: true, archiveSaved: true },
  });
  assert.equal(privacyBlocked.status, "review-required");
  assert.ok(privacyBlocked.incomplete.includes("markersReviewed"));
});

test("handoff binder avsnittsmetadata till verifierad masterhash", () => {
  const handoff = buildEpisodeHandoff({
    metadata: { episode: "8", title: "Här", series: "Twenty Minutes Here", place: "Stockholm", coordinatePrecision: "hidden" },
    verifiedOutput: { sourceIdentity: { value: "ab".repeat(32) }, format: { durationSeconds: 1200, channels: 2, sampleRate: 48000 }, summary: { integratedLufs: -19, truePeakEstimateDbtp: -2.5 } },
    publication: { status: "ready" },
  });
  assert.equal(handoff.verifiedMaster.sha256, "ab".repeat(32));
  assert.equal(handoff.location.latitude, null);
  assert.equal(handoff.episode.number, 8);
});

test("serieöversikten visar median och spridning utan normalisering", () => {
  const overview = summarizeSeriesReports([
    { source: { name: "e1" }, verifiedOutput: { format: { durationSeconds: 1200 }, summary: { integratedLufs: -20, truePeakEstimateDbtp: -3 } } },
    { source: { name: "e2" }, verifiedOutput: { format: { durationSeconds: 1198 }, summary: { integratedLufs: -18, truePeakEstimateDbtp: -1 } } },
    { metadata: { sessionId: "egen-rapport" }, sections: { verifiedExportFile: { label: "Verifierad exportfil", format: { durationSeconds: 1200 }, summary: { integratedLufs: -19, truePeakEstimateDbtp: -2 } } } },
  ]);
  assert.equal(overview.count, 3);
  assert.equal(overview.statistics.integratedLufs.median, -19);
  assert.deepEqual([overview.statistics.integratedLufs.minimum, overview.statistics.integratedLufs.maximum], [-20, -18]);
  assert.equal(overview.normalizationApplied, false);
});
