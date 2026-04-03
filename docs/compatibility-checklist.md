# Compatibility Checklist

Use this checklist when updating compatibility claims or touching the indexing pipeline.

## Checked-In Fixtures

Run `npm run compat:fixtures` before shipping compatibility-sensitive changes.

| Fixture | Format | What it covers | Expected result |
| --- | --- | --- | --- |
| `demo/cap-demo-recording.mcap` | MCAP | Public first-run demo, JSON Schema payloads, compressed image previews | Index builds, `vehicle.autonomy_enabled` is discoverable, preview thumbnails are present |
| `demo/compatibility/schema-less-json.mcap` | MCAP | JSON payloads with no schema registration | Index builds and `robot.mode` is discoverable without schema metadata |
| `demo/compatibility/empty-channel.mcap` | MCAP | Registered channels with no messages plus normal JSON Schema traffic | Manifest includes the empty topic and index generation still succeeds |

## Private Fixtures

Bag coverage is intentionally wired through a private manifest so the validator can exercise real `.bag` recordings without checking them into the public repo.

1. Create `.compat-fixtures/manifest.json` from [docs/private-compatibility-fixtures.example.json](./private-compatibility-fixtures.example.json).
2. Put your private `.bag` or `.mcap` files somewhere under `.compat-fixtures/`.
3. Re-run `npm run compat:fixtures`.

Recommended private bag shapes:

- One small ROS bag with a simple JSON-like signal tree
- One bag containing a compressed image topic used for preview validation
- One bag that intentionally lacks preview topics so search-only behavior stays covered

## Partial And Unsupported Cases

- Live sources remain out of scope.
- Exotic MCAP schema encodings should not be called supported until a matching fixture lands in either the checked-in or private manifest.
- If a regression only reproduces on a private fixture, add that fixture to `.compat-fixtures/manifest.json` so the next run catches it automatically.
