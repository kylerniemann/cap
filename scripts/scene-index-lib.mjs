import fs from "node:fs/promises";
import path from "node:path";

import { parseRos2idl } from "@foxglove/ros2idl-parser";
import { parse as parseRosMessage } from "@foxglove/rosmsg";
import { MessageReader as Ros1MessageReader } from "@foxglove/rosmsg-serialization";
import { MessageReader as Ros2MessageReader } from "@foxglove/rosmsg2-serialization";
import { McapIndexedReader } from "@mcap/core";
import { FileHandleReadable } from "@mcap/nodejs";
import { loadDecompressHandlers, protobufFromBinaryDescriptor } from "@mcap/support";
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
const decoderText = new TextDecoder();
let mcapDecompressHandlersPromise;

function timeToNsString(time) {
  return (BigInt(time.sec) * 1000000000n + BigInt(time.nsec)).toString();
}

function nsToRosTime(timestampNs) {
  return {
    sec: Number(timestampNs / 1000000000n),
    nsec: Number(timestampNs % 1000000000n),
  };
}

function normalizeName(value) {
  return value.replace(/^\//, "").replace(/\[(\d+)\]/g, ".$1").toLowerCase();
}

function normalizeTopicEntry(name, schemaName) {
  return {
    name,
    schemaName: schemaName ?? "",
  };
}

function normalizeBagTopics(connections) {
  const deduped = new Map();
  for (const connection of Object.values(connections)) {
    const key = `${connection.topic}::${connection.type ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, normalizeTopicEntry(connection.topic, connection.type ?? ""));
    }
  }
  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeMcapTopics(reader) {
  const deduped = new Map();
  for (const channel of reader.channelsById.values()) {
    const schema = channel.schemaId === 0 ? undefined : reader.schemasById.get(channel.schemaId);
    const schemaName = schema?.name ?? channel.metadata.get("type") ?? "";
    const key = `${channel.topic}::${schemaName}`;
    if (!deduped.has(key)) {
      deduped.set(key, normalizeTopicEntry(channel.topic, schemaName));
    }
  }
  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function isCompressedImageTopic(schemaName) {
  return (
    schemaName === "foxglove.CompressedImage" ||
    schemaName === "foxglove_msgs/CompressedImage" ||
    schemaName === "foxglove_msgs/msg/CompressedImage" ||
    schemaName === "sensor_msgs/CompressedImage" ||
    schemaName === "sensor_msgs/msg/CompressedImage" ||
    schemaName.endsWith("/CompressedImage")
  );
}

function compressedImageToDataUrl(message) {
  const buffer =
    message?.data instanceof Uint8Array || Buffer.isBuffer(message?.data)
      ? Buffer.from(message.data)
      : Array.isArray(message?.data)
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
  if (typeof value === "bigint") {
    push(basePath, Number(value));
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

function recordingFormat(inputPath) {
  const lower = inputPath.toLowerCase();
  if (lower.endsWith(".bag")) {
    return "bag";
  }
  if (lower.endsWith(".mcap")) {
    return "mcap";
  }
  throw new Error(`Unsupported recording format for ${inputPath}`);
}

function outputIndexBase(indexFormatVersion, inputPath, format) {
  return {
    version: indexFormatVersion,
    recordingName: path.basename(inputPath),
    sourceRecordingPath: inputPath,
    recordingFormat: format,
  };
}

async function getMcapDecompressHandlers() {
  mcapDecompressHandlersPromise ??= loadDecompressHandlers();
  return mcapDecompressHandlersPromise;
}

async function openMcapReader(inputPath) {
  const fileHandle = await fs.open(inputPath, "r");
  try {
    const reader = await McapIndexedReader.Initialize({
      readable: new FileHandleReadable(fileHandle),
      decompressHandlers: await getMcapDecompressHandlers(),
    });
    return { fileHandle, reader };
  } catch (error) {
    await fileHandle.close();
    throw error;
  }
}

function schemaDefinitionText(schema) {
  if (!schema?.data || schema.data.length === 0) {
    return undefined;
  }
  return decoderText.decode(schema.data);
}

function rootTypeName(name) {
  return name.replace(/^\./, "").replace(/\//g, ".");
}

function protobufTypeCandidates(name) {
  const normalized = rootTypeName(name);
  const slashless = name.replace(/^\./, "");
  const basename = normalized.split(".").at(-1);
  return [...new Set([normalized, `.${normalized}`, slashless, basename].filter(Boolean))];
}

function createProtobufReader(schema) {
  if (!schema?.data || schema.data.length === 0) {
    return undefined;
  }
  const root = protobufFromBinaryDescriptor(schema.data);
  const type =
    protobufTypeCandidates(schema.name)
      .map((candidate) => {
        try {
          return root.lookupType(candidate);
        } catch {
          return undefined;
        }
      })
      .find(Boolean) ?? undefined;
  if (!type) {
    return undefined;
  }
  return {
    readMessage(buffer) {
      const message = type.decode(buffer);
      return type.toObject(message, {
        enums: String,
        longs: String,
        bytes: Array,
        defaults: false,
        arrays: true,
        objects: true,
      });
    },
  };
}

function createMessageReader(schema, messageEncoding) {
  const definition = schemaDefinitionText(schema);
  if (schema?.encoding === "ros1msg" && messageEncoding === "ros1" && definition) {
    return new Ros1MessageReader(parseRosMessage(definition, { ros2: false }));
  }
  if (schema?.encoding === "ros2msg" && messageEncoding === "cdr" && definition) {
    return new Ros2MessageReader(parseRosMessage(definition, { ros2: true }), { timeType: "sec,nsec" });
  }
  if (schema?.encoding === "ros2idl" && messageEncoding === "cdr" && definition) {
    return new Ros2MessageReader(parseRos2idl(definition), { timeType: "sec,nsec" });
  }
  if (schema?.encoding === "protobuf" && messageEncoding === "protobuf") {
    return createProtobufReader(schema);
  }
  return undefined;
}

function decodeMcapPayload(channel, schema, message, readerCache) {
  if (channel.messageEncoding === "json") {
    return JSON.parse(decoderText.decode(message.data));
  }
  if (channel.messageEncoding === "protobuf" && schema?.encoding === "jsonschema") {
    return undefined;
  }
  if (channel.messageEncoding === "json" && (!schema || schema.encoding === "" || schema.encoding === "jsonschema")) {
    return JSON.parse(decoderText.decode(message.data));
  }

  const readerKey = `${schema?.id ?? 0}:${schema?.encoding ?? ""}:${channel.messageEncoding}`;
  let reader = readerCache.get(readerKey);
  if (reader === null) {
    return undefined;
  }
  if (!reader) {
    try {
      reader = createMessageReader(schema, channel.messageEncoding);
    } catch {
      reader = undefined;
    }
    readerCache.set(readerKey, reader ?? null);
  }
  if (!reader) {
    return undefined;
  }
  return reader.readMessage(message.data);
}

function createIndexCollectors(topics, recordingName) {
  const signalInfoMap = new Map();
  const signalSamplesMap = new Map();
  const previewFrames = [];
  const cameraPreviewMap = new Map();
  const lastCameraPreviewNs = new Map();

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

  const ingestDecodedMessage = ({ topic, schemaName, message, timestampNs, totalMessages }) => {
    if (
      previewFrames.length < MAX_PREVIEW_FRAMES &&
      (totalMessages <= 25 || totalMessages % PREVIEW_FRAME_INTERVAL === 0)
    ) {
      previewFrames.push({
        frameIndex: previewFrames.length,
        timestampNs,
        topic,
        schemaName: schemaName ?? "unknown",
        signal: topic,
      });
    }

    if (schemaName && isCompressedImageTopic(schemaName)) {
      const timestampBigInt = BigInt(timestampNs);
      const previews = cameraPreviewMap.get(topic) ?? [];
      const lastPreview = lastCameraPreviewNs.get(topic);
      if (
        previews.length < MAX_CAMERA_PREVIEWS_PER_TOPIC &&
        (lastPreview == undefined || timestampBigInt - lastPreview >= CAMERA_PREVIEW_INTERVAL_NS)
      ) {
        const dataUrl = compressedImageToDataUrl(message);
        if (dataUrl) {
          previews.push({
            timestampNs,
            dataUrl,
          });
          cameraPreviewMap.set(topic, previews);
          lastCameraPreviewNs.set(topic, timestampBigInt);
        }
      }
    }

    flattenMessage(message, "", (pathName, primitive) => {
      if (!pathName) {
        return;
      }
      addSignal(topic, pathName, primitive, timestampNs);
    });
  };

  const finalize = (inputPath, format, totalMessages, startTime, endTime) => ({
    ...outputIndexBase(2, inputPath, format),
    recordingName,
    totalMessages,
    startTime,
    endTime,
    topics,
    frames: previewFrames,
    signals: [...signalInfoMap.values()].sort((left, right) => left.key.localeCompare(right.key)),
    cameraPreviews: Object.fromEntries([...cameraPreviewMap.entries()]),
    signalSamples: Object.fromEntries([...signalSamplesMap.entries()].map(([key, samples]) => [key, samples])),
  });

  return {
    ingestDecodedMessage,
    finalize,
    signalInfoMap,
  };
}

async function buildBagSceneIndex(inputPath, outputPath, onProgress) {
  const bag = await open(inputPath);
  const topics = normalizeBagTopics(bag.connections);
  const collectors = createIndexCollectors(topics, path.basename(inputPath));
  let totalMessages = 0;

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
      const schemaName = topics.find((topic) => topic.name === result.topic)?.schemaName ?? "unknown";

      collectors.ingestDecodedMessage({
        topic: result.topic,
        schemaName,
        message: result.message,
        timestampNs,
        totalMessages,
      });

      onProgress?.({
        totalMessages,
        signalCount: collectors.signalInfoMap.size,
      });
    },
  );

  const index = collectors.finalize(
    inputPath,
    "bag",
    totalMessages,
    bag.startTime ? timeToNsString(bag.startTime) : undefined,
    bag.endTime ? timeToNsString(bag.endTime) : undefined,
  );

  await fs.writeFile(outputPath, JSON.stringify(index));
  return {
    index,
    outputPath,
  };
}

async function buildMcapSceneIndex(inputPath, outputPath, onProgress) {
  const { fileHandle, reader } = await openMcapReader(inputPath);
  try {
    const topics = normalizeMcapTopics(reader);
    const schemaNameByTopic = new Map(topics.map((topic) => [topic.name, topic.schemaName]));
    const collectors = createIndexCollectors(topics, path.basename(inputPath));
    const decoderCache = new Map();
    let totalMessages = 0;

    for await (const message of reader.readMessages()) {
      totalMessages += 1;
      const channel = reader.channelsById.get(message.channelId);
      if (!channel) {
        continue;
      }
      const schema = channel.schemaId === 0 ? undefined : reader.schemasById.get(channel.schemaId);
      let decodedMessage;
      try {
        decodedMessage = decodeMcapPayload(channel, schema, message, decoderCache);
      } catch {
        decodedMessage = undefined;
      }
      if (decodedMessage == undefined) {
        continue;
      }

      collectors.ingestDecodedMessage({
        topic: channel.topic,
        schemaName: schemaNameByTopic.get(channel.topic) ?? schema?.name ?? "",
        message: decodedMessage,
        timestampNs: message.logTime.toString(),
        totalMessages,
      });

      onProgress?.({
        totalMessages,
        signalCount: collectors.signalInfoMap.size,
      });
    }

    const index = collectors.finalize(
      inputPath,
      "mcap",
      totalMessages,
      reader.statistics?.messageStartTime?.toString(),
      reader.statistics?.messageEndTime?.toString(),
    );

    await fs.writeFile(outputPath, JSON.stringify(index));
    return {
      index,
      outputPath,
    };
  } finally {
    await fileHandle.close();
  }
}

export async function readRecordingManifest(inputPath) {
  const format = recordingFormat(inputPath);
  if (format === "bag") {
    const bag = await open(inputPath);
    return {
      recordingPath: inputPath,
      recordingFormat: "bag",
      recordingName: path.basename(inputPath),
      startTime: bag.startTime ? timeToNsString(bag.startTime) : undefined,
      endTime: bag.endTime ? timeToNsString(bag.endTime) : undefined,
      topics: normalizeBagTopics(bag.connections),
    };
  }

  const { fileHandle, reader } = await openMcapReader(inputPath);
  try {
    return {
      recordingPath: inputPath,
      recordingFormat: "mcap",
      recordingName: path.basename(inputPath),
      startTime: reader.statistics?.messageStartTime?.toString(),
      endTime: reader.statistics?.messageEndTime?.toString(),
      topics: normalizeMcapTopics(reader),
    };
  } finally {
    await fileHandle.close();
  }
}

export async function buildSceneIndex(inputPath, outputPath, onProgress) {
  return recordingFormat(inputPath) === "bag"
    ? buildBagSceneIndex(inputPath, outputPath, onProgress)
    : buildMcapSceneIndex(inputPath, outputPath, onProgress);
}

export async function ensureSceneIndex(inputPath, outputPath, onProgress) {
  const recordingStat = await fs.stat(inputPath);
  try {
    const indexStat = await fs.stat(outputPath);
    if (indexStat.mtimeMs >= recordingStat.mtimeMs) {
      return { outputPath, reused: true };
    }
  } catch {
    // Missing index, build it below.
  }

  await buildSceneIndex(inputPath, outputPath, onProgress);
  return { outputPath, reused: false };
}

export { nsToRosTime };
