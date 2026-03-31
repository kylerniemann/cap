import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { ensureSceneIndex, readRecordingManifest } from "./scene-index-lib.mjs";

const watchDirs = process.argv.slice(2);
const defaultDirs = [
  path.join(os.homedir(), "Downloads"),
  path.join(os.homedir(), "Desktop"),
  path.join(os.homedir(), "Documents"),
];
const searchRoots = (watchDirs.length > 0 ? watchDirs : defaultDirs).filter(Boolean);

const host = "127.0.0.1";
const port = 8765;
const manifestCache = new Map();
const indexCache = new Map();
const PREVIEW_DISTANCE_LIMIT_NS = 5_000_000_000n;

function normalizeName(value) {
  return value.replace(/^\//, "").replace(/\[(\d+)\]/g, ".$1").toLowerCase();
}

function isTruthySignal(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return ["true", "on", "active", "1", "yes", "enabled"].includes(value.toLowerCase());
  }
  return Boolean(value);
}

function parseComparisonValue(raw, type) {
  if (type === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (type === "boolean") {
    return raw.toLowerCase() === "true";
  }
  return raw;
}

function compareValue(left, operator, right) {
  if (operator === "is active") {
    return isTruthySignal(left);
  }
  if (operator === "is not active") {
    return !isTruthySignal(left);
  }
  if (operator === ">") {
    return Number(left) > Number(right);
  }
  if (operator === "<") {
    return Number(left) < Number(right);
  }
  if (operator === "==") {
    return left === right;
  }
  return left !== right;
}

function secondsToNs(value) {
  return BigInt(Math.max(0, Math.round(value * 1_000_000_000)));
}

function nsToTime(timestampNs) {
  return {
    sec: Number(timestampNs / 1_000_000_000n),
    nsec: Number(timestampNs % 1_000_000_000n),
  };
}

function timeToNsValue(value) {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(Math.round(value));
  }
  if (typeof value === "string" && value.trim() !== "") {
    return BigInt(value.trim());
  }
  return 0n;
}

function resolveSignalInfo(signalMap, name) {
  const direct = signalMap.get(name);
  if (direct) {
    return direct;
  }
  const normalizedTarget = normalizeName(name);
  return [...signalMap.values()].find((item) =>
    item.aliases.some(
      (alias) =>
        normalizeName(alias) === normalizedTarget ||
        normalizeName(alias).endsWith(normalizedTarget),
    ),
  );
}

function mergeIntervals(intervals) {
  if (intervals.length === 0) {
    return [];
  }
  const sorted = [...intervals].sort((a, b) => Number(a.startNs - b.startNs));
  const merged = [sorted[0]];
  for (const current of sorted.slice(1)) {
    const previous = merged[merged.length - 1];
    if (current.startNs <= previous.endNs) {
      previous.endNs = previous.endNs > current.endNs ? previous.endNs : current.endNs;
      previous.reason = `${previous.reason}; ${current.reason}`;
      previous.signal = previous.signal === current.signal ? previous.signal : "Multiple";
      previous.topic = previous.topic === current.topic ? previous.topic : "Multiple";
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function intersectIntervals(left, right) {
  const results = [];
  const a = [...left].sort((x, y) => Number(x.startNs - y.startNs));
  const b = [...right].sort((x, y) => Number(x.startNs - y.startNs));
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = a[i].startNs > b[j].startNs ? a[i].startNs : b[j].startNs;
    const end = a[i].endNs < b[j].endNs ? a[i].endNs : b[j].endNs;
    if (start <= end) {
      results.push({
        startNs: start,
        endNs: end,
        signal: `${a[i].signal} & ${b[j].signal}`,
        topic: `${a[i].topic} & ${b[j].topic}`,
        reason: `${a[i].reason}; ${b[j].reason}`,
      });
    }
    if (a[i].endNs < b[j].endNs) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return results;
}

function nearestByTimestamp(rows, timestampNs, key = "timestampNs") {
  if (rows.length === 0) {
    return undefined;
  }
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid][key] < timestampNs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const exact = rows[low];
  const previous = rows[Math.max(0, low - 1)];
  const exactDelta = exact[key] > timestampNs ? exact[key] - timestampNs : timestampNs - exact[key];
  const previousDelta =
    previous[key] > timestampNs ? previous[key] - timestampNs : timestampNs - previous[key];
  return previousDelta < exactDelta ? previous : exact;
}

function attachCameraPreview(rows, scanData, cameraTopic) {
  if (!cameraTopic) {
    return rows;
  }
  const previews = scanData.cameraPreviews.get(cameraTopic) ?? [];
  if (previews.length === 0) {
    return rows;
  }
  return rows.map((row) => {
    const preview = nearestByTimestamp(previews, BigInt(row.timestampNs), "timestampNs");
    if (!preview) {
      return row;
    }
    const delta =
      preview.timestampNs > BigInt(row.timestampNs)
        ? preview.timestampNs - BigInt(row.timestampNs)
        : BigInt(row.timestampNs) - preview.timestampNs;
    if (delta > PREVIEW_DISTANCE_LIMIT_NS) {
      return row;
    }
    return {
      ...row,
      previewTopic: cameraTopic,
      previewTimestampNs: preview.timestampNs.toString(),
      previewImageDataUrl: preview.dataUrl,
    };
  });
}

async function loadIndexData(indexPath) {
  const stat = await fs.stat(indexPath);
  const cached = indexCache.get(indexPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.data;
  }

  const raw = await fs.readFile(indexPath, "utf8");
  const parsed = JSON.parse(raw);
  const data = {
    recordingName: parsed.recordingName ?? path.basename(indexPath),
    topics: parsed.topics ?? [],
    signals: parsed.signals ?? [],
    frames: (parsed.frames ?? []).map((frame, index) => {
      const timestampNs = BigInt(frame.timestampNs);
      return {
        frameIndex: frame.frameIndex ?? index,
        timestampNs,
        timestamp: nsToTime(timestampNs),
        topic: frame.topic,
        schemaName: frame.schemaName ?? "",
        signal: frame.signal ?? frame.topic,
      };
    }),
    signalSamples: new Map(
      Object.entries(parsed.signalSamples ?? {}).map(([key, samples]) => [
        key,
        samples.map((sample) => ({
          timestampNs: BigInt(sample.timestampNs),
          value: sample.value,
          topic: sample.topic,
          signal: sample.signal,
        })),
      ]),
    ),
    cameraPreviews: new Map(
      Object.entries(parsed.cameraPreviews ?? {}).map(([topic, previews]) => [
        topic,
        previews.map((preview) => ({
          timestampNs: BigInt(preview.timestampNs),
          dataUrl: preview.dataUrl,
        })),
      ]),
    ),
  };

  indexCache.set(indexPath, { mtimeMs: stat.mtimeMs, data });
  return data;
}

function evaluateCondition(condition, scanData, endTimeNs) {
  const signalMap = new Map(scanData.signals.map((item) => [item.key, item]));
  const signalInfo = resolveSignalInfo(signalMap, condition.signal);
  if (!signalInfo) {
    return [];
  }
  const series = scanData.signalSamples.get(signalInfo.key) ?? [];
  if (series.length === 0) {
    return [];
  }

  const minDurationNs =
    condition.durationSec.trim() === "" ? 0n : secondsToNs(Number(condition.durationSec.trim() || "0"));
  const comparisonValue = parseComparisonValue(condition.value.trim(), signalInfo.type);

  if (minDurationNs <= 0n) {
    return series
      .filter((sample) => compareValue(sample.value, condition.operator, comparisonValue))
      .map((sample) => ({
        startNs: sample.timestampNs,
        endNs: sample.timestampNs,
        signal: signalInfo.label,
        topic: sample.topic,
        reason: `${signalInfo.label} ${condition.operator}${condition.value ? ` ${condition.value}` : ""}`,
      }));
  }

  const intervals = [];
  let segmentStart;
  let segmentTopic = signalInfo.topic;

  series.forEach((sample, index) => {
    const nextTime = series[index + 1]?.timestampNs ?? endTimeNs;
    const matches = compareValue(sample.value, condition.operator, comparisonValue);
    if (matches && segmentStart == undefined) {
      segmentStart = sample.timestampNs;
      segmentTopic = sample.topic;
    }
    if (!matches && segmentStart != undefined) {
      const duration = sample.timestampNs - segmentStart;
      if (duration >= minDurationNs) {
        intervals.push({
          startNs: segmentStart,
          endNs: sample.timestampNs,
          signal: signalInfo.label,
          topic: segmentTopic,
          reason: `${signalInfo.label} ${condition.operator}${condition.value ? ` ${condition.value}` : ""} for ${condition.durationSec}s`,
        });
      }
      segmentStart = undefined;
    }
    if (matches && index === series.length - 1 && segmentStart != undefined) {
      const duration = nextTime - segmentStart;
      if (duration >= minDurationNs) {
        intervals.push({
          startNs: segmentStart,
          endNs: nextTime,
          signal: signalInfo.label,
          topic: segmentTopic,
          reason: `${signalInfo.label} ${condition.operator}${condition.value ? ` ${condition.value}` : ""} for ${condition.durationSec}s`,
        });
      }
    }
  });

  return intervals;
}

function intervalsToResults(scanData, intervals) {
  return mergeIntervals(intervals)
    .slice(0, 1000)
    .map((interval, index) => {
      const frame = nearestByTimestamp(scanData.frames, interval.startNs);
      return {
        id: `result-${index}-${interval.startNs.toString()}`,
        frameIndex: frame?.frameIndex,
        timestampNs: interval.startNs.toString(),
        timestamp: nsToTime(interval.startNs),
        topic: interval.topic,
        signal: interval.signal,
        reason: interval.reason,
        durationSec:
          interval.endNs > interval.startNs
            ? Number(interval.endNs - interval.startNs) / 1_000_000_000
            : undefined,
        recording: scanData.recordingName,
      };
    });
}

function deriveResults(scanData, conditions, endTimeNsValue, cameraTopic) {
  const endTimeNs =
    endTimeNsValue != undefined
      ? BigInt(endTimeNsValue)
      : (scanData.frames[scanData.frames.length - 1]?.timestampNs ?? 0n);
  const validConditions = (conditions ?? []).filter((condition) => condition.signal.trim() !== "");
  let rows;
  if (validConditions.length === 0) {
    rows = scanData.frames.slice(0, 300).map((frame) => ({
      id: `frame-${frame.frameIndex}`,
      frameIndex: frame.frameIndex,
      timestampNs: frame.timestampNs.toString(),
      timestamp: frame.timestamp,
      topic: frame.topic,
      signal: frame.signal,
      reason: "Indexed frame preview",
      recording: scanData.recordingName,
    }));
  } else {
    let combined = evaluateCondition(validConditions[0], scanData, endTimeNs);
    for (const condition of validConditions.slice(1)) {
      const next = evaluateCondition(condition, scanData, endTimeNs);
      combined = condition.join === "AND" ? intersectIntervals(combined, next) : mergeIntervals([...combined, ...next]);
    }
    rows = intervalsToResults(scanData, combined);
  }
  return attachCameraPreview(rows, scanData, cameraTopic);
}

function signalSeries(scanData, signalName) {
  const signalMap = new Map(scanData.signals.map((item) => [item.key, item]));
  const signalInfo = resolveSignalInfo(signalMap, signalName);
  if (!signalInfo) {
    return [];
  }
  return (scanData.signalSamples.get(signalInfo.key) ?? []).map((sample) => ({
    timestampNs: sample.timestampNs,
    value: sample.value,
    topic: sample.topic,
    signal: signalInfo.label,
    signalKey: signalInfo.key,
  }));
}

function valueAt(series, timestampNs) {
  if (series.length === 0) {
    return undefined;
  }
  let last = series[0].value;
  for (const sample of series) {
    if (sample.timestampNs > timestampNs) {
      break;
    }
    last = sample.value;
  }
  return last;
}

function findRanges(scanData, name, operator = "is active", value = "", minDurationSec = 0) {
  return evaluateCondition(
    {
      id: "snippet",
      join: "AND",
      signal: name,
      operator,
      value: String(value ?? ""),
      durationSec: minDurationSec > 0 ? String(minDurationSec) : "",
    },
    scanData,
    scanData.frames[scanData.frames.length - 1]?.timestampNs ?? 0n,
  ).map((range) => ({
    startNs: range.startNs.toString(),
    endNs: range.endNs.toString(),
    topic: range.topic,
    signal: range.signal,
    reason: range.reason,
  }));
}

function runSnippetSearch(scanData, snippet, cameraTopic) {
  const matches = [];
  const signalMap = new Map(scanData.signals.map((item) => [item.key, item]));
  const pushMatch = (startNs, endNs, reason, extra = {}) => {
    matches.push({
      startNs: timeToNsValue(startNs),
      endNs: timeToNsValue(endNs),
      reason,
      signal: extra.signal ?? "Snippet",
      topic: extra.topic ?? "Snippet",
    });
  };

  const context = {
    signals: () => scanData.signals,
    signal: (name) =>
      signalSeries(scanData, name).map((sample) => ({
        timestampNs: sample.timestampNs.toString(),
        value: sample.value,
        topic: sample.topic,
        signal: sample.signal,
      })),
    signalValue: (name, timestampNs) => valueAt(signalSeries(scanData, name), timeToNsValue(timestampNs)),
    signalActive: (name, timestampNs) => isTruthySignal(valueAt(signalSeries(scanData, name), timeToNsValue(timestampNs))),
    findRanges: (name, operator, value, minDurationSec) =>
      findRanges(scanData, name, operator, value, minDurationSec),
    match: (timestampNs, reason, extra) => pushMatch(timestampNs, timestampNs, reason, extra),
    matchRange: (startNs, endNs, reason, extra) => pushMatch(startNs, endNs, reason, extra),
    timeline: () => ({
      startNs: scanData.frames[0]?.timestampNs.toString() ?? "0",
      endNs: scanData.frames[scanData.frames.length - 1]?.timestampNs.toString() ?? "0",
      frameCount: scanData.frames.length,
      signalCount: scanData.signals.length,
    }),
    console: {
      log: (...args) => {
        if (args.length > 0) {
          console.log("[snippet]", ...args);
        }
      },
    },
    Math,
    Number,
    BigInt,
    String,
    Boolean,
    Array,
    JSON,
  };

  vm.createContext(context);
  const script = new vm.Script(`"use strict";\n${snippet}`);
  script.runInContext(context, { timeout: 750 });

  const rows = intervalsToResults(scanData, matches);
  return attachCameraPreview(rows, scanData, cameraTopic);
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findRecordingFiles(root) {
  const results = [];
  if (!(await fileExists(root))) {
    return results;
  }
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && (fullPath.toLowerCase().endsWith(".bag") || fullPath.toLowerCase().endsWith(".mcap"))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function topicSet(topics) {
  return new Set(
    [...topics].map((topic) => `${topic.name}::${topic.schemaName ?? topic.datatype ?? ""}`),
  );
}

async function getManifest(recordingPath) {
  if (manifestCache.has(recordingPath)) {
    return manifestCache.get(recordingPath);
  }
  const manifest = await readRecordingManifest(recordingPath);
  manifestCache.set(recordingPath, manifest);
  return manifest;
}

async function matchRecording(topics) {
  const target = topicSet(topics);
  let bestMatch;
  let bestScore = 0;
  for (const root of searchRoots) {
    const recordings = await findRecordingFiles(root);
    for (const recordingPath of recordings) {
      const manifest = await getManifest(recordingPath);
      const candidate = topicSet(manifest.topics);
      let overlap = 0;
      for (const item of target) {
        if (candidate.has(item)) {
          overlap += 1;
        }
      }
      const denominator = Math.max(target.size, candidate.size, 1);
      const score = overlap / denominator;
      if (overlap > 0 && score > bestScore) {
        bestScore = score;
        bestMatch = manifest;
      }
    }
  }
  return bestScore >= 0.6 ? bestMatch : undefined;
}

function responseHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    ...extra,
  };
}

function json(res, code, body) {
  res.writeHead(code, responseHeaders({ "content-type": "application/json" }));
  res.end(JSON.stringify(body));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    json(res, 400, { error: "Missing URL" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, responseHeaders());
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { ok: true, searchRoots, formats: ["bag", "mcap"], mcapSupported: true });
    return;
  }

  if (req.method === "POST" && req.url === "/match") {
    try {
      const body = await readRequestBody(req);
      const manifest = await matchRecording(body.topics ?? []);
      if (!manifest) {
        json(res, 404, {
          matched: false,
          message: "No matching indexed recording found in the helper search roots.",
        });
        return;
      }

      const outputPath = `${manifest.recordingPath}.cap-index.json`;
      const indexExists = await fileExists(outputPath);
      if (!indexExists) {
        await ensureSceneIndex(manifest.recordingPath, outputPath, ({ totalMessages, signalCount }) => {
          if (totalMessages % 10000 === 0) {
            console.log(
              `Indexing ${manifest.recordingName}: ${totalMessages} messages, ${signalCount} signals`,
            );
          }
        });
      }

      json(res, 200, {
        matched: true,
        recordingName: manifest.recordingName,
        recordingFormat: manifest.recordingFormat,
        indexName: path.basename(outputPath),
        indexPath: outputPath,
      });
      return;
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (req.method === "GET" && req.url.startsWith("/meta?path=")) {
    try {
      const targetPath = decodeURIComponent(req.url.slice("/meta?path=".length));
      const data = await loadIndexData(targetPath);
      json(res, 200, {
        recordingName: data.recordingName,
        topics: data.topics,
        cameraTopics: [...data.cameraPreviews.keys()],
        frames: data.frames.map((frame) => ({
          frameIndex: frame.frameIndex,
          timestampNs: frame.timestampNs.toString(),
          topic: frame.topic,
          schemaName: frame.schemaName,
          signal: frame.signal,
        })),
        signals: data.signals,
      });
      return;
    } catch (error) {
      json(res, 404, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/search") {
    try {
      const body = await readRequestBody(req);
      const data = await loadIndexData(body.indexPath);
      const results = deriveResults(data, body.conditions ?? [], body.endTimeNs, body.cameraTopic);
      json(res, 200, { results, recordingName: data.recordingName });
      return;
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/snippet-search") {
    try {
      const body = await readRequestBody(req);
      const data = await loadIndexData(body.indexPath);
      const results = runSnippetSearch(data, body.snippet ?? "", body.cameraTopic);
      json(res, 200, { results, recordingName: data.recordingName });
      return;
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  json(res, 404, { error: "Not found" });
});

server.listen(port, host, () => {
  console.log(`Scene index helper listening on http://${host}:${port}`);
  console.log(`Watching recording roots: ${searchRoots.join(", ")}`);
});
