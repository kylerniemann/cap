# Weekly Marketing Cadence

Use this document to keep `cap` visible after the first launch wave. The goal is to make weekly promotion operational, not aspirational: one current push, one next push, and one explicit feedback path at all times.

## Weekly Loop

Run the same lightweight cycle every week:

1. Monday: verify the product and public assets still match
2. Tuesday: publish or refresh one public surface
3. Wednesday: send direct outreach to a small set of likely users
4. Thursday: triage feedback into product or compatibility follow-ups
5. Friday: review results, update the scoreboard, and pick next week's channel

## Operating Rules

- Every outward push must point to the same first run: install `cap`, open `demo/cap-demo-recording.mcap`, add the panel, and follow [docs/first-run-demo.md](./first-run-demo.md).
- Do not promote workflows that are not already demoable from the repo.
- Treat onboarding friction and compatibility failures as growth inputs, not support noise.
- Prefer one shipped distribution action per week over a larger plan that does not get posted.

## Weekly Checklist

### Monday: Product and Asset Check

1. Run `npm ci`
2. Run `npm run smoke`
3. Confirm [README.md](../README.md), [docs/distribution-assets.md](./distribution-assets.md), and [docs/announcement-kit.md](./announcement-kit.md) still match the product
4. Re-run the bundled demo from [docs/first-run-demo.md](./first-run-demo.md)
5. Note any setup or compatibility friction that blocks promotion

### Tuesday: Public Distribution

Pick one primary channel and ship it:

- GitHub release refresh
- Foxglove listing refresh
- ROS Discourse or robotics community post
- short social post linking to the deterministic demo

Use [docs/announcement-kit.md](./announcement-kit.md) as the source packet. If nothing changed in the product this week, post a narrower angle instead of repeating the full launch copy, for example:

- "works on this recording type"
- "fastest first-run walkthrough"
- "preview thumbnails plus click-to-seek"

### Wednesday: Direct Outreach

Send the direct outreach blurb from [docs/announcement-kit.md](./announcement-kit.md) to 3 to 5 people or teams who already use Foxglove, inspect robotics recordings, or maintain bag/MCAP-heavy workflows.

Ask for one specific response:

- did the first run work
- which recording format failed
- what search workflow was missing

### Thursday: Feedback Triage

Review all inbound signals:

- GitHub issues
- direct replies from outreach
- comments from community posts
- internal notes from manual demos

Convert each real friction report into one of these:

- onboarding issue
- compatibility issue
- docs fix
- follow-up distribution task

### Friday: Scoreboard and Next Week

Update the scoreboard below, write a short summary, and choose one next channel before the week ends.

The loop is healthy if the answer to all three questions is "yes":

1. Did we ship one outward-facing touch this week?
2. Did we collect at least one concrete feedback signal from a real user or prospect?
3. Do we know the next public surface to update next week?

## Scoreboard Template

Copy this block into the current week's note, issue comment, or tracking doc.

```md
## Week of YYYY-MM-DD

### Shipped
- Primary channel:
- Asset or copy used:
- Link to post or release:

### Demo Path Verified
- `npm run smoke`:
- Demo walkthrough checked:
- Any mismatch between product and public copy:

### Feedback
- New onboarding reports:
- New compatibility reports:
- Direct outreach replies:
- Highest-signal user quote or issue:

### Next Up
- Next channel:
- Next asset to refresh:
- Product or docs task created from feedback:

### Human Access Needed
- GitHub release publishing:
- GitHub repo metadata update:
- Foxglove listing update:
- Community account posting:
```

## Human-Only Access Points

These steps usually need a board member or someone with the right account access:

- publishing a GitHub release and editing the final release body
- changing GitHub repository description, topics, or pinned summary
- updating the Foxglove extension listing
- posting from company-controlled social, community, or Slack accounts
- sending outreach from a personal or company identity where trust matters

Engineering can prepare the assets, commands, screenshots, release notes, and post copy ahead of time so the human step is only account execution.

## Current Recommended Next Tasks

Based on the repo state today, these are the best follow-up distribution and adoption tasks:

1. Publish the next tagged GitHub release with the packaged `.foxe` and the existing deterministic demo path.
2. Refresh the Foxglove listing using the copy in [docs/distribution-assets.md](./distribution-assets.md) so the public listing matches the current onboarding flow.
3. Run a small outreach batch to 5 Foxglove or robotics users and explicitly ask for `.bag` and `.mcap` compatibility failures.
4. Add a lightweight weekly scorecard artifact to the operating workflow so each week leaves behind one visible record of what shipped and what feedback arrived.

## Recommended Owners

- Growth Engineer: demo verification, copy prep, outreach packet updates, feedback synthesis
- CEO or board user: account-bound publishing and public posting where credentials are required
- Launch Engineer: release packaging confidence, repo surface accuracy, and final ship-readiness checks
