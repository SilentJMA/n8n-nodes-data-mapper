# Transforms

| Transform | Options | Example |
| --- | --- | --- |
| None | | |
| To String | | `42` → `"42"`; objects become JSON text |
| To Number | | `"10.5"` → `10.5` (fails on non-numbers) |
| To Integer | | `"10.9"` → `10` |
| Round | Decimal Places | `10.456` → `10.46` |
| To Boolean | | `yes`/`no`, `true`/`false`, `1`/`0`, `on`/`off` |
| Trim, Uppercase, Lowercase | | Also applied to each string in a list |
| Format Date | Input / Output Date Format | `20261017` (`yyyyMMdd`) → `17/10/2026` (`dd/MM/yyyy`). Empty input = ISO/Unix ms; empty output = ISO. Tokens `yyyy MM dd HH mm ss SSS`, UTC. |
| Split Into List | Separator | `"a, b"` → `["a", "b"]` |
| Join List | Separator | `["a", "b"]` → `"a,b"` |
| Lookup Table | Lookup Table, If No Match | `key=value` lines or a JSON object; on no match keep / default / null / error. |
| Concatenate | Concatenate Template | `{value} {lastName}` → `"Ann Lee"`. `{value}` is this value, `{path}` reads another input field (with `[*]`, from the same list element); other text is kept as typed. |

For anything else, use a **Fixed Value** with an expression, e.g. `{{ $json.first + ' ' + $json.last }}`.
