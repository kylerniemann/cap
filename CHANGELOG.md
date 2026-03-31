# Changelog

## 0.2.1

- Moved historical indexing and search into the Foxglove panel so no local helper process is required for offline recordings
- Added in-panel indexing of the currently opened bag or MCAP using Foxglove's message-range API
- Kept quick filters, snippet search, and camera previews working against the locally built in-memory index
- Updated package metadata and docs to reflect the helperless install flow

## 0.2.0

- Expanded MCAP decoding support to cover ROS 1, ROS 2 `ros2idl`, JSON, JSON Schema, and Protobuf recordings
- Added generic recording indexing for `.bag` and `.mcap` inputs
- Updated docs and package metadata to reflect broader MCAP compatibility

## 0.1.0

- Added helper-backed historical search for ROS bag recordings
- Added compact quick-filter UI with typeable signal inputs
- Added snippet mode with built-in examples and save/import/export support
- Added matched-row camera previews for compressed image topics
- Improved packaging, docs, ignore rules, and public-repo readiness
