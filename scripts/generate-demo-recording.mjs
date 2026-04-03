import fs from "node:fs/promises";
import path from "node:path";

import { McapWriter } from "@mcap/core";
import { FileHandleWritable } from "@mcap/nodejs";

const outputArg = process.argv[2];
const outputPath = path.resolve(process.cwd(), outputArg ?? "demo/cap-demo-recording.mcap");
const recordingStartNs = 1_730_000_000_000_000_000n;
const tickNs = 1_000_000_000n;
const imageIntervalSec = 5;

const pngFrames = [
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2tQHsAAAAASUVORK5CYII=",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAusB9Ycsg2sAAAAASUVORK5CYII=",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8zwAAAgEBAPeKk3sAAAAASUVORK5CYII=",
];

const stateSchema = {
  title: "cap Demo State",
  type: "object",
  properties: {
    vehicle: {
      type: "object",
      properties: {
        autonomy_enabled: { type: "boolean" },
        mode: { type: "string" },
        speed_mps: { type: "number" },
      },
      required: ["autonomy_enabled", "mode", "speed_mps"],
    },
    controls: {
      type: "object",
      properties: {
        brake_pressed: { type: "boolean" },
      },
      required: ["brake_pressed"],
    },
    scene: {
      type: "object",
      properties: {
        label: { type: "string" },
        pedestrian_count: { type: "integer" },
      },
      required: ["label", "pedestrian_count"],
    },
  },
  required: ["vehicle", "controls", "scene"],
};

const compressedImageSchema = {
  title: "Compressed Image",
  type: "object",
  properties: {
    timestamp_ns: { type: "string" },
    frame_id: { type: "string" },
    format: { type: "string" },
    data: {
      type: "array",
      items: {
        type: "integer",
        minimum: 0,
        maximum: 255,
      },
    },
  },
  required: ["timestamp_ns", "frame_id", "format", "data"],
};

function ramp(startValue, endValue, step, stepCount) {
  if (stepCount <= 1) {
    return startValue;
  }
  const progress = step / (stepCount - 1);
  return startValue + (endValue - startValue) * progress;
}

function createState(second) {
  if (second < 10) {
    return {
      vehicle: {
        autonomy_enabled: false,
        mode: "MANUAL",
        speed_mps: Number(ramp(0.5, 2.5, second, 10).toFixed(1)),
      },
      controls: {
        brake_pressed: false,
      },
      scene: {
        label: "staging_lane",
        pedestrian_count: 0,
      },
    };
  }

  if (second < 25) {
    return {
      vehicle: {
        autonomy_enabled: true,
        mode: "AUTO_CRUISE",
        speed_mps: Number(ramp(4, 12, second - 10, 15).toFixed(1)),
      },
      controls: {
        brake_pressed: false,
      },
      scene: {
        label: "merge_lane",
        pedestrian_count: 0,
      },
    };
  }

  if (second < 33) {
    return {
      vehicle: {
        autonomy_enabled: true,
        mode: "AUTO_BRAKE",
        speed_mps: Number(ramp(8, 1.2, second - 25, 8).toFixed(1)),
      },
      controls: {
        brake_pressed: true,
      },
      scene: {
        label: "crosswalk_brake",
        pedestrian_count: 2,
      },
    };
  }

  if (second < 46) {
    return {
      vehicle: {
        autonomy_enabled: true,
        mode: "AUTO_RESUME",
        speed_mps: Number(ramp(2.5, 9.5, second - 33, 13).toFixed(1)),
      },
      controls: {
        brake_pressed: false,
      },
      scene: {
        label: "clear_path",
        pedestrian_count: 0,
      },
    };
  }

  return {
    vehicle: {
      autonomy_enabled: false,
      mode: "MANUAL_STOP",
      speed_mps: Number(ramp(5, 0, second - 46, 14).toFixed(1)),
    },
    controls: {
      brake_pressed: second < 52,
    },
    scene: {
      label: "handoff_zone",
      pedestrian_count: 0,
    },
  };
}

function createImageMessage(second) {
  const frame = pngFrames[Math.floor(second / imageIntervalSec) % pngFrames.length];
  return {
    timestamp_ns: (recordingStartNs + BigInt(second) * tickNs).toString(),
    frame_id: "front_camera",
    format: "png",
    data: [...Buffer.from(frame, "base64")],
  };
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const fileHandle = await fs.open(outputPath, "w");

try {
  const writer = new McapWriter({
    writable: new FileHandleWritable(fileHandle),
  });

  await writer.start({
    profile: "",
    library: "cap demo generator",
  });

  const stateSchemaId = await writer.registerSchema({
    name: "cap.DemoState",
    encoding: "jsonschema",
    data: Buffer.from(JSON.stringify(stateSchema, null, 2)),
  });

  const imageSchemaId = await writer.registerSchema({
    name: "foxglove.CompressedImage",
    encoding: "jsonschema",
    data: Buffer.from(JSON.stringify(compressedImageSchema, null, 2)),
  });

  const stateChannelId = await writer.registerChannel({
    topic: "/cap/demo/state",
    schemaId: stateSchemaId,
    messageEncoding: "json",
    metadata: new Map(),
  });

  const imageChannelId = await writer.registerChannel({
    topic: "/camera/front/compressed",
    schemaId: imageSchemaId,
    messageEncoding: "json",
    metadata: new Map(),
  });

  let sequence = 0;
  for (let second = 0; second < 60; second += 1) {
    const timestampNs = recordingStartNs + BigInt(second) * tickNs;
    await writer.addMessage({
      channelId: stateChannelId,
      sequence,
      logTime: timestampNs,
      publishTime: timestampNs,
      data: Buffer.from(JSON.stringify(createState(second))),
    });
    sequence += 1;

    if (second % imageIntervalSec === 0) {
      await writer.addMessage({
        channelId: imageChannelId,
        sequence,
        logTime: timestampNs,
        publishTime: timestampNs,
        data: Buffer.from(JSON.stringify(createImageMessage(second))),
      });
      sequence += 1;
    }
  }

  await writer.end();

  const stat = await fileHandle.stat();
  console.log(`Wrote ${outputPath}`);
  console.log(`Messages: 72`);
  console.log(`Size: ${stat.size} bytes`);
  console.log("Suggested quick filter: vehicle.autonomy_enabled is active for 8s");
  console.log("Suggested snippet marker: scene.label == crosswalk_brake");
} finally {
  await fileHandle.close();
}
