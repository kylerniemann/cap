<p align="center">
  <img src="./assets/brand/cap-icon.svg" alt="cap icon" width="96" />
</p>

<p align="center">
  <img src="./assets/media/quick_filters.gif" alt="cap quick filter demo" width="100%" />
</p>

# cap

`cap` is a Foxglove extension for historical ROS bag and broad MCAP search.

It indexes the currently opened recording inside Foxglove, lets users search for scenes with quick filters or snippets, and jumps straight to the matching timestamp with optional camera previews.

## More Views

![cap quick filters](./assets/readme/overview.svg)

![cap snippets](./assets/readme/snippets.svg)

## Does It Adjust To Different Bags?

Yes, for supported recordings.

When a user opens a different supported recording, `cap` rebuilds its in-panel search index from that data source. That means:

- the quick-filter signal list updates automatically
- camera topic choices update automatically
- snippets still work, but they need to reference signal names that exist in the currently opened recording

## Supported Formats

- ROS bag: supported
- MCAP: supported for common ROS 1, ROS 2, JSON, JSON Schema, and Protobuf recordings

## Quick Start

```powershell
npm install
npm run build
npm run local-install
```

Then restart or reload Foxglove, add the `cap` panel, and open a supported `.bag` or `.mcap`. The panel will build a local index from the opened recording automatically.

## Demo Data

Foxglove's official docs point users to its sample data gallery when they want example recordings. Those datasets are useful for testing, but they are usually too large or awkward to bundle into a public repo.

If an official sample bag is too big, the best alternatives are:

1. Use a tiny derived dataset or mock JSON modeled after the sample recording
2. Trim a recording down to a very short slice for demos only
3. Host larger demo assets separately and load them on demand

## Repo Notes

- Generated `.foxe` bundles are ignored
- Local bag files, MCAP files, and generated indexes are ignored
- Suggested GitHub repo description and topics are in `.github/repository-metadata.md`

## Limitations

- Some MCAPs may still be unsupported if they use uncommon schema or custom message encodings
- Camera previews currently rely on sparse previews from `sensor_msgs/CompressedImage`
- Historical search depends on Foxglove's offline message-range API, so live sources are not currently supported
