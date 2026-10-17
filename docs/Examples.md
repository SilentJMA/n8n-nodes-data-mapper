# Examples

Import the files from the [`examples/`](../examples) folder (**Workflows → Import from File**), or add **Data Mapper** from the node panel.

| File | Shows |
| --- | --- |
| `data-mapper-examples.json` | JSON, XML and CSV output side by side |
| `auto-map-with-profile.json` | Auto-map and the profile-field dropdown |
| `fixed-workflow.json` | Field mapping to JSON (first screenshot) |
| `xml-output-workflow.json` | Building XML with transforms and added fields (second screenshot) |

> Workflow files in `examples/` use the `n8n-nodes-data-mapper.dataMapper` type (UI install). `fixed-workflow.json` and `xml-output-workflow.json` use the `CUSTOM.dataMapper` type (custom-folder install). See [Installation](Installation.md#the-custom-prefix).

## Mapping to JSON

![JSON mapping](images/json-mapping.webp)

Rename and nest fields, convert types, and reshape arrays — for example `OrderID → CustomerOrderID`, `OrderDate → BillingDate` (Format Date), `Amount → Total` (To Number), and `Items[*].SKU → Lines[*].Product`.

## Building XML

![XML output](images/xml-output.webp)

Write attributes with `.$.`, element text with `._`, and repeated elements with `[*]`, while applying transforms and adding fixed or generated fields. See the full mapping table in the [README](../README.md#build-an-xml-invoice-with-transforms).
