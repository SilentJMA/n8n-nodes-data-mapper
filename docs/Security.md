# Security

## What the package contains

The npm package holds only the compiled node, its icons and metadata. It has **no runtime dependencies**, so installing it adds nothing else to your n8n.

## XML

- DTDs and entity declarations are skipped. There are no external entities (XXE) and no entity expansion ("billion laughs").
- Only `&lt; &gt; &amp; &quot; &apos;` and numeric references are decoded; any other `&name;` stays as text.
- Elements nested deeper than 1,000 levels are rejected with a clear error.

## Data and paths

- Keys such as `__proto__`, `constructor` and `prototype` are plain data everywhere: in mappings, target and source profiles, lookup tables, XML element and attribute names, and incoming JSON. They can't modify `Object.prototype`.
- Source paths read only the data's own fields, never inherited members.
- Mappings, profiles and lookup tables are never evaluated as code. Expressions in fields are evaluated by n8n, as in any node.

## CSV

Values that start with `=`, `+`, `-`, `@`, a tab or a carriage return can run as formulas in spreadsheet apps. Turn on **Escape CSV Formulas** to prefix them with `'` when the CSV holds untrusted values.

## Reporting a problem

Please open an issue on GitHub with the steps to reproduce.
