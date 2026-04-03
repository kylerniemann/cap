import fs from "node:fs/promises";
import path from "node:path";

import { McapWriter } from "@mcap/core";
import { FileHandleWritable } from "@mcap/nodejs";

const compatibilityDir = path.resolve(process.cwd(), "demo/compatibility");
const baseTimestampNs = 1_735_000_000_000_000_000n;

const stateSchema = {
  title: "Compatibility State",
  type: "object",
  properties: {
    robot: {
      type: "object",
      properties: {
        mode: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["mode", "enabled"],
    },
    metrics: {
      type: "object",
      properties: {
        speed_mps: { type: "number" },
      },
      required: ["speed_mps"],
    },
  },
  required: ["robot", "metrics"],
};

async function writeMcapFixture(outputPath, buildFixture) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const fileHandle = await fs.open(outputPath, "w");
  try {
    const writer = new McapWriter({
      writable: new FileHandleWritable(fileHandle),
    });
    await writer.start({
      profile: "",
      library: "cap compatibility fixtures",
    });
    await buildFixture(writer);
    await writer.end();
  } finally {
    await fileHandle.close();
  }
}

async function registerJsonSchemaChannel(writer, { topic, schemaName = "cap.CompatibilityState" }) {
  const schemaId = await writer.registerSchema({
    name: schemaName,
    encoding: "jsonschema",
    data: Buffer.from(JSON.stringify(stateSchema, null, 2)),
  });
  return writer.registerChannel({
    topic,
    schemaId,
    messageEncoding: "json",
    metadata: new Map(),
  });
}

async function addJsonMessage(writer, channelId, offsetNs, payload, sequence) {
  const logTime = baseTimestampNs + offsetNs;
  await writer.addMessage({
    channelId,
    sequence,
    logTime,
    publishTime: logTime,
    data: Buffer.from(JSON.stringify(payload)),
  });
}

const fixtures = [
  {
    filename: "schema-less-json.mcap",
    async write(writer) {
      const channelId = await writer.registerChannel({
        topic: "/robot/state",
        schemaId: 0,
        messageEncoding: "json",
        metadata: new Map(),
      });

      await addJsonMessage(
        writer,
        channelId,
        0n,
        {
          robot: { mode: "IDLE", enabled: false },
          metrics: { speed_mps: 0 },
        },
        0,
      );
      await addJsonMessage(
        writer,
        channelId,
        1_000_000_000n,
        {
          robot: { mode: "TRACK", enabled: true },
          metrics: { speed_mps: 3.4 },
        },
        1,
      );
    },
  },
  {
    filename: "empty-channel.mcap",
    async write(writer) {
      const activeChannelId = await registerJsonSchemaChannel(writer, {
        topic: "/vehicle/state",
      });
      await registerJsonSchemaChannel(writer, {
        topic: "/vehicle/unused",
        schemaName: "cap.EmptyChannel",
      });

      await addJsonMessage(
        writer,
        activeChannelId,
        0n,
        {
          robot: { mode: "BOOT", enabled: false },
          metrics: { speed_mps: 0.1 },
        },
        0,
      );
      await addJsonMessage(
        writer,
        activeChannelId,
        2_000_000_000n,
        {
          robot: { mode: "READY", enabled: true },
          metrics: { speed_mps: 1.8 },
        },
        1,
      );
    },
  },
];

for (const fixture of fixtures) {
  const outputPath = path.join(compatibilityDir, fixture.filename);
  await writeMcapFixture(outputPath, fixture.write);
  const stat = await fs.stat(outputPath);
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)} (${stat.size} bytes)`);
}
