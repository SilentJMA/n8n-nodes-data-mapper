# n8n-nodes-data-mapper

[![npm version](https://img.shields.io/npm/v/n8n-nodes-data-mapper.svg)](https://www.npmjs.com/package/n8n-nodes-data-mapper)
[![CI](https://github.com/SilentJMA/n8n-nodes-data-mapper/actions/workflows/ci.yml/badge.svg)](https://github.com/SilentJMA/n8n-nodes-data-mapper/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [n8n](https://n8n.io) community node that **maps data from one structure to another**. Rename and nest fields, map whole arrays with `[*]`, convert types, format dates, translate codes with lookup tables, and convert between **JSON and XML**, all in one node.

Use it to turn an API response into your internal format, shape database rows into a request payload, read a supplier's XML into clean JSON, or pull just the useful parts out of a large payload.

- [Installation](#installation)
- [Quick start](#quick-start)
- [Paths](#paths)
- [Parameters](#parameters)
- [Transforms](#transforms)
- [Reusable JSON definitions](#reusable-json-definitions)
- [Working with XML](#working-with-xml)
- [Examples](#examples)
- [Compatibility](#compatibility)
- [Development](#development)
- [License](#license)

## Installation

### From the n8n UI (recommended)

1. In n8n, open **Settings → Community Nodes**.
2. Select **Install**, enter `n8n-nodes-data-mapper`, accept the risk notice and install.
3. Search for **Data Mapper** in the node panel.

### Manually (self-hosted, Docker, Unraid)

The package has no runtime dependencies, so you can drop it into n8n's `custom` folder:

```bash
# inside your n8n data folder (mapped to /home/node/.n8n in the official Docker image)
mkdir -p custom && cd custom
npm pack n8n-nodes-data-mapper
tar -xzf n8n-nodes-data-mapper-*.tgz && mv package n8n-nodes-data-mapper
```

Restart n8n afterwards.

## Quick start

Given this input item:

```json
{
  "id": "A1",
  "customer": { "name": "  Ann ", "country": "NL" },
  "items": [
    { "sku": "P-1", "qty": "2" },
    { "sku": "P-2", "qty": "1" }
  ]
}
```

add these mappings:

| Source Path | Target Path | Transform |
| --- | --- | --- |
| `id` | `orderId` | |
| `customer.name` | `buyer.name` | Trim |
| `customer.country` | `buyer.country` | Lookup Table: `NL=Netherlands` |
| `items[*].sku` | `lines[*].productCode` | |
| `items[*].qty` | `lines[*].quantity` | To Integer |
| *Fixed Value* `EUR` | `lines[*].currency` | |

and get:

```json
{
  "orderId": "A1",
  "buyer": { "name": "Ann", "country": "Netherlands" },
  "lines": [
    { "productCode": "P-1", "quantity": 2, "currency": "EUR" },
    { "productCode": "P-2", "quantity": 1, "currency": "EUR" }
  ]
}
```

Import [`examples/data-mapper-examples.json`](examples/data-mapper-examples.json) into n8n (**Workflows → Import from File**) to try this and the XML examples.

## Paths

| Syntax | Meaning |
| --- | --- |
| `customer.name` | Nested field |
| `items[0].sku` | One array element |
| `items[*].sku` | Every array element |
| `["first name"]` or `data["x-id"]` | Keys with spaces or special characters |
| *(empty)* | The whole input (source) or the whole output (target, value must be an object) |

How `[*]` in the source and target line up:

- **Same number of `[*]`**: elements are matched by position. `items[*].sku` → `lines[*].code` writes `lines[0].code`, `lines[1].code`, … Mappings that share a target array build up the same elements, so several mappings can fill in one array of objects.
- **Fewer `[*]` in the target**: the extra levels are collected into a list. `items[*].sku` → `skus` gives `["P-1", "P-2"]`. `orders[*].items[*].sku` → `orders[*].skus` gives one list per order, and an empty list for an order with no items.
- **More `[*]` in the target**: not allowed, except for a fixed value, which is written to every existing element (`EUR` → `lines[*].currency`).
- A single object where `[*]` expects an array is treated as a one-element array. This matters for XML, where one child element is not an array.

Mappings run in order, and a later mapping to the same target overwrites an earlier one.

## Parameters

| Parameter | Description |
| --- | --- |
| **Input** | *Item JSON* maps each incoming item. *Text Field* first parses JSON or XML text stored in a field. *File* first parses a JSON or XML binary file. |
| **Input Field** / **Input Binary Field** | Which field holds the text or file. |
| **Input Format** | *Detect Automatically* (XML when the text starts with `<`), *JSON* or *XML*. |
| **Define Mappings** | *Using Fields Below* or *Using JSON*. See [Reusable JSON definitions](#reusable-json-definitions). |
| **Mappings** | The list of mappings. Each has a **Source** (*Input Field* path or *Fixed Value*, which can be an expression), a **Target Path**, an optional **Transform**, and **If Source Is Missing**: *Leave Out* (default), *Set to Null*, *Use Default* or *Stop With Error*. |
| **Unmapped Fields** | *Drop* outputs only mapped fields. *Keep* starts from a copy of the input and applies the mappings on top. |
| **Output Format** | *JSON* (the item), *JSON File*, *XML* (text in a field) or *XML File*. |
| **Put Output in Field** | *XML only.* Default `xml`. |
| **Put Output File in Field** / **File Name** | *File outputs only.* Defaults `data` and `output.xml` / `output.json`. |
| **Root Element** | *XML outputs only.* Leave empty to use the single top-level field as the root, or `root` when there are several. |
| **Include XML Declaration** | *XML outputs only.* Adds `<?xml version="1.0" encoding="UTF-8"?>`. |

Turn on **Settings → On Error → Continue** to output failed items as `{ "error": "…" }`. Every error names the mapping that caused it, e.g. `Mapping 3 (→ lines[*].quantity): Cannot convert "two" to a number`.

## Transforms

| Transform | Options | Example |
| --- | --- | --- |
| None | | |
| To String | | `42` → `"42"`; objects become JSON text |
| To Number | | `"10.5"` → `10.5` (fails on non-numbers) |
| To Integer | | `"10.9"` → `10` |
| Round | Decimal Places | `10.456` → `10.46` |
| To Boolean | | `yes`/`no`, `true`/`false`, `1`/`0`, `on`/`off`, `y`/`n` |
| Trim, Uppercase, Lowercase | | Also applied to every string in a list |
| Format Date | Input Date Format, Output Date Format | `20261017` with `yyyyMMdd` → `17/10/2026` with `dd/MM/yyyy`. Empty input format reads ISO 8601 or Unix milliseconds; empty output format writes ISO 8601. Tokens: `yyyy MM dd HH mm ss SSS`, in UTC. |
| Split Into List | Separator | `"a, b"` → `["a", "b"]` |
| Join List | Separator | `["a", "b"]` → `"a,b"`. With `items[*].sku` → `skuList` it joins the collected list. |
| Lookup Table | Lookup Table, If No Match | Table as `key=value` lines or a JSON object. If no match: *Keep Original Value*, *Use Default*, *Set to Null* or *Stop With Error*. |

For anything else, use a **Fixed Value** with an expression, e.g. `{{ $json.first + ' ' + $json.last }}`.

## Reusable JSON definitions

Set **Define Mappings** to **Using JSON** to describe the mapping as data. You can paste it in, or load it with an expression so one mapping is shared by many workflows. For example, `{{ $('Get mapping').item.json.mapping }}` can read it from a database row, a file or a static data node.

```json
[
  { "source": "id", "target": "orderId" },
  { "source": "customer.name", "target": "buyer.name", "transform": "trim" },
  { "source": "items[*].sku", "target": "lines[*].productCode" },
  { "source": "items[*].qty", "target": "lines[*].quantity", "transform": "integer" },
  { "source": "created", "target": "orderDate", "transform": "date", "dateInputFormat": "yyyyMMdd", "dateOutputFormat": "yyyy-MM-dd" },
  { "source": "customer.country", "target": "buyer.country", "transform": "lookup", "lookup": { "NL": "Netherlands" }, "lookupFallback": "keep" },
  { "source": "note", "target": "comment", "ifMissing": "default", "default": "" },
  { "value": "EUR", "target": "lines[*].currency" }
]
```

`{ "mappings": [ … ] }` also works. Available properties per mapping:

| Property | Values |
| --- | --- |
| `target` | Target path (required) |
| `source` | Source path |
| `value` | Fixed value, used instead of `source` |
| `transform` | `none`, `string`, `number`, `integer`, `round`, `boolean`, `trim`, `uppercase`, `lowercase`, `date`, `split`, `join`, `lookup` |
| `ifMissing` | `skip` (default), `null`, `default`, `error` |
| `default` | Value for `ifMissing: "default"` |
| `separator` | For `split` and `join` (default `,`) |
| `decimals` | For `round` |
| `dateInputFormat`, `dateOutputFormat` | For `date` |
| `lookup` | Object or `key=value` lines, for `lookup` |
| `lookupFallback` | `keep` (default), `default`, `null`, `error` |
| `lookupDefault` | Value for `lookupFallback: "default"` |

Unknown properties are rejected, so a typo such as `"tranform"` fails loudly instead of being ignored.

## Working with XML

XML input is converted with the same conventions as n8n's XML node: attributes go under `$` and an element's text, when it also has attributes or children, goes under `_`.

```xml
<order ID="7">
  <line><sku>A</sku><qty>3</qty></line>
  <line><sku>B</sku><qty>1</qty></line>
  <total currency="EUR">12.50</total>
</order>
```

| Value | Path |
| --- | --- |
| `7` | `order.$.ID` |
| every SKU | `order.line[*].sku` |
| `12.50` | `order.total._` |
| `EUR` | `order.total.$.currency` |

XML output works the other way round. Write to `$` for attributes, `_` for text, and a list becomes repeated elements:

| Source Path | Target Path |
| --- | --- |
| `id` | `order.$.id` |
| `items[*].sku` | `order.line[*].$.sku` |
| `items[*].qty` | `order.line[*].quantity` |

```xml
<?xml version="1.0" encoding="UTF-8"?>
<order id="A1">
  <line sku="P-1">
    <quantity>2</quantity>
  </line>
  <line sku="P-2">
    <quantity>1</quantity>
  </line>
</order>
```

Special characters are escaped automatically. Invalid XML input fails with the line and column of the problem.

## Examples

### Distill a large API response

Keep three fields from a big payload: **Unmapped Fields** *Drop*, with mappings `data.user.id` → `id`, `data.user.profile.email` → `email` (Lowercase) and `data.user.roles[*].name` → `roles`.

### Convert JSON to an XML file for an SFTP upload

**Output Format** *XML File*, **Root Element** `invoice`, **File Name** `{{ $json.number }}.xml`, then connect an FTP node.

### Normalize data from several sources

Put one Data Mapper on each source branch, each mapping into the same target shape, then merge the branches.

## Compatibility

- n8n 1.x and 2.x (Nodes API version 1)
- Node.js 20.15 or newer for development

## Development

```bash
git clone https://github.com/SilentJMA/n8n-nodes-data-mapper.git
cd n8n-nodes-data-mapper
npm install --ignore-scripts
npm run dev     # local n8n at http://localhost:5678 with the node loaded
npm run lint
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout and release process, and [CHANGELOG.md](CHANGELOG.md) for version history.

## License

[MIT](LICENSE)
