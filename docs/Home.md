# Data Mapper wiki

`n8n-nodes-data-mapper` is an [n8n](https://n8n.io) community node that maps and transforms data from one structure to another, between JSON and XML. These pages are the project wiki; the [README](../README.md) is the single-page overview.

> These files mirror the GitHub Wiki. To publish them as a wiki, create the first page in the repo's **Wiki** tab, then copy each file's contents into a page of the same name.

## Pages

- [Installation](Installation.md) — UI install, manual/Docker/Unraid, the `CUSTOM.` prefix
- [Mapping Reference](Mapping-Reference.md) — paths, `[*]` wildcards, parameters
- [Transforms](Transforms.md) — every transform and its options
- [Profiles and Auto-Map](Profiles-and-Auto-Map.md) — target profiles, upload, the field dropdown, auto-map
- [Working with XML](Working-with-XML.md) — reading and writing XML
- [Examples](Examples.md) — screenshots and importable workflows

## At a glance

- **Modes:** map with fields, auto-map from a profile, or a reusable JSON definition.
- **Inputs:** item JSON, or JSON/XML from a field or file.
- **Outputs:** JSON, JSON file, XML or XML file.
- **No runtime dependencies** — copy it straight into an n8n `custom` folder.
