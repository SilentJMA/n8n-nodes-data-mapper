# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-10-20

### Added

- **Source Profile.** Optionally paste the structure of the incoming data. In the visual mapper every target field then offers a dropdown of source fields; in classic mode each mapping can use **Source: From Source Profile**.
- **Source Data** setting in the visual mapper: map the incoming item, or XML/JSON text in a field or file (for example a raw order in `data`).
- Fields picked from a profile (or dragged from a single-element list) find the lists in the actual data, so a profile made from a one-item sample maps every item of a real order.
- A sample-XML target profile supplies the XML root element automatically.
- **Escape CSV Formulas** option against CSV injection.

### Security

- Field names and paths such as `__proto__` can no longer modify `Object.prototype` (prototype pollution), whether they come from mappings, profiles, lookup tables or the data.
- Source paths only read the data's own fields, never inherited members such as `constructor`.
- XML nested deeper than 1,000 levels, and data nested deeper than 200 levels when listing fields, is handled with a clear error or limit instead of exhausting the stack.

### Fixed

- XML attributes named `constructor`, `toString` and the like were rejected as duplicates.
- Field names containing dots, brackets or spaces are quoted in paths (`a["first name"]`), so they are no longer mistaken for nesting.

[0.4.0]: https://github.com/SilentJMA/n8n-nodes-data-mapper/releases/tag/v0.4.0

## 0.3.1 - 2026-10-20 (not released separately; included in 0.4.0)

### Fixed

- A list expression on a repeating target now skips positions without a value (`null`/`undefined`) instead of writing empty elements, so optional blocks such as a per-line discount only appear on the lines that have one.

## 0.3.0 - 2026-10-20 (not released separately; included in 0.4.0)

### Added

- **Visual mapper (node version 2, the new default).** Paste a target profile and its fields load as a target tree; drag fields from n8n's Input panel onto them, or choose **Map Automatically**. No source profile needed.
- Dragging a field from a list onto a repeating target maps every element; a single value dropped on a repeating target fills every element; an expression returning a list is spread element by element.
- **CSV output**, with one CSV for all items, header row, delimiter and line-ending options, and one row per repeating element.
- Output follows the target profile's field order.
- Lenient type conversion from the profile: values that can't be converted are kept instead of failing.

### Changed

- Existing workflows keep node version 1 (classic mode) unchanged.

## [0.2.0] - 2026-10-17

### Added

- **Target profiles.** Load the structure to map into — by pasting it or uploading a file — from a profile component exported as XML/JSON/Flat File, JSON Schema, sample JSON, sample XML, XSD or a CSV header.
- **Target field dropdown.** In manual mode, pick a mapping's target from the profile instead of typing a path, with a custom-path fallback.
- **Auto-map.** A new "Auto-Map From Profile" mode matches source fields to the target profile by name and applies each target's type as a transform. Options for confidence threshold, fuzzy/exact matching, case sensitivity, source reuse, unmatched handling and a match report.
- **Auto-Map Remaining Target Fields** toggle in fields mode to fill the gaps after manual mapping.
- **Upload or paste** the target profile: read it from an uploaded binary file, or paste the text.
- Friendlier UI: a clear profile source selector, a guiding notice, neutral format names and better labels.
- Screenshots, wiki pages under `docs/`, and extra example workflows (`fixed-workflow.json`, `xml-output-workflow.json`).

[0.2.0]: https://github.com/SilentJMA/n8n-nodes-data-mapper/releases/tag/v0.2.0

## [0.1.0] - 2026-10-17

### Added

- **Data Mapper** node that maps data from one structure to another.
- Path syntax with nested fields, array indexes, `[*]` wildcards and quoted keys.
- Wildcard alignment between source and target, collecting into lists when the target has fewer `[*]`, and broadcasting fixed values over existing arrays.
- Transforms: to string, number, integer and boolean; round; trim, uppercase and lowercase; date formatting; split and join; lookup tables.
- Missing value handling per mapping: leave out, null, default value or error.
- Mappings defined in the node UI or as a reusable JSON definition, with validation of unknown properties.
- Input from item JSON, or JSON/XML text in a field or file, with automatic format detection.
- Output as JSON, JSON file, XML text or XML file, with configurable root element and declaration.
- Errors name the mapping that failed, and XML errors include line and column.

[0.1.0]: https://github.com/SilentJMA/n8n-nodes-data-mapper/releases/tag/v0.1.0
