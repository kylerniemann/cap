import path from "node:path";

import { buildSceneIndex } from "./scene-index-lib.mjs";

function parseArgs(argv) {
  const values = { input: undefined, output: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      values.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (!values.input) {
      values.input = arg;
    }
  }
  return values;
}

const { input, output } = parseArgs(process.argv.slice(2));

if (!input) {
  console.error("Usage: node scripts/build-scene-index.mjs <recording-file> [-o output.cap-index.json]");
  process.exit(1);
}

const outputPath = output ?? `${input}.cap-index.json`;

await buildSceneIndex(input, outputPath, ({ totalMessages, signalCount }) => {
  if (totalMessages % 10000 === 0) {
    console.log(`Processed ${totalMessages} messages, discovered ${signalCount} signals...`);
  }
});

console.log(`Wrote scene index to ${path.resolve(outputPath)}`);
