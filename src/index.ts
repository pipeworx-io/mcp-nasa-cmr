interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * NASA CMR (Common Metadata Repository) MCP.
 *
 * Catalog search across NASA's entire Earth-science data holdings (~10k
 * collections: satellite missions, instruments, datasets) plus the individual
 * data files (granules) inside each collection. Keyless.
 */


const BASE = 'https://cmr.earthdata.nasa.gov/search';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_collections',
    description:
      "Search NASA's Common Metadata Repository for Earth-science dataset collections by keyword, platform (satellite/mission), instrument, time range, or bounding box. ~10k collections covering MODIS, Landsat, Sentinel, VIIRS, GPM, and every NASA DAAC. Sorted by usage. Keyless.",
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'Free-text keyword, e.g. "aerosol", "sea surface temperature", "land cover".',
        },
        platform: {
          type: 'string',
          description: 'Platform (satellite/mission) name, e.g. "Terra", "Landsat-9", "Sentinel-1A", "Suomi-NPP".',
        },
        instrument: {
          type: 'string',
          description: 'Instrument name, e.g. "MODIS", "OLI", "VIIRS", "ASTER".',
        },
        temporal_start: {
          type: 'string',
          description: 'Start of temporal filter, YYYY-MM-DD. Collections overlapping the range match.',
        },
        temporal_end: {
          type: 'string',
          description: 'End of temporal filter, YYYY-MM-DD.',
        },
        bounding_box: {
          type: 'string',
          description: 'Spatial filter "minLon,minLat,maxLon,maxLat", e.g. "-125,32,-114,42" for California.',
        },
        limit: { type: 'number', description: 'Max results (default 10, max 25).' },
      },
    },
  },
  {
    name: 'get_collection',
    description:
      'Get full metadata for one NASA Earth-science collection by its CMR concept ID — summary, DOI/landing page, spatial coverage, temporal range, and access links. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        concept_id: {
          type: 'string',
          description:
            'CMR collection concept ID, e.g. "C1748058432-LPCLOUD" (MODIS/Terra Land Surface Temperature MOD11A1). Get IDs from search_collections.',
        },
      },
      required: ['concept_id'],
    },
  },
  {
    name: 'search_granules',
    description:
      'List the individual data files (granules) of a NASA collection — newest first, with timestamps, file size, and direct download URLs. Filter by time range or bounding box. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        concept_id: {
          type: 'string',
          description: 'CMR collection concept ID, e.g. "C1748058432-LPCLOUD". Get IDs from search_collections.',
        },
        temporal_start: {
          type: 'string',
          description: 'Start of temporal filter, YYYY-MM-DD. Granules overlapping the range match.',
        },
        temporal_end: {
          type: 'string',
          description: 'End of temporal filter, YYYY-MM-DD.',
        },
        bounding_box: {
          type: 'string',
          description: 'Spatial filter "minLon,minLat,maxLon,maxLat".',
        },
        limit: { type: 'number', description: 'Max results (default 10, max 25).' },
      },
      required: ['concept_id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'search_collections':
        return searchCollections(args);
      case 'get_collection':
        return getCollection(args);
      case 'search_granules':
        return searchGranules(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type Entry = Record<string, unknown>;
type Link = { rel?: string; href?: string };

function clampLimit(value: unknown, fallback = 10, max = 25): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}

/** Shared temporal + bounding_box query params (CMR ISO temporal range syntax). */
function buildParams(args: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  const start = typeof args.temporal_start === 'string' ? args.temporal_start.trim() : '';
  const end = typeof args.temporal_end === 'string' ? args.temporal_end.trim() : '';
  if (start || end) {
    const iso = (d: string, endOfDay: boolean) =>
      d ? (d.includes('T') ? d : `${d}T${endOfDay ? '23:59:59' : '00:00:00'}Z`) : '';
    params.set('temporal', `${iso(start, false)},${iso(end, true)}`);
  }
  const bbox = typeof args.bounding_box === 'string' ? args.bounding_box.trim() : '';
  if (bbox) params.set('bounding_box', bbox);
  return params;
}

async function cmrGet(path: string, params: URLSearchParams): Promise<Entry[] | { error: string }> {
  const res = await fetch(`${BASE}${path}?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) return { error: `NASA CMR: ${res.status} ${(await res.text()).slice(0, 200)}` };
  const data = (await res.json()) as { feed?: { entry?: Entry[] } };
  return Array.isArray(data.feed?.entry) ? data.feed.entry : [];
}

function findLink(entry: Entry, relPart: string): string | null {
  const links = Array.isArray(entry.links) ? (entry.links as Link[]) : [];
  return links.find((l) => typeof l.rel === 'string' && l.rel.includes(relPart))?.href ?? null;
}

function findDoi(entry: Entry): string | null {
  const links = Array.isArray(entry.links) ? (entry.links as Link[]) : [];
  const link = links.find(
    (l) =>
      typeof l.href === 'string' &&
      (l.href.includes('doi.org') || (typeof l.rel === 'string' && l.rel.includes('metadata#'))),
  );
  return link?.href ?? null;
}

function mapCollection(entry: Entry, summaryLimit = 300): Entry {
  const summary = typeof entry.summary === 'string' ? entry.summary : '';
  return {
    concept_id: entry.id,
    title: entry.title,
    short_name: entry.short_name,
    version: entry.version_id,
    summary: summary.length > summaryLimit ? `${summary.slice(0, summaryLimit)}…` : summary,
    data_center: entry.data_center,
    time_start: entry.time_start ?? null,
    time_end: entry.time_end ?? null,
    processing_level: entry.processing_level_id ?? null,
    has_browse: entry.browse_flag ?? false,
    online_access: entry.online_access_flag ?? false,
    doi: findDoi(entry),
  };
}

async function searchCollections(args: Record<string, unknown>): Promise<unknown> {
  const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
  const platform = typeof args.platform === 'string' ? args.platform.trim() : '';
  const instrument = typeof args.instrument === 'string' ? args.instrument.trim() : '';
  if (!keyword && !platform && !instrument) {
    return { error: 'provide at least one of keyword, platform, or instrument' };
  }

  const params = buildParams(args);
  if (keyword) params.set('keyword', keyword);
  if (platform) params.set('platform', platform);
  if (instrument) params.set('instrument', instrument);
  params.set('page_size', String(clampLimit(args.limit)));
  params.append('sort_key[]', '-usage_score');

  const entries = await cmrGet('/collections.json', params);
  if (!Array.isArray(entries)) return entries;
  return { count: entries.length, collections: entries.map((e) => mapCollection(e)) };
}

async function getCollection(args: Record<string, unknown>): Promise<unknown> {
  const conceptId = typeof args.concept_id === 'string' ? args.concept_id.trim() : '';
  if (!conceptId) return { error: 'provide a concept_id', concept_id: args.concept_id ?? null };

  const params = new URLSearchParams({ concept_id: conceptId });
  const entries = await cmrGet('/collections.json', params);
  if (!Array.isArray(entries)) return entries;
  if (entries.length === 0) return { error: 'collection not found', concept_id: conceptId };

  const entry = entries[0];
  const links = Array.isArray(entry.links) ? (entry.links as Link[]) : [];
  return {
    ...mapCollection(entry, 800),
    archive_center: entry.archive_center ?? null,
    boxes: entry.boxes ?? null,
    original_format: entry.original_format ?? null,
    links: links.slice(0, 5).map((l) => ({ rel: l.rel, href: l.href })),
  };
}

async function searchGranules(args: Record<string, unknown>): Promise<unknown> {
  const conceptId = typeof args.concept_id === 'string' ? args.concept_id.trim() : '';
  if (!conceptId) return { error: 'provide a collection concept_id', concept_id: args.concept_id ?? null };

  const params = buildParams(args);
  params.set('concept_id', conceptId);
  params.set('page_size', String(clampLimit(args.limit)));
  params.append('sort_key[]', '-start_date');

  const entries = await cmrGet('/granules.json', params);
  if (!Array.isArray(entries)) return entries;
  return {
    count: entries.length,
    granules: entries.map((g) => ({
      id: g.id,
      title: g.title,
      time_start: g.time_start ?? null,
      time_end: g.time_end ?? null,
      size_mb: g.granule_size != null ? Number(g.granule_size) : null,
      download_url: findLink(g, 'data#'),
    })),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
