# First-Wave Announcement Kit

Use this packet when you want to publish the first outward-facing wave for `cap` without rewriting copy or re-deciding which asset to attach.

## Core Call To Action

Every post should drive users to the same first run:

1. Install the `.foxe` bundle or build locally from the repo
2. Open `demo/cap-demo-recording.mcap`
3. Add the `cap` panel in Foxglove
4. Run the walkthrough in [docs/first-run-demo.md](./first-run-demo.md)
5. Report onboarding friction or unsupported recordings through the GitHub issue templates

Canonical repo link: `https://github.com/kylerniemann/cap`

## Message Spine

- Problem: robotics teams waste time scrubbing long recordings to find one scene
- Product: `cap` adds search for historical `.bag` and `.mcap` recordings inside Foxglove
- Proof: the repo ships a tiny deterministic demo recording plus a five-minute walkthrough
- Ask: try the bundled demo, then report onboarding or compatibility friction

## Paste-Ready Copy

### GitHub Release Body

```md
## cap 0.2.3

`cap` makes historical recording search inside Foxglove easier to try and easier to share.

### What is it?

`cap` is a Foxglove extension for searching historical ROS bag and MCAP recordings with quick filters, snippets, preview thumbnails, and click-to-seek results.

### What changed in this release?

- bundled synthetic demo recording for deterministic first-run testing
- guided walkthrough for the included recording
- release packaging path for GitHub-hosted `.foxe` bundles
- compatibility and onboarding feedback paths in the repo

### Try it

1. Download the attached `.foxe` bundle or build locally from the repo
2. Open `demo/cap-demo-recording.mcap`
3. Add the `cap` panel in Foxglove
4. Set previews to `/camera/front/compressed`
5. Follow `docs/first-run-demo.md` to hit the `crosswalk_brake` event

### Feedback wanted

- onboarding friction
- unsupported `.bag` or `.mcap` recordings
- demo steps that were unclear or too slow
```

### Foxglove Listing Refresh

#### Short Description

Search historical ROS bag and MCAP recordings in Foxglove with quick filters, snippets, preview thumbnails, and click-to-seek results.

#### Long Description

`cap` helps robotics developers and operators find interesting moments in a recording without manually scrubbing through the full timeline. Open a supported `.bag` or `.mcap` in Foxglove, add the `cap` panel, and search the current recording with reusable quick filters or code snippets. Matching results can include compressed-image previews and jump directly to the exact timestamp.

The repo includes a tiny synthetic MCAP so new users can try the panel on a deterministic recording before testing their own data. If onboarding is confusing or a recording does not work, the repo also includes issue templates for onboarding friction and compatibility reports.

#### Highlights

- Search the recording currently opened in Foxglove
- Use quick filters for fast signal-driven scene lookup
- Use snippets for custom scene queries
- Preview likely camera frames beside search results
- Start with the bundled demo recording before testing private datasets

### ROS / Robotics Community Post

Use this for ROS Discourse, a robotics Slack, or a developer Discord where longer-form context is welcome.

```md
We’ve been building `cap`, a Foxglove extension for searching historical ROS bag and MCAP recordings instead of scrubbing manually through timelines.

What it does:
- quick filters for signal-based scene lookup
- snippet-based search for custom queries
- click-to-seek results
- optional preview thumbnails when compressed image topics are present

The repo includes a tiny synthetic MCAP so the first run is deterministic:
https://github.com/kylerniemann/cap

Fastest way to try it:
1. install the extension
2. open `demo/cap-demo-recording.mcap`
3. add the `cap` panel in Foxglove
4. run the walkthrough in `docs/first-run-demo.md`

If you try it on your own data, I’d especially like to hear about:
- onboarding friction
- unsupported `.bag` or `.mcap` variants
- missing search workflows you expected to have
```

### Short Social Post

Use this for X, LinkedIn, or a short Slack post.

```md
Built `cap`: a Foxglove extension for searching historical ROS bag + MCAP recordings with quick filters, snippets, preview thumbnails, and click-to-seek results.

The repo ships with a tiny demo recording, so the first run is fast and deterministic:
https://github.com/kylerniemann/cap

If you test it on your own recordings, send the weird onboarding or compatibility failures.
```

### Direct Outreach Blurb

Use this for a DM or email to a prospective user.

```md
I’m working on `cap`, a Foxglove extension for searching historical ROS bag and MCAP recordings without scrubbing manually through long timelines.

It supports quick filters, snippet-based queries, preview thumbnails, and click-to-seek results. The repo includes a tiny synthetic MCAP, so you can test the first run in a few minutes before trying your own data.

Repo: https://github.com/kylerniemann/cap

If you try it, I’d love blunt feedback on setup friction and whether your recordings work cleanly.
```

## Asset Map

| Surface | Asset | Why it fits | Demo step to pair with it |
| --- | --- | --- | --- |
| GitHub release | `assets/media/quick_filters.gif` | Shows the core interaction quickly | Run the first quick filter on `vehicle.autonomy_enabled` |
| GitHub release | `assets/readme/overview.svg` | Static fallback if GIF autoplay is unavailable | Show the panel after indexing completes |
| Foxglove listing | `assets/media/quick_filters.gif` | Best at demonstrating search plus seek behavior | Set preview topic to `/camera/front/compressed` before capture |
| Community post | `assets/readme/snippets.svg` | Explains that `cap` is not only quick filters | Pair with the `crosswalk_brake` snippet from [docs/first-run-demo.md](./first-run-demo.md) |
| Direct outreach | `demo/cap-demo-recording.mcap` | Low-friction artifact to hand someone immediately | Ask them to open the bundled recording first |

## Recommended Publish Order

1. Publish the GitHub release with the packaged `.foxe`
2. Refresh the Foxglove listing copy
3. Post the longer community write-up
4. Follow with the short social post
5. Send the direct outreach blurb to target users who already use Foxglove or regularly inspect recordings

## Feedback Routing

Ask every surface for one of these concrete responses:

- open an onboarding-friction issue if setup was confusing
- open a compatibility-report issue if a `.bag` or `.mcap` failed
- reply with the exact recording format and what search flow they expected
