# Working with XML

XML uses the same conventions as n8n's XML node: attributes under `$`, an element's text (when it also has attributes or children) under `_`.

## Reading XML

```xml
<order ID="7"><line><sku>A</sku></line><total currency="EUR">12.50</total></order>
```

| Value | Path |
| --- | --- |
| `7` | `order.$.ID` |
| every SKU | `order.line[*].sku` |
| `12.50` | `order.total._` |
| `EUR` | `order.total.$.currency` |

## Writing XML

Write to `$` for attributes, `_` for text; a list becomes repeated elements.

| Source | Target |
| --- | --- |
| `id` | `order.$.id` |
| `items[*].sku` | `order.line[*].$.sku` |
| `items[*].qty` | `order.line[*].quantity` |

Special characters are escaped automatically. With a single top-level field, that field becomes the root element; otherwise set **Root Element**. An XML target profile supplies the root name for you.
