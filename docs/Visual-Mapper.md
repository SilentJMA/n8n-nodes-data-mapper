# Visual Mapper (canvas)

The **Visual Mapper** draws your mapping as a canvas: a **source tree** on the left, **function boxes** in the middle, and a **target tree** on the right, with lines between them. It edits the same JSON definition as [Reusable JSON definitions](Mapping-Reference.md), so a map you draw runs exactly like **Using JSON** — on any n8n that has this node, with or without the editor.

## How to enable it

The canvas is drawn by the free, open-source [**n8n Extras Plugin**](https://github.com/SilentJMA/n8n-extras-plugin). This node ships the mapping engine and stores the map; the plugin adds the drawing surface. You need all three of these:

1. **Run n8n with the plugin.** The drawing surface must be built into your n8n — a stock n8n cannot show it. The easiest way is the prebuilt image:
   ```
   ghcr.io/silentjma/n8n-extras:latest
   ```
   (or apply the overlay yourself; see the [plugin install guide](https://github.com/SilentJMA/n8n-extras-plugin/blob/main/docs/installation.md)).
2. **Turn the feature on.** Open **Settings → Integrations → Plugins** and switch on **Visual Data Mapper**.
3. **Pick the Visual Mapper mode on the node.** In a **Data Mapper** node, set **Define Mappings** to **Visual Mapper** (use the node's default version, v1). Paste a **Target Profile** (sample JSON or XML, JSON Schema, XSD, or a CSV header) and, optionally, a **Source Profile**. Without a source profile, the first input item is the source — run the previous node first.

> **The canvas only appears when Define Mappings = Visual Mapper.** It is a mode of the node, not an always-on view. On any other mode (*Map Each Column Manually*, *Auto-Map From Profile*, *Using JSON*) you see that mode's own fields instead. Step 3 is the one most people miss.

**Not seeing the canvas?** Check, in order:

- **Define Mappings** on the node is set to **Visual Mapper** (not *Map Each Column Manually*).
- This node is **0.5.2 or newer** (Settings → Community nodes). Before 0.5.2 there is no Visual Mapper option.
- Your n8n is the plugin build (Settings → Integrations → **Plugins** page exists) and **Visual Data Mapper** is on.
- The node is the default version **v1**. The Visual Mapper is a v1 mode; v2 is a separate, older mapper without the canvas.
- After updating the image or the node, **restart n8n** and **hard-refresh** the browser (Cmd/Ctrl+Shift+R) — n8n serves its editor bundle from startup.

> **Without the plugin, nothing breaks.** The **Visual Mapper** option still works; it shows the same map as an editable JSON box instead of a canvas. Every [function](Functions.md) stays available through **Using JSON**. The plugin only draws the canvas — it is never required to run a workflow.

## On the canvas

- Drag a **source** field onto a **target** field to map it.
- **+ Add function** adds a function box: string, numeric (exact decimals, Sum, Count, counters), date, language, Simple Lookup, SQL Lookup, Data Table Lookup and user-defined chains. Drag source fields onto its inputs and its outputs onto target fields. A function never feeds another function directly.
- The pencil on a target field sets a fixed value. **Auto-map** maps fields with similar names.
- Select a line, a field or a function to edit it: its fields, ports and lines turn purple and the other lines fade.

The map is stored in the node as a JSON definition (`{ "mappings": [...], "functions": [...] }`), the same format as **Define Mappings → Using JSON**. Output follows the **order of the target profile**, which matters to XML consumers and XSD validation.

## Legacy: drag-and-drop target-fields mapper (node version 2)

An earlier **node version 2** has a different visual mapper, built into n8n with no plugin: the **target profile** defines the fields, and the **Input panel** on the left is the source. It stays available so nodes already built with it keep working; new nodes default to version 1 (the mapping above).

1. **Output Format**: XML, JSON or CSV.
2. **Source Data**: the incoming item, or XML/JSON text in a field or file.
3. **Source Profile** (optional): paste the structure of the incoming data. Target fields then offer a dropdown of source fields.
4. **Target Profile**: paste the profile (see [Profiles and Auto-Map](Profiles-and-Auto-Map.md#supported-formats)).
5. **Target Fields**: pick from the source dropdown, drag fields from the Input panel, or choose **Map Automatically**.
6. Run.

What you can drop into a target box:

| In the box | Result |
| --- | --- |
| A field picked from the Source Profile dropdown | Copies that field; inside a list, every element |
| `{{ $json.OrderID }}` | Copies that field |
| `{{ $json.Items[0].SKU }}` on `line[] › sku` | Maps every item, one `line` each |
| `{{ $json.Currency }}` on `line[] › currency` | Same value in every `line` |
| `{{ $json.Name.trim().toUpperCase() }}` | The expression's result (expressions are your map functions) |
| `n8n` | Fixed text |
| *(empty)* | Left out, unless **Keep Empty Values** is on |

**Map Automatically** matches each target field to the most similar source field name (case- and punctuation-insensitive, expands common abbreviations, keeps lists aligned). Output follows the profile's field order; with **Convert Types From Profile** on, `number` and `boolean` fields are converted.

## Classic mode

Workflows created with version 1 of the node use the path-and-transform mode. See [Mapping Reference](Mapping-Reference.md) and [Transforms](Transforms.md).
