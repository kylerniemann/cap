# Scene Search

`Scene Search` is a Foxglove extension plus a lightweight local helper for historical scene search over ROS bag recordings.

It is built for a practical workflow:

- open a bag in Foxglove
- let the extension auto-match the recording to a local index
- search with quick filters or custom snippets
- click a result row to jump Foxglove to that timestamp
- optionally show a compact camera preview alongside each match

## Screenshots

Quick filters and camera previews:

![Scene Search quick filters](./assets/readme/overview.svg)

Snippet mode with saved/importable examples:

![Scene Search snippets](./assets/readme/snippets.svg)

## What It Does

- Dynamically discovers topics, datatypes, and flattened signal paths from the indexed recording
- Supports typeable quick filters with `AND` / `OR` chaining
- Supports custom snippet-based search with built-in examples
- Saves snippets in-panel and supports snippet import/export
- Shows matching result rows with timestamps, reasons, and optional durations
- Seeks Foxglove playback when a result row is clicked
- Can attach nearest camera previews for selected compressed-image topics

## Architecture

The project uses two parts:

1. Foxglove extension
   - compact UI
   - topic matching
   - quick filters
   - snippet editor
   - results table

2. Local helper
   - matches the opened recording to a local `.bag`
   - builds or reuses a `.scene-search.json` index
   - executes quick-filter and snippet searches outside the Foxglove panel
   - serves metadata and results over `http://127.0.0.1:8765`

This split keeps the Foxglove panel responsive even for large recordings.

## Current Format Support

- ROS bag: supported
- MCAP: not supported yet in this build

Different recordings with different signal names are supported as long as they can be indexed. The signal list is rebuilt from each recording, so quick filters repopulate automatically. Snippets work too, but snippet code must reference signal names that exist in that recording.

## Project Layout

- `src/SceneSearchPanel.tsx`: Foxglove panel UI
- `scripts/scene-index-server.mjs`: local helper server
- `scripts/scene-index-lib.mjs`: bag indexing logic
- `scripts/build-scene-index.mjs`: CLI index builder

## Development

Install dependencies:

```powershell
npm install
```

Run lint:

```powershell
npm run lint
```

Build the extension:

```powershell
npm run build
```

Package the extension:

```powershell
npm run package
```

## Running Locally

Start the helper and point it at folders containing `.bag` files:

```powershell
npm run serve-index -- "C:\Users\you\Downloads"
```

Then load the packaged `.foxe` into Foxglove and open a supported bag.

The extension will:

- read Foxglove topic metadata
- ask the helper to match the current recording
- load lightweight metadata
- populate signals and cameras
- run searches through the helper

## Building an Index Manually

You can generate an index yourself with:

```powershell
npm run index-bag -- "C:\path\to\recording.bag" -o "C:\path\to\recording.bag.scene-search.json"
```

## Snippet API

Snippet mode runs inside the local helper with a restricted API. The current helpers are:

- `timeline()`
- `signals()`
- `signal(name)`
- `signalValue(name, timestampNs)`
- `signalActive(name, timestampNs)`
- `findRanges(name, operator, value, minDurationSec)`
- `match(timestampNs, reason, extra?)`
- `matchRange(startNs, endNs, reason, extra?)`

Example:

```js
for (const range of findRanges("/vehicle_speed_kmph.data", ">", 10, 5)) {
  matchRange(range.startNs, range.endNs, "Speed > 10 km/h for 5 seconds", {
    signal: "/vehicle_speed_kmph.data",
    topic: "/vehicle_speed_kmph",
  });
}
```

## Public Repo Checklist

Before publishing this repo to GitHub, it is already set up to:

- ignore generated `.foxe` bundles
- ignore generated `.scene-search.json` indexes
- ignore local `.bag` and `.mcap` recordings
- use an MIT license

You may still want to update these package fields for your own release:

- `publisher`
- `homepage`
- `repository`

Suggested GitHub repo description and topics are in `.github/repository-metadata.md`.

## Limitations

- MCAP indexing is not implemented yet
- Camera previews currently rely on sparse previews from `sensor_msgs/CompressedImage`
- Historical search depends on the local helper, not the extension alone
