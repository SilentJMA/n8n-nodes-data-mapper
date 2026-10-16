# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
