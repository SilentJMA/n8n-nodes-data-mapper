# Visual Mapper (drag and drop)

> **Node version 2, not the default.** New Data Mapper nodes use the classic field mappings ([Mapping Reference](Mapping-Reference.md)). The visual mapper is kept for nodes already built with it. To build with it, keep or copy an existing version-2 node.

New Data Mapper nodes (node version 2) are a visual mapper: the **target profile** defines the fields you map into, and the **Input panel** on the left is your source. Anything the previous node outputs can be mapped, with no source profile.

## Steps

1. **Output Format**: XML, JSON or CSV.
2. **Source Data**: the incoming item, or XML/JSON text in a field or file.
3. **Source Profile** (optional): paste the structure of the incoming data. Target fields then offer a dropdown of source fields.
4. **Target Profile**: paste the profile (see [Profiles and Auto-Map](Profiles-and-Auto-Map.md#supported-formats) for the formats).
5. **Target Fields**: pick from the source dropdown, drag fields from the Input panel, or choose **Map Automatically**.
6. Run.

Target fields are shown as a tree:

| Label | Meaning |
| --- | --- |
| `order › currency` | `currency` inside `order` |
| `order › line[] › sku` | `sku` in every repeating `line` |
| `order › @id` | XML attribute `id` on `order` |
| `total (number)` | Profile type; numbers and booleans are converted |
| `id *` | Required in the profile |

## What you can drop

| In the box | Result |
| --- | --- |
| A field picked from the Source Profile dropdown | Copies that field; inside a list, every element |
| `{{ $json.OrderID }}` | Copies that field |
| `{{ $json.Items[0].SKU }}` on `line[] › sku` | Maps every item, one `line` each |
| `{{ $json.Currency }}` on `line[] › currency` | Same value in every `line` |
| `{{ $json.Name.trim().toUpperCase() }}` | The expression's result (expressions are your map functions) |
| `{{ $json.Items.map(i => i.SKU) }}` on `line[] › sku` | Element by element |
| `n8n` | Fixed text |
| *(empty)* | Left out, unless **Keep Empty Values** is on |

## Map Automatically

Matches each target field to the most similar source field name. It ignores case and punctuation, expands common abbreviations (`Qty` → `quantity`, `Amt` → `amount`, `OrderNo` → `orderNumber`, `fname` → `firstName`, `zip` → `postalCode`), matches British/American spellings, and keeps lists aligned (`Items[*].SKU` → `lines[*].sku`). Add domain terms with **Custom Synonyms** (`menge=quantity`, one per line or a JSON object). Tune **Auto-Map Minimum Confidence**, and turn on **Add Auto-Map Report** to see what matched.

## Output order and types

Output follows the profile's field order. With **Convert Types From Profile** on, `number` and `boolean` fields are converted; values that can't be converted are kept unchanged.

## CSV

Columns follow the profile. One CSV for all items by default, with a header row. A repeating target produces one row per element, with the other columns repeated on each row. Turn on **Escape CSV Formulas** if the file will be opened in a spreadsheet and holds untrusted values.

## Classic mode

Workflows created with version 1 of the node keep the path-and-transform mode. See [Mapping Reference](Mapping-Reference.md) and [Transforms](Transforms.md).
