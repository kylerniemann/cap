# Compatibility

`cap` works against recordings that Foxglove can open and that the extension can scan through the offline message-range APIs it relies on.

## Validated Product Shape

- Foxglove desktop with a locally opened recording
- Historical playback, not live streaming
- Quick-filter and snippet search against the currently open recording

## Recording Formats

| Format | Status | Notes |
| --- | --- | --- |
| ROS bag (`.bag`) | Supported with private-fixture coverage | Local historical recordings are the main path. Automated regression checks support bag fixtures, but the bag corpus is expected to live outside the public repo. |
| MCAP (`.mcap`) | Fixture-backed with caveats | Checked-in fixtures cover JSON Schema with previews, schema-less JSON, and empty-channel shapes. Common ROS 1, ROS 2, JSON, JSON Schema, and Protobuf recordings are still the intended support envelope. |

## Validated Fixtures

- Run `npm run compat:fixtures` to regenerate the checked-in MCAP fixtures and validate them.
- Add private bag fixtures in `.compat-fixtures/` and declare them in `.compat-fixtures/manifest.json` if you want bag coverage included in the same validation pass.
- The current checklist and expected coverage live in [docs/compatibility-checklist.md](./compatibility-checklist.md).

## Camera Preview Support

Camera previews are optional and currently depend on compressed image topics such as:

- `sensor_msgs/CompressedImage`
- `sensor_msgs/msg/CompressedImage`
- `foxglove.CompressedImage`
- `foxglove_msgs/CompressedImage`
- `foxglove_msgs/msg/CompressedImage`

If a recording has no compatible compressed image topic, `cap` still searches the recording but preview thumbnails will not appear.

## Known Caveats

- Live sources are not supported because the extension depends on historical range queries.
- MCAP edge cases may fail when they rely on uncommon schemas or custom encodings outside the built-in decoding paths.
- No redistributable ROS bag corpus is checked into this repo, so bag regression checks are only as good as the private fixtures you provide locally or in CI.
- Snippet queries depend on the actual signal names present in the current recording.

## Best Bug Report

If a bag or MCAP fails, include:

1. Foxglove version
2. OS
3. Recording format
4. Topic names involved
5. Whether quick filters, snippets, or previews failed
6. A small repro recording if you can legally share one
