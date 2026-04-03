# Demo Data Strategy

`cap` is easiest to understand when a user can open one recording, add one panel, run one obvious query, and jump to an interesting timestamp immediately.

## Included Demo Recording

This repo now includes a tiny synthetic recording at `demo/cap-demo-recording.mcap`.

- It is safe to redistribute because it is generated from synthetic state transitions and embedded pixel data.
- It is intentionally small enough for first-run demos, screenshots, and support reproduction.
- It pairs with the walkthrough in [docs/first-run-demo.md](./first-run-demo.md).

If you need to recreate it locally, run:

```bash
npm run demo:generate
```

## Recommended Public Demo Shape

- Length: 30 to 90 seconds
- Size: as small as possible while still showing a few scene changes
- Signals: include at least one boolean or enum-like signal that changes state
- Visuals: include one compressed image topic if preview thumbnails are part of the demo

## Good Demo Moments

Pick recordings where a user can quickly ask questions like:

- when did autonomy turn on?
- where was braking active?
- show clips where the robot switched modes

Those examples make the quick-filter flow obvious without explaining the implementation.

## Distribution Guidance

- Keep the checked-in demo artifact tiny and synthetic.
- Keep a tiny legal demo artifact for screenshots, onboarding, and support repros.
- Host larger shareable recordings outside the repo.
- Document the exact query to run in the README and release notes.

## What To Capture For The First Public Demo

1. Recording source and redistribution rights
2. Exact filename and size
3. The topics that matter
4. One quick-filter query
5. One snippet query
6. Whether preview thumbnails are expected
