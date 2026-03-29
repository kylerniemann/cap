import fs from "node:fs/promises";
import path from "node:path";

import compressjs from "compressjs";
import lz4 from "lz4js";
import rosbag from "rosbag";

const { open } = rosbag;

const MAX_PREVIEW_FRAMES = 2000;
const PREVIEW_FRAME_INTERVAL = 50;
const LARGE_ARRAY_THRESHOLD = 8;
const LARGE_STRING_THRESHOLD = 160;
const CAMERA_PREVIEW_INTERVAL_NS = 2_000_000_000n;
const MAX_CAMERA_PREVIEWS_PER_TOPIC = 240;

function timeToNsString(time) {
  return (BigInt(time.sec) * 1000000000n + BigInt(time.nsec)).toString();
}

function normalizeName(value) {
  return value.replace(/^\//, "").replace(/\[(\d+)\]/g, ".$1").toLowerCase();
}

function normalizeTopics(connections) {
  const deduped = new Map();
  for (const connection of Object.values(connections)) {
    const key = `${connection.topic}::${connection.type ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        name: connection.topic,
        schemaName: connection.type ?? "",
      });
    }
  }
  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function isCompressedImageTopic(schemaName) {
  return schemaName === "sensor_msgs/CompressedImage";
}

function compressedImageToDataUrl(message) {
  const buffer =
    message?.data instanceof Uint8Array || Buffer.isBuffer(message?.data)
      ? Buffer.from(message.data)
      : undefined;
  if (!buffer || buffer.length === 0) {
    return undefined;
  }
  const format = typeof message?.format === "string" ? message.format.toLowerCase() : "";
  const mimeType = format.includes("png") ? "image/png" : "image/jpeg";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function sampleValueLabel(value) {
  if (typeof value === "string") {
    return value.length > LARGE_STRING_THRESHOLD ? `${value.slice(0, LARGE_STRING_THRESHOLD)}...` : value;
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

function signalType(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value == undefined) {
    return "unknown";
  }
  return typeof value;
}

function isBinaryLike(value) {
  return value instanceof Uint8Array || Buffer.isBuffer(value);
}

function flattenMessage(value, basePath, push) {
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
  if (typeof value === "string") {
    push(basePath, value.length > LARGE_STRING_THRESHOLD ? value.slice(0, LARGE_STRING_THRESHOLD) : value);
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
    for (const [key, child] of Object.entries(value)) {
      const next = basePath ? `${basePath}.${key}` : key;
      if (next === "header.seq" || next === "header.frame_id" || next === "header.stamp") {
        continue;
      }
      flattenMessage(child, next, push);
    }
  }
}

export async function readBagManifest(inputPath) {
  const bag = await open(inputPath);
  const topics = normalizeTopics(bag.connections);
  return {
    bagPath: inputPath,
    recordingName: path.basename(inputPath),
    startTime: bag.startTime ? timeToNsString(bag.startTime) : undefined,
    endTime: bag.endTime ? timeToNsString(bag.endTime) : undefined,
    topics,
  };
}

export async function buildSceneIndex(inputPath, outputPath, onProgress) {
  const bag = await open(inputPath);
  const topics = normalizeTopics(bag.connections);

  const signalInfoMap = new Map();
  const signalSamplesMap = new Map();
  const previewFrames = [];
  const cameraPreviewMap = new Map();
  const lastCameraPreviewNs = new Map();
  let totalMessages = 0;

  const addSignal = (topic, pathName, value, timestampNs) => {
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

    const bucket = signalSamplesMap.get(key) ?? [];
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
    signalSamplesMap.set(key, bucket);
  };

  await bag.readMessages(
    {
      decompress: {
        bz2: (buffer) => Buffer.from(compressjs.Bzip2.decompressFile(buffer)),
        lz4: (buffer) => Buffer.from(lz4.decompress(buffer)),
      },
    },
    (result) => {
      totalMessages += 1;
      const timestampNs = timeToNsString(result.timestamp);
      if (
        previewFrames.length < MAX_PREVIEW_FRAMES &&
        (totalMessages <= 25 || totalMessages % PREVIEW_FRAME_INTERVAL === 0)
      ) {
        previewFrames.push({
          frameIndex: previewFrames.length,
          timestampNs,
          topic: result.topic,
          schemaName: topics.find((topic) => topic.name === result.topic)?.schemaName ?? "unknown",
          signal: result.topic,
        });
      }

      const topicInfo = topics.find((topic) => topic.name === result.topic);
      if (topicInfo && isCompressedImageTopic(topicInfo.schemaName)) {
        const timestampBigInt = BigInt(timestampNs);
        const previews = cameraPreviewMap.get(result.topic) ?? [];
        const lastPreview = lastCameraPreviewNs.get(result.topic);
        if (
          previews.length < MAX_CAMERA_PREVIEWS_PER_TOPIC &&
          (lastPreview == undefined || timestampBigInt - lastPreview >= CAMERA_PREVIEW_INTERVAL_NS)
        ) {
          const dataUrl = compressedImageToDataUrl(result.message);
          if (dataUrl) {
            previews.push({
              timestampNs,
              dataUrl,
            });
            cameraPreviewMap.set(result.topic, previews);
            lastCameraPreviewNs.set(result.topic, timestampBigInt);
          }
        }
      }

      flattenMessage(result.message, "", (pathName, primitive) => {
        if (!pathName) {
          return;
        }
        addSignal(result.topic, pathName, primitive, timestampNs);
      });

      onProgress?.({
        totalMessages,
        signalCount: signalInfoMap.size,
      });
    },
  );

  const index = {
    version: 1,
    recordingName: path.basename(inputPath),
    sourceBagPath: inputPath,
    totalMessages,
    startTime: bag.startTime ? timeToNsString(bag.startTime) : undefined,
    endTime: bag.endTime ? timeToNsString(bag.endTime) : undefined,
    topics,
    frames: previewFrames,
    signals: [...signalInfoMap.values()].sort((left, right) => left.key.localeCompare(right.key)),
    cameraPreviews: Object.fromEntries([...cameraPreviewMap.entries()]),
    signalSamples: Object.fromEntries([...signalSamplesMap.entries()].map(([key, samples]) => [key, samples])),
  };

  await fs.writeFile(outputPath, JSON.stringify(index));
  return {
    index,
    outputPath,
  };
}

export async function ensureSceneIndex(inputPath, outputPath, onProgress) {
  const bagStat = await fs.stat(inputPath);
  try {
    const indexStat = await fs.stat(outputPath);
    if (indexStat.mtimeMs >= bagStat.mtimeMs) {
      return { outputPath, reused: true };
    }
  } catch {
    // Missing index, build it below.
  }

  await buildSceneIndex(inputPath, outputPath, onProgress);
  return { outputPath, reused: false };
}
