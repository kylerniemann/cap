# First-Run Demo

Use the bundled synthetic recording when you want a zero-guess `cap` demo.

## Canonical Recording

- File: `demo/cap-demo-recording.mcap`
- Length: 60 seconds
- Format: MCAP with JSON Schema channels
- Visuals: `/camera/front/compressed`
- State topic: `/cap/demo/state`

The recording is synthetic and safe to redistribute. If it ever goes missing locally, regenerate it with:

```bash
npm run demo:generate
```

## Five-Minute Walkthrough

1. Run `npm install`
2. Run `npm run local-install`
3. Open `demo/cap-demo-recording.mcap` in Foxglove
4. Add the `cap` panel
5. Pick `/camera/front/compressed` for previews

## Exact Quick Filter

Create this first filter:

- Signal: `vehicle.autonomy_enabled`
- Operator: `is active`
- Duration: `8`

Expected result:

- multiple matches during the `AUTO_CRUISE`, `AUTO_BRAKE`, and `AUTO_RESUME` sections
- preview thumbnails from `/camera/front/compressed`

Add this second filter if you want a smaller, more dramatic result set:

- Join: `AND`
- Signal: `controls.brake_pressed`
- Operator: `is active`

That isolates the `crosswalk_brake` segment.

## Exact Snippet

Use this snippet to jump straight to the most obvious demo moment:

```javascript
for (const sample of signal("/cap/demo/state.scene.label")) {
  if (sample.value === "crosswalk_brake") {
    match(sample.timestampNs, "Crosswalk brake event", {
      signal: "/cap/demo/state.scene.label",
      topic: "/cap/demo/state",
    });
  }
}
```

## Signal Map

- `vehicle.autonomy_enabled`: flips on for the autonomous section
- `vehicle.mode`: transitions through `MANUAL`, `AUTO_CRUISE`, `AUTO_BRAKE`, `AUTO_RESUME`, `MANUAL_STOP`
- `controls.brake_pressed`: turns on during the braking event
- `scene.label`: names the current segment
- `scene.pedestrian_count`: rises during the braking segment
