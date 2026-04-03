<p align="center">
  <img src="./assets/brand/cap-icon.svg" alt="cap icon" width="96" />
</p>

<p align="center">
  <img src="./assets/media/quick_filters.gif" alt="cap quick filter demo" width="100%" />
</p>

# cap

`cap` is a Foxglove extension for historical ROS bag and MCAP search.

It indexes the currently opened recording inside Foxglove, lets users search for scenes with quick filters or snippets, and jumps straight to the matching timestamp with optional camera previews.

## Why Try It

- Search a whole recording instead of scrubbing manually.
- Jump directly to the scene that matches a signal condition or snippet.
- Preview likely camera frames alongside search results when compressed image topics are present.

## What You Need

- Foxglove desktop installed locally
- Node.js `25.2.1` and npm `11.6.2` for the tested setup in this repo
- A local `.bag` or `.mcap` recording that Foxglove can open, or the bundled `demo/cap-demo-recording.mcap`

If you use `nvm`, run `nvm use` in this repo to match the tested Node version.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Build and install the extension into Foxglove

```bash
npm run local-install
```

This copies the extension into your Foxglove extensions folder and rebuilds it in production mode first.

### 3. Open a recording and add the panel

1. Restart or reload Foxglove.
2. Open `demo/cap-demo-recording.mcap` for the fastest first run, or use your own supported `.bag` or `.mcap`.
3. Add the `cap` panel to your layout.
4. Wait for the panel to build its local search index from the currently opened recording.

### 4. First useful demo

With the bundled demo recording:

1. Set the preview topic to `/camera/front/compressed`.
2. Create a quick filter with `vehicle.autonomy_enabled`, operator `is active`, duration `8`.
3. Add `controls.brake_pressed is active` as a second condition if you want to isolate the braking moment.
4. Run the snippet from [docs/first-run-demo.md](./docs/first-run-demo.md) to jump directly to the `crosswalk_brake` event.

## Development Commands

```bash
npm run build
npm run compat:fixtures
npm run demo:generate
npm run lint
npm run package
npm run smoke
```

- `npm run build`: local extension bundle
- `npm run compat:fixtures`: regenerate the checked-in compatibility MCAPs and validate all checked-in fixtures plus any private bag fixtures declared in `.compat-fixtures/manifest.json`
- `npm run demo:generate`: recreate the tiny public demo recording
- `npm run package`: generate a `.foxe` bundle for sharing or release upload
- `npm run smoke`: lint, compatibility validation, and packaging in one pass

## Supported Formats

Short version:

- ROS bag: supported
- MCAP: fixture-backed for checked-in JSON and JSON Schema variants, with broader support documented below

Compatibility details, caveats, and the fixture checklist live in [docs/compatibility.md](./docs/compatibility.md) and [docs/compatibility-checklist.md](./docs/compatibility-checklist.md).

## Demo Data Strategy

This repo includes a tiny synthetic MCAP at `demo/cap-demo-recording.mcap` for a deterministic first run.

The recommended distribution path is:

1. Keep the repo lightweight with a tiny synthetic demo.
2. Use the bundled 60 second MCAP for first-run demos and screenshots.
3. Host larger public demo recordings separately.
4. Document exactly which topics or signals make `cap` look good in that demo.

More detail lives in [docs/demo-data.md](./docs/demo-data.md) and the exact walkthrough lives in [docs/first-run-demo.md](./docs/first-run-demo.md).

## Release And Distribution

The repo now includes two launch-facing references:

- [docs/distribution-assets.md](./docs/distribution-assets.md): GitHub description/topics, release copy, Foxglove listing copy, and media checklist
- [docs/announcement-kit.md](./docs/announcement-kit.md): channel-ready launch copy, direct outreach text, and asset-to-demo mapping
- [docs/marketing-cadence.md](./docs/marketing-cadence.md): weekly distribution loop, scoreboard template, human-only handoffs, and follow-up growth tasks
- [docs/publishing.md](./docs/publishing.md): versioning, packaging, tag push, and GitHub release workflow

## More Views

![cap quick filters](./assets/readme/overview.svg)

![cap snippets](./assets/readme/snippets.svg)

## Does It Adjust To Different Bags?

Yes, for supported recordings.

When a user opens a different supported recording, `cap` rebuilds its in-panel search index from that data source. That means:

- the quick-filter signal list updates automatically
- camera topic choices update automatically
- snippets still work, but they need to reference signal names that exist in the currently opened recording

## Limitations

- Historical search depends on Foxglove's offline message-range API, so live sources are not currently supported.
- Camera previews currently rely on sparse previews from `sensor_msgs/CompressedImage`.
- Some MCAPs may still be unsupported if they use uncommon schema layouts or custom encodings outside the paths handled today.
- Bag regression coverage depends on private fixture files because this repo does not ship redistributable `.bag` samples.

## Feedback

If onboarding is confusing or a recording does not work, open a GitHub issue.

- Use the onboarding template for setup friction.
- Use the compatibility template for unsupported bags or MCAPs.

## Repo Notes

- Generated `.foxe` bundles are ignored.
- Local bag files, MCAP files, and generated indexes are ignored.
- Suggested GitHub repo description and topics are in `.github/repository-metadata.md`.
- Launch copy, media guidance, and the publishing checklist live in `docs/distribution-assets.md` and `docs/publishing.md`.
