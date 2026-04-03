import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildSceneIndex, readRecordingManifest } from "./scene-index-lib.mjs";

const repoRoot = process.cwd();
const privateManifestPath = path.join(repoRoot, ".compat-fixtures/manifest.json");

const checkedInFixtures = [
  {
    label: "public-demo",
    path: "demo/cap-demo-recording.mcap",
    format: "mcap",
    expectedTopics: ["/cap/demo/state", "/camera/front/compressed"],
    expectedSignals: ["vehicle.autonomy_enabled", "controls.brake_pressed"],
    expectCameraPreviews: true,
  },
  {
    label: "schema-less-json",
    path: "demo/compatibility/schema-less-json.mcap",
    format: "mcap",
    expectedTopics: ["/robot/state"],
    expectedSignals: ["robot.mode", "metrics.speed_mps"],
    expectCameraPreviews: false,
  },
  {
    label: "empty-channel",
    path: "demo/compatibility/empty-channel.mcap",
    format: "mcap",
    expectedTopics: ["/vehicle/state", "/vehicle/unused"],
    expectedSignals: ["robot.enabled", "metrics.speed_mps"],
    expectCameraPreviews: false,
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadPrivateFixtures() {
  try {
    const raw = await fs.readFile(privateManifestPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.fixtures) ? parsed.fixtures : [];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function validateFixture(fixture, tempDir) {
  const inputPath = path.resolve(repoRoot, fixture.path);
  await fs.access(inputPath);

  const manifest = await readRecordingManifest(inputPath);
  assert(manifest.recordingFormat === fixture.format, `${fixture.label}: expected format ${fixture.format}`);

  for (const expectedTopic of fixture.expectedTopics ?? []) {
    assert(
      manifest.topics.some((topic) => topic.name === expectedTopic),
      `${fixture.label}: missing topic ${expectedTopic}`,
    );
  }

  const outputPath = path.join(
    tempDir,
    `${fixture.label.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}.cap-index.json`,
  );
  const { index } = await buildSceneIndex(inputPath, outputPath);

  for (const expectedSignal of fixture.expectedSignals ?? []) {
    assert(index.signals.some((signal) => signal.path === expectedSignal), `${fixture.label}: missing signal ${expectedSignal}`);
  }

  const hasCameraPreviews = Object.keys(index.cameraPreviews ?? {}).length > 0;
  assert(
    hasCameraPreviews === Boolean(fixture.expectCameraPreviews),
    `${fixture.label}: expected camera previews to be ${Boolean(fixture.expectCameraPreviews)}`,
  );

  console.log(
    `Validated ${fixture.label}: ${manifest.recordingFormat}, ${manifest.topics.length} topics, ${index.signals.length} signals`,
  );
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cap-compat-"));

try {
  const privateFixtures = await loadPrivateFixtures();
  for (const fixture of [...checkedInFixtures, ...privateFixtures]) {
    await validateFixture(fixture, tempDir);
  }

  if (privateFixtures.length === 0) {
    console.log("No private fixtures declared at .compat-fixtures/manifest.json; validated checked-in fixtures only.");
  }
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
