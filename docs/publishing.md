# Publishing Checklist

This is the release path for `cap` when the repo is ready to ship an updated `.foxe` bundle and refresh the public listing surfaces.

## Preflight

1. Run `nvm use`
2. Run `npm ci`
3. Run `npm run smoke`
4. Confirm the demo walkthrough in [docs/first-run-demo.md](./first-run-demo.md) still matches the shipped experience
5. Confirm the public copy in [docs/distribution-assets.md](./distribution-assets.md) still matches the product behavior

## Versioning

1. Pick the release version
2. Update `package.json`
3. Update `package-lock.json`
4. Add the release notes entry to `CHANGELOG.md`
5. Commit the version bump and release notes together

## Package Validation

1. Run `npm run package`
2. Verify that a `.foxe` bundle is produced in the repo root
3. Install the bundle locally in Foxglove if you need a final manual smoke pass
4. Open `demo/cap-demo-recording.mcap` and confirm:
   - the panel loads
   - indexing completes
   - quick filters return matches
   - previews render for `/camera/front/compressed`
   - snippet execution jumps to the expected segment

## Automated GitHub Release Path

The repo includes `.github/workflows/release.yml`, which packages the extension on tag push and uploads the resulting `.foxe` bundle to the GitHub release.

1. Create an annotated tag such as `v0.2.3`
2. Push the tag to `origin`
3. Wait for the Release workflow to finish
4. Verify the release contains the packaged `.foxe` asset
5. Paste in the release copy from [docs/distribution-assets.md](./distribution-assets.md)

## Surface Updates

Before announcing the release, update these surfaces together:

1. GitHub repository description and topics from `.github/repository-metadata.md`
2. README quick-start and demo links
3. GitHub release body from [docs/distribution-assets.md](./distribution-assets.md)
4. Foxglove listing title, short description, and long description from [docs/distribution-assets.md](./distribution-assets.md)

## Announcement Readiness

Only announce once all of these are true:

1. The tagged release asset downloads cleanly
2. The demo recording walkthrough still works end to end
3. The README matches the shipped bundle behavior
4. Issue templates are present for onboarding and compatibility feedback
