# Mapping Reference

## Paths

| Syntax | Meaning |
| --- | --- |
| `customer.name` | Nested field |
| `items[0].sku` | One array element |
| `items[*].sku` | Every array element |
| `["first name"]` | Keys with spaces or special characters |
| *(empty)* | The whole input (source) or whole output (target) |

### How `[*]` lines up between source and target

- **Same number of `[*]`** — matched by position. `items[*].sku` → `lines[*].code`. Several mappings sharing a target array build up the same objects.
- **Fewer `[*]` in the target** — collected into a list. `items[*].sku` → `skus` gives `["P-1", "P-2"]`.
- **More `[*]` in the target** — not allowed, except a fixed value, which is written to every existing element.
- A single object where `[*]` expects an array is treated as a one-element array (matters for XML).

Mappings run in order; a later mapping to the same target overwrites an earlier one.

## Parameters

| Parameter | Description |
| --- | --- |
| **Input** | *Item JSON*, *Text Field* (parse JSON/XML text), or *File* (parse a JSON/XML file). |
| **Input Format** | *Detect Automatically*, *JSON* or *XML*. |
| **Define Mappings** | *Map Each Column Manually*, *Auto-Map From Profile*, or *Using JSON*. Under *Map Each Column Manually*, **Mapping Layout** is *One Mapping at a Time* or *Fill Target Fields* (lists every target field; set the source for each). |
| **Target Profile** | Optional structure to map into. See [Profiles and Auto-Map](Profiles-and-Auto-Map.md). |
| **Source Profile** | Optional structure of the incoming data (classic mode). Enables **Source: From Source Profile** with a dropdown of source fields. |
| **Mappings** | Each has a **Source** (field path, a field from the source profile, or fixed value), a **Target** (custom path or profile field), a **Transform**, and **If Source Is Missing**. |
| **Unmapped Fields** | *Drop* keeps only mapped fields; *Keep* starts from a copy of the input. |
| **Output Format** | *JSON*, *JSON File*, *XML* or *XML File*. |

Turn on **Settings → On Error → Continue** to output failed items as `{ "error": "…" }`. Every error names the mapping that caused it.
