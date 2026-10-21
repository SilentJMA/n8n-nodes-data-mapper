# Profiles and Auto-Map

A **target profile** describes the structure you want to map into. The node reads it and gives you a **dropdown of target fields** in manual mode and an **auto-map** mode that matches your source fields to the profile.

## Supported formats

**Target Profile Format** is *Detect Automatically* by default.

| Format | Notes |
| --- | --- |
| Profile Component (XML/JSON/Flat File) | Integration profile components exported as XML (`type="profile.xml"`, `"profile.json"`, `"profile.flatfile"`). Attributes → `.$.name`, repeating elements → `[*]`, JSON `Root`/`Object` wrappers skipped. |
| JSON Schema | `properties`, `required`, `items`, `type`, `format`. |
| Sample JSON | A representative document; array object fields merged into one shape. |
| Sample XML | A representative document; attributes → `.$.name`. |
| XSD | `xs:element` / `xs:complexType` / `xs:attribute`, with `maxOccurs`. |
| CSV Header | First line, split on comma, semicolon, tab or pipe. |

## Paste or upload

**Provide Target Profile** has two options:

- **Paste It** — paste the profile text. Only this source fills the field dropdown.
- **Upload a File** — read the profile from a binary field produced by a **Read/Write Files From Disk**, **Form Trigger** (file upload) or **HTTP Request** node. Auto-map reads it directly; to use the dropdown, paste instead.

## Picking targets (manual mode)

With **Define Mappings** = *Map Each Column Manually*, set a mapping's **Target** to *From Target Profile* and choose the field from the dropdown (it shows each field's path, whether it is a list, and its type). Use *Custom Path* to type a path the profile does not contain.

## Auto-map

With **Define Mappings** = *Auto-Map From Profile*, the node matches each target field to the best source field by name (expanding common abbreviations such as Qty → quantity) and applies the target's type as a transform.

| Option | Default | Description |
| --- | --- | --- |
| Minimum Confidence | 0.6 | 0 (anything) to 1 (identical). Names compared ignoring case and punctuation. |
| Match | Fuzzy | *Fuzzy* allows similar names; *Exact* requires the same name. |
| Case Sensitive | off | Names must match case. |
| Reuse a Source for Several Targets | off | One source may fill several targets. |
| Unmatched Target Fields | Leave Out | Or *Set to Null*. |
| Custom Synonyms | | Extra `source=target` name matches for domain terms. |
| Add Auto-Map Report | off | Adds an `_autoMap` field listing matched and unmatched fields. |

Auto-map respects arrays and never maps a non-repeating source onto a repeating target. To tweak a few fields by hand, use *Map Each Column Manually* with **Auto-Map Remaining Target Fields** on — your manual mappings win, the rest are filled automatically.
