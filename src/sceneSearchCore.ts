import { Immutable, MessageEvent, Time, Topic } from "@foxglove/extension";

export type Condition = {
  id: string;
  join: "AND" | "OR";
  signal: string;
  operator: "is active" | "is not active" | ">" | "<" | "==" | "!=";
  value: string;
  durationSec: string;
};

export type FrameRecord = {
  frameIndex: number;
  timestampNs: bigint;
  timestamp: Time;
  topic: string;
  schemaName: string;
  signal: string;
};

export type SignalInfo = {
  key: string;
  label: string;
  topic: string;
  path: string;
  type: string;
  sampleValue: string;
  aliases: string[];
};

type SignalSample = {
  timestampNs: bigint;
  value: unknown;
  topic: string;
  signal: string;
};

type CameraPreview = {
  timestampNs: bigint;
  dataUrl: string;
};

type Interval = {
  startNs: bigint;
  endNs: bigint;
  signal: string;
  topic: string;
  reason: string;
};

export type ResultRow = {
  id: string;
  frameIndex?: number;
  timestampNs: bigint;
  timestamp: Time;
  topic: string;
  signal: string;
  reason: string;
  durationSec?: number;
  recording: string;
  previewTopic?: string;
  previewTimestampNs?: string;
  previewImageDataUrl?: string;
};

export type ScanData = {
  topics: Immutable<Topic[]>;
  frames: FrameRecord[];
  signals: SignalInfo[];
  recordingName: string;
  cameraTopics: string[];
  signalSamples: Map<string, SignalSample[]>;
  cameraPreviews: Map<string, CameraPreview[]>;
};

type ScanBuilder = {
  ingestMessageEvent: (messageEvent: Immutable<MessageEvent>) => void;
  getMessageCount: () => number;
  finalize: () => ScanData;
};

const MAX_PREVIEW_FRAMES = 2000;
const PREVIEW_FRAME_INTERVAL = 50;
const LARGE_ARRAY_THRESHOLD = 8;
const LARGE_STRING_THRESHOLD = 160;
const CAMERA_PREVIEW_INTERVAL_NS = 2_000_000_000n;
const MAX_CAMERA_PREVIEWS_PER_TOPIC = 240;
const PREVIEW_DISTANCE_LIMIT_NS = 5_000_000_000n;

export function timeToNs(time: Time): bigint {
  return BigInt(time.sec) * 1_000_000_000n + BigInt(time.nsec);
}

function nsToTime(timestampNs: bigint): Time {
  return {
    sec: Number(timestampNs / 1_000_000_000n),
    nsec: Number(timestampNs % 1_000_000_000n),
  };
}

export function prettyTimestamp(time?: Time): string {
  if (!time) {
    return "-";
  }
  const ms = Math.floor(time.nsec / 1_000_000)
    .toString()
    .padStart(3, "0");
  return `${time.sec}.${ms}s`;
}

export function formatDuration(durationSec?: number): string {
  return durationSec == undefined
    ? "Instant"
    : `${durationSec.toFixed(durationSec >= 10 ? 1 : 2)}s`;
}

export function previewResults(scanData: ScanData): ResultRow[] {
  return scanData.frames.slice(0, 200).map((frame) => ({
    id: `frame-${frame.frameIndex}`,
    frameIndex: frame.frameIndex,
    timestampNs: frame.timestampNs,
    timestamp: frame.timestamp,
    topic: frame.topic,
    signal: frame.signal,
    reason: "Indexed frame preview",
    recording: scanData.recordingName,
  }));
}

function normalizeName(value: string): string {
  return value
    .replace(/^\//, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .toLowerCase();
}

function isTruthySignal(value: unknown): boolean {
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

function parseComparisonValue(raw: string, type: string): unknown {
  if (type === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (type === "boolean") {
    return raw.toLowerCase() === "true";
  }
  return raw;
}

function compareValue(left: unknown, operator: Condition["operator"], right: unknown): boolean {
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

function secondsToNs(value: number): bigint {
  return BigInt(Math.max(0, Math.round(value * 1_000_000_000)));
}

function sampleValueLabel(value: unknown): string {
  if (typeof value === "string") {
    return value.length > LARGE_STRING_THRESHOLD
      ? `${value.slice(0, LARGE_STRING_THRESHOLD)}...`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  return "Object";
}

function signalType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value == undefined) {
    return "unknown";
  }
  return typeof value;
}

function isBinaryLike(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isCompressedImageTopic(schemaName: string): boolean {
  return (
    schemaName === "sensor_msgs/CompressedImage" ||
    schemaName === "sensor_msgs/msg/CompressedImage" ||
    schemaName.endsWith("/CompressedImage")
  );
}

function compressedImageToDataUrl(message: unknown): string | undefined {
  if (message == undefined || typeof message !== "object") {
    return undefined;
  }
  const dataValue = (message as { data?: unknown }).data;
  const formatValue = (message as { format?: unknown }).format;
  const bytes =
    dataValue instanceof Uint8Array
      ? dataValue
      : Array.isArray(dataValue)
        ? Uint8Array.from(dataValue)
        : undefined;
  if (!bytes || bytes.length === 0) {
    return undefined;
  }
  const format = typeof formatValue === "string" ? formatValue.toLowerCase() : "";
  const mimeType = format.includes("png") ? "image/png" : "image/jpeg";
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function flattenMessage(
  value: unknown,
  basePath: string,
  push: (pathName: string, primitive: unknown) => void,
): void {
  if (value == undefined) {
    push(basePath, value);
    return;
  }
  if (isBinaryLike(value)) {
    push(`${basePath}.length`, value.length);
    return;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    push(basePath, value);
    return;
  }
  if (typeof value === "bigint") {
    push(basePath, Number(value));
    return;
  }
  if (typeof value === "string") {
    push(
      basePath,
      value.length > LARGE_STRING_THRESHOLD ? value.slice(0, LARGE_STRING_THRESHOLD) : value,
    );
    return;
  }
  if (Array.isArray(value)) {
    push(`${basePath}.length`, value.length);
    if (value.length <= LARGE_ARRAY_THRESHOLD) {
      value.forEach((item, index) => {
        flattenMessage(item, `${basePath}[${index}]`, push);
      });
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = basePath ? `${basePath}.${key}` : key;
      if (
        next === "header.seq" ||
        next === "header.frame_id" ||
        next === "header.stamp" ||
        next === "header.stamp.sec" ||
        next === "header.stamp.nsec" ||
        next === "header.stamp.nanosec"
      ) {
        continue;
      }
      flattenMessage(child, next, push);
    }
  }
}

export function createScanBuilder(
  topics: Immutable<Topic[]>,
  recordingName = "Opened recording",
): ScanBuilder {
  const signalInfoMap = new Map<string, SignalInfo>();
  const signalSamples = new Map<string, SignalSample[]>();
  const previewFrames: FrameRecord[] = [];
  const cameraPreviews = new Map<string, CameraPreview[]>();
  const lastCameraPreviewNs = new Map<string, bigint>();
  let totalMessages = 0;

  const addSignal = (topic: string, pathName: string, value: unknown, timestampNs: bigint) => {
    const key = `${topic}.${pathName}`;
    const aliases = [key, pathName, `/${pathName}`, key.replace(/^\//, ""), normalizeName(key)];
    if (!signalInfoMap.has(key)) {
      signalInfoMap.set(key, {
        key,
        label: pathName,
        topic,
        path: pathName,
        type: signalType(value),
        sampleValue: sampleValueLabel(value),
        aliases,
      });
    }

    const bucket = signalSamples.get(key) ?? [];
    const last = bucket[bucket.length - 1];
    if (last && last.value === value) {
      return;
    }

    bucket.push({
      timestampNs,
      value,
      topic,
      signal: pathName,
    });
    signalSamples.set(key, bucket);
  };

  return {
    ingestMessageEvent(messageEvent) {
      totalMessages += 1;
      const timestamp = messageEvent.publishTime ?? messageEvent.receiveTime;
      const timestampNs = timeToNs(timestamp);

      if (
        previewFrames.length < MAX_PREVIEW_FRAMES &&
        (totalMessages <= 25 || totalMessages % PREVIEW_FRAME_INTERVAL === 0)
      ) {
        previewFrames.push({
          frameIndex: previewFrames.length,
          timestampNs,
          timestamp,
          topic: messageEvent.topic,
          schemaName: messageEvent.schemaName,
          signal: messageEvent.topic,
        });
      }

      if (isCompressedImageTopic(messageEvent.schemaName)) {
        const previews = cameraPreviews.get(messageEvent.topic) ?? [];
        const lastPreview = lastCameraPreviewNs.get(messageEvent.topic);
        if (
          previews.length < MAX_CAMERA_PREVIEWS_PER_TOPIC &&
          (lastPreview == undefined || timestampNs - lastPreview >= CAMERA_PREVIEW_INTERVAL_NS)
        ) {
          const dataUrl = compressedImageToDataUrl(messageEvent.message);
          if (dataUrl) {
            previews.push({ timestampNs, dataUrl });
            cameraPreviews.set(messageEvent.topic, previews);
            lastCameraPreviewNs.set(messageEvent.topic, timestampNs);
          }
        }
      }

      flattenMessage(messageEvent.message, "", (pathName, primitive) => {
        if (!pathName) {
          return;
        }
        addSignal(messageEvent.topic, pathName, primitive, timestampNs);
      });
    },
    getMessageCount() {
      return totalMessages;
    },
    finalize() {
      const frames = [...previewFrames]
        .sort((left, right) => Number(left.timestampNs - right.timestampNs))
        .map((frame, index) => ({
          ...frame,
          frameIndex: index,
          timestamp: nsToTime(frame.timestampNs),
        }));

      const sortedSignalSamples = new Map(
        [...signalSamples.entries()].map(([key, samples]) => [
          key,
          [...samples].sort((left, right) => Number(left.timestampNs - right.timestampNs)),
        ]),
      );

      const sortedCameraPreviews = new Map(
        [...cameraPreviews.entries()].map(([topic, previews]) => [
          topic,
          [...previews].sort((left, right) => Number(left.timestampNs - right.timestampNs)),
        ]),
      );

      return {
        topics,
        frames,
        signals: [...signalInfoMap.values()].sort((left, right) =>
          left.key.localeCompare(right.key),
        ),
        recordingName,
        cameraTopics: [...sortedCameraPreviews.keys()].sort((left, right) =>
          left.localeCompare(right),
        ),
        signalSamples: sortedSignalSamples,
        cameraPreviews: sortedCameraPreviews,
      };
    },
  };
}

function resolveSignalInfo(
  signalMap: Map<string, SignalInfo>,
  name: string,
): SignalInfo | undefined {
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

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) {
    return [];
  }
  const sorted = [...intervals].sort((left, right) => Number(left.startNs - right.startNs));
  const merged = [{ ...sorted[0]! }];
  for (const current of sorted.slice(1)) {
    const previous = merged[merged.length - 1]!;
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

function intersectIntervals(left: Interval[], right: Interval[]): Interval[] {
  const results: Interval[] = [];
  const a = [...left].sort((x, y) => Number(x.startNs - y.startNs));
  const b = [...right].sort((x, y) => Number(x.startNs - y.startNs));
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = a[i]!.startNs > b[j]!.startNs ? a[i]!.startNs : b[j]!.startNs;
    const end = a[i]!.endNs < b[j]!.endNs ? a[i]!.endNs : b[j]!.endNs;
    if (start <= end) {
      results.push({
        startNs: start,
        endNs: end,
        signal: `${a[i]!.signal} & ${b[j]!.signal}`,
        topic: `${a[i]!.topic} & ${b[j]!.topic}`,
        reason: `${a[i]!.reason}; ${b[j]!.reason}`,
      });
    }
    if (a[i]!.endNs < b[j]!.endNs) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return results;
}

function nearestByTimestamp<T extends { timestampNs: bigint }>(
  rows: T[],
  timestampNs: bigint,
): T | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid]!.timestampNs < timestampNs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const exact = rows[low]!;
  const previous = rows[Math.max(0, low - 1)]!;
  const exactDelta =
    exact.timestampNs > timestampNs
      ? exact.timestampNs - timestampNs
      : timestampNs - exact.timestampNs;
  const previousDelta =
    previous.timestampNs > timestampNs
      ? previous.timestampNs - timestampNs
      : timestampNs - previous.timestampNs;
  return previousDelta < exactDelta ? previous : exact;
}

function attachCameraPreview(
  rows: ResultRow[],
  scanData: ScanData,
  cameraTopic: string,
): ResultRow[] {
  if (!cameraTopic) {
    return rows;
  }
  const previews = scanData.cameraPreviews.get(cameraTopic) ?? [];
  if (previews.length === 0) {
    return rows;
  }
  return rows.map((row) => {
    const preview = nearestByTimestamp(previews, row.timestampNs);
    if (!preview) {
      return row;
    }
    const delta =
      preview.timestampNs > row.timestampNs
        ? preview.timestampNs - row.timestampNs
        : row.timestampNs - preview.timestampNs;
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

function evaluateCondition(
  condition: Condition,
  scanData: ScanData,
  endTimeNs: bigint,
): Interval[] {
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
    condition.durationSec.trim() === ""
      ? 0n
      : secondsToNs(Number(condition.durationSec.trim() || "0"));
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

  const intervals: Interval[] = [];
  let segmentStart: bigint | undefined;
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

function intervalsToResults(scanData: ScanData, intervals: Interval[]): ResultRow[] {
  return mergeIntervals(intervals)
    .slice(0, 1000)
    .map((interval, index) => {
      const frame = nearestByTimestamp(scanData.frames, interval.startNs);
      return {
        id: `result-${index}-${interval.startNs.toString()}`,
        frameIndex: frame?.frameIndex,
        timestampNs: interval.startNs,
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

export function deriveResults(
  scanData: ScanData,
  conditions: Condition[],
  endTimeNsValue: bigint | undefined,
  cameraTopic: string,
): ResultRow[] {
  const endTimeNs =
    endTimeNsValue ?? scanData.frames[scanData.frames.length - 1]?.timestampNs ?? 0n;
  const validConditions = conditions.filter((condition) => condition.signal.trim() !== "");
  let rows: ResultRow[];

  if (validConditions.length === 0) {
    rows = scanData.frames.slice(0, 300).map((frame) => ({
      id: `frame-${frame.frameIndex}`,
      frameIndex: frame.frameIndex,
      timestampNs: frame.timestampNs,
      timestamp: frame.timestamp,
      topic: frame.topic,
      signal: frame.signal,
      reason: "Indexed frame preview",
      recording: scanData.recordingName,
    }));
  } else {
    let combined = evaluateCondition(validConditions[0]!, scanData, endTimeNs);
    for (const condition of validConditions.slice(1)) {
      const next = evaluateCondition(condition, scanData, endTimeNs);
      combined =
        condition.join === "AND"
          ? intersectIntervals(combined, next)
          : mergeIntervals([...combined, ...next]);
    }
    rows = intervalsToResults(scanData, combined);
  }

  return attachCameraPreview(rows, scanData, cameraTopic);
}

function signalSeries(scanData: ScanData, signalName: string) {
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

function valueAt(
  series: Array<{ timestampNs: bigint; value: unknown }>,
  timestampNs: bigint,
): unknown {
  if (series.length === 0) {
    return undefined;
  }
  let last = series[0]!.value;
  for (const sample of series) {
    if (sample.timestampNs > timestampNs) {
      break;
    }
    last = sample.value;
  }
  return last;
}

function findRanges(
  scanData: ScanData,
  name: string,
  operator: Condition["operator"] = "is active",
  value: string | number | boolean = "",
  minDurationSec = 0,
) {
  return evaluateCondition(
    {
      id: "snippet",
      join: "AND",
      signal: name,
      operator,
      value: String(value),
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

export function runSnippetSearch(
  scanData: ScanData,
  snippet: string,
  cameraTopic: string,
): ResultRow[] {
  const matches: Interval[] = [];
  const pushMatch = (
    startNs: string | number | bigint,
    endNs: string | number | bigint,
    reason: string,
    extra: { signal?: string; topic?: string } = {},
  ) => {
    matches.push({
      startNs: BigInt(startNs),
      endNs: BigInt(endNs),
      reason,
      signal: extra.signal ?? "Snippet",
      topic: extra.topic ?? "Snippet",
    });
  };

  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
  const execute = new Function(
    "signals",
    "signal",
    "signalValue",
    "signalActive",
    "findRanges",
    "match",
    "matchRange",
    "timeline",
    "console",
    "Math",
    "Number",
    "BigInt",
    "String",
    "Boolean",
    "Array",
    "JSON",
    `"use strict";\n${snippet}`,
  ) as (
    signals: () => SignalInfo[],
    signal: (
      name: string,
    ) => Array<{ timestampNs: string; value: unknown; topic: string; signal: string }>,
    signalValue: (name: string, timestampNs: string | number | bigint) => unknown,
    signalActive: (name: string, timestampNs: string | number | bigint) => boolean,
    findRanges: (
      name: string,
      operator?: Condition["operator"],
      value?: string | number | boolean,
      minDurationSec?: number,
    ) => Array<{ startNs: string; endNs: string; topic: string; signal: string; reason: string }>,
    match: (
      timestampNs: string | number | bigint,
      reason: string,
      extra?: { signal?: string; topic?: string },
    ) => void,
    matchRange: (
      startNs: string | number | bigint,
      endNs: string | number | bigint,
      reason: string,
      extra?: { signal?: string; topic?: string },
    ) => void,
    timeline: () => { startNs: string; endNs: string; frameCount: number; signalCount: number },
    console: { log: (...args: unknown[]) => void },
    Math: Math,
    Number: NumberConstructor,
    BigInt: BigIntConstructor,
    String: StringConstructor,
    Boolean: BooleanConstructor,
    Array: ArrayConstructor,
    JSON: JSON,
  ) => void;

  execute(
    () => scanData.signals,
    (name) =>
      signalSeries(scanData, name).map((sample) => ({
        timestampNs: sample.timestampNs.toString(),
        value: sample.value,
        topic: sample.topic,
        signal: sample.signal,
      })),
    (name, timestampNs) => valueAt(signalSeries(scanData, name), BigInt(timestampNs)),
    (name, timestampNs) =>
      isTruthySignal(valueAt(signalSeries(scanData, name), BigInt(timestampNs))),
    (name, operator, value, minDurationSec) =>
      findRanges(scanData, name, operator, value ?? "", minDurationSec),
    (timestampNs, reason, extra) => {
      pushMatch(timestampNs, timestampNs, reason, extra);
    },
    (startNs, endNs, reason, extra) => {
      pushMatch(startNs, endNs, reason, extra);
    },
    () => ({
      startNs: scanData.frames[0]?.timestampNs.toString() ?? "0",
      endNs: scanData.frames[scanData.frames.length - 1]?.timestampNs.toString() ?? "0",
      frameCount: scanData.frames.length,
      signalCount: scanData.signals.length,
    }),
    {
      log: (...args: unknown[]) => {
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
  );

  return attachCameraPreview(intervalsToResults(scanData, matches), scanData, cameraTopic);
}
