# Data Mapper wiki

`n8n-nodes-data-mapper` is an [n8n](https://n8n.io) community node that maps and transforms data from one structure to another, between JSON and XML. These pages are the project wiki; the [README](../README.md) is the single-page overview.

> These files mirror the GitHub Wiki. To publish them as a wiki, create the first page in the repo's **Wiki** tab, then copy each file's contents into a page of the same name.

## Pages

- [Installation](Installation.md) — UI install, manual/Docker/Unraid, the `CUSTOM.` prefix
- [Visual Mapper](Visual-Mapper.md) — the drag-and-drop canvas and how to enable it with the n8n Extras Plugin
- [Mapping Reference](Mapping-Reference.md) — paths, `[*]` wildcards, parameters
- [Transforms](Transforms.md) — every transform and its options
- [Functions](Functions.md) — functions in JSON definitions: several inputs and outputs, totals, lookups, chains
- [Profiles and Auto-Map](Profiles-and-Auto-Map.md) — target profiles, upload, the field dropdown, auto-map
- [Working with XML](Working-with-XML.md) — reading and writing XML
- [Examples](Examples.md) — screenshots and importable workflows
- [Security](Security.md) — XML parsing, prototype safety, CSV injection

## At a glance

- **Classic mapper (default):** add a mapping per field — source path or profile field or fixed value → target path or profile field — with transforms, auto-map, or a reusable JSON definition.
- **Functions (JSON definitions, 0.5.0):** string, numeric, date, lookup and language functions with several inputs and outputs, totals and counters, and user-defined chains.
- **Visual Mapper canvas (0.5.2):** set **Define Mappings** to **Visual Mapper** for a source tree, function boxes and a target tree with lines between them. Drawn by the free [n8n Extras Plugin](https://github.com/SilentJMA/n8n-extras-plugin) (switch on **Visual Data Mapper**); without it the same map shows as JSON.
- **Legacy visual mapper (node version 2):** drag Input-panel fields onto target-profile fields. Kept for nodes already built with it; not the default for new nodes.
- **Inputs:** item JSON, or JSON/XML from a field or file.
- **Outputs:** JSON, XML or CSV, as an item field or a file.
- **No runtime dependencies** — copy it straight into an n8n `custom` folder.
