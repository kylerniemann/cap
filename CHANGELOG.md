# Changelog

## 0.2.3

- Added a tiny synthetic MCAP demo recording at `demo/cap-demo-recording.mcap`
- Added a guided first-run walkthrough with exact quick-filter and snippet examples
- Added a deterministic demo generator script so the public demo asset can be reproduced locally
- Added generated compatibility MCAP fixtures plus a validation script for repeatable indexing checks
- Added a compatibility checklist and private bag-fixture manifest path so regression coverage is explicit instead of implied

## 0.2.2

- Fixed offline indexing getting stuck when a topic advertised by the recording had no historical messages
- Added an indexing watchdog so the panel finalizes cleanly even when Foxglove never opens a range iterator for an empty topic
- Improved camera preview topic detection by subscribing to compatible compressed-image schemas and recognizing converted Foxglove image schemas

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
