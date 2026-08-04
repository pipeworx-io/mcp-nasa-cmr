# mcp-nasa-cmr

NASA CMR (Common Metadata Repository) MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_collections` | Search NASA's Common Metadata Repository for Earth-science dataset collections by keyword, platform (satellite/mission), instrument, time range, or bounding box. ~10k collections covering MODIS, Landsat, Sentinel, VIIRS, GPM, and every NASA DAAC. Sorted by usage. Keyless. |
| `get_collection` | Get full metadata for one NASA Earth-science collection by its CMR concept ID — summary, DOI/landing page, spatial coverage, temporal range, and access links. Keyless. |
| `search_granules` | List the individual data files (granules) of a NASA collection — newest first, with timestamps, file size, and direct download URLs. Filter by time range or bounding box. Keyless. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "nasa-cmr": {
      "url": "https://gateway.pipeworx.io/nasa-cmr/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Nasa Cmr data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
