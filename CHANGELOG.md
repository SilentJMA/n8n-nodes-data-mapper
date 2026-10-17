# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
