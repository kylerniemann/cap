# Changelog

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
