# Distribution Assets

This document collects the public-facing copy and asset checklist for the main distribution surfaces around `cap`.

For a full first-wave posting packet with community-post copy, direct outreach text, and asset pairing guidance, use [docs/announcement-kit.md](./announcement-kit.md).

## GitHub Repository Surface

### Suggested repository description

Foxglove extension for historical ROS bag and MCAP scene search, snippets, camera previews, and click-to-seek results.

### Suggested topics

- foxglove
- foxglove-extension
- robotics
- ros
- rosbag
- mcap
- autonomy
- telemetry
- search
- typescript

### Suggested social preview / pinned summary

Search historical ROS bag and MCAP recordings inside Foxglove with quick filters, snippets, preview thumbnails, and one-click seek.

## GitHub Release Copy

Use this as the starting point for the release body when publishing a tagged build:

```md
## cap 0.2.3

`cap` adds faster first-run onboarding for historical recording search in Foxglove.

### Highlights

- Bundled tiny synthetic demo recording for deterministic screenshots and first-run testing
- Guided quick-filter and snippet walkthrough for the included recording
- Packaging and release workflow ready for GitHub-hosted `.foxe` assets

### Try it

1. Download the attached `.foxe` bundle
2. Install it in Foxglove
3. Open `cap-demo-recording.mcap`
4. Add the `cap` panel and run the walkthrough from `docs/first-run-demo.md`

### Notes

- Historical playback only; live sources are not supported
- Preview thumbnails depend on compatible compressed image topics
- Compatibility details: `docs/compatibility.md`
```

## Foxglove Listing Copy

Adapt this for the Foxglove extension listing surface.

### Title

cap

### Short description

Search historical ROS bag and MCAP recordings with quick filters, snippets, preview thumbnails, and click-to-seek results.

### Longer description

`cap` helps operators and developers find interesting moments in a recording without scrubbing through the full timeline manually. Open a supported `.bag` or `.mcap` in Foxglove, add the `cap` panel, and search the current recording with reusable quick filters or code snippets. Matching results can include preview thumbnails and jump directly to the exact timestamp.

### Suggested highlights

- Historical search inside the currently opened recording
- Quick-filter workflow for fast signal-based scene lookup
- Snippet mode for more precise custom queries
- Optional compressed-image previews in result rows
- Works with ROS bag plus common ROS 1, ROS 2, JSON, JSON Schema, and Protobuf MCAP recordings

### Suggested limitations text

- Historical recordings only; no live-source support yet
- Preview thumbnails require compatible compressed-image topics
- Some uncommon MCAP schema layouts may still be unsupported

## Media Checklist

Use these assets before publishing:

1. Hero GIF: `assets/media/quick_filters.gif`
2. Static overview image: `assets/readme/overview.svg`
3. Static snippet image: `assets/readme/snippets.svg`
4. Demo recording reference: `demo/cap-demo-recording.mcap`
5. Walkthrough reference: `docs/first-run-demo.md`

## Screenshot / GIF Capture Notes

- Use the bundled demo recording for deterministic results.
- Set preview topic to `/camera/front/compressed`.
- Capture one quick-filter run with `vehicle.autonomy_enabled is active`.
- Capture one narrower result set with `controls.brake_pressed is active`.
- Keep captures focused on the panel and the clicked seek result rather than the full Foxglove layout.
