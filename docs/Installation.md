# Installation

## From the n8n UI (recommended)

1. **Settings → Community Nodes → Install**.
2. Enter `n8n-nodes-data-mapper`, accept the risk notice, install.
3. Search **Data Mapper** in the node panel.

Installed this way, the node's type is `n8n-nodes-data-mapper.dataMapper`.

## Manual (self-hosted, Docker, Unraid)

The package has no runtime dependencies, so you can copy it into n8n's `custom` folder:

```bash
# inside your n8n data folder (mapped to /home/node/.n8n in the official Docker image)
mkdir -p custom && cd custom
npm pack n8n-nodes-data-mapper
tar -xzf n8n-nodes-data-mapper-*.tgz && mv package n8n-nodes-data-mapper
```

Restart n8n. On Unraid the data folder is usually `/mnt/user/appdata/n8n`, and you must fully **stop and start** the container (a soft restart may not re-scan `custom/`).

## The `CUSTOM.` prefix

n8n registers nodes differently depending on how they were installed:

| Install method | Node type |
| --- | --- |
| Community Nodes (npm) | `n8n-nodes-data-mapper.dataMapper` |
| `custom` folder | `CUSTOM.dataMapper` |

This only matters when **importing a workflow JSON**. If an imported node shows as `?`, add the node from the panel instead, or edit the file's `type` to match your install.
