---
name: analyze-bundle
description: Convert Next.js bundle analyzer data to NDJSON and explore it
allowed-tools: Bash(node *) Bash(head:*) Bash(tail:*) Bash(grep:*) Bash(jq:*) Read
---

# analyze-to-ndjson

Converts Next.js bundle analyzer binary `.data` files into grep/jq-friendly NDJSON.

## Analyze artifacts

This workflow pre-generates analyzer artifacts in:

- `.next/diagnostics/analyze/ndjson/routes.ndjson`
- `.next/diagnostics/analyze/ndjson/sources.ndjson`
- `.next/diagnostics/analyze/ndjson/output_files.ndjson`
- `.next/diagnostics/analyze/ndjson/module_edges.ndjson`
- `.next/diagnostics/analyze/ndjson/modules.ndjson`

Focus on reading these files and using their evidence to prioritize changes.

## Output files

| File | What's in it |
|---|---|
| `modules.ndjson` | Global module registry (`id`, `ident`, `path`) |
| `module_edges.ndjson` | Module dependency graph (`from`, `to`, `kind`: sync/async) |
| `sources.ndjson` | Per-route source tree with sizes and environment flags |
| `chunk_parts.ndjson` | Granular size data: one line per (source, output_file) pair |
| `output_files.ndjson` | Per-route output files with aggregated sizes |
| `routes.ndjson` | Route-level summaries |

## Browsing the output

### Route overview

```bash
jq -s 'sort_by(-.total_compressed_size)' .next/diagnostics/analyze/ndjson/routes.ndjson
```

### Find large sources

```bash
jq -s '
  group_by(.full_path)
  | map(max_by(.compressed_size))
  | sort_by(-.compressed_size)
  | .[0:10]
  | .[] | {full_path, compressed_size, size, route}
' .next/diagnostics/analyze/ndjson/sources.ndjson
```

### Client-side JS

```bash
grep '"client":true' .next/diagnostics/analyze/ndjson/sources.ndjson \
  | grep '"js":true' \
  | jq -s 'sort_by(-.compressed_size) | .[0:10] | .[] | {full_path, compressed_size}'
```

### Module dependencies

```bash
grep '"from":42,' .next/diagnostics/analyze/ndjson/module_edges.ndjson | jq .to
grep '"to":42,' .next/diagnostics/analyze/ndjson/module_edges.ndjson | jq .from
grep 'react-dom' .next/diagnostics/analyze/ndjson/modules.ndjson | jq '{id, path}'
```

### Output files for a route

```bash
grep '"route":"/"' .next/diagnostics/analyze/ndjson/output_files.ndjson \
  | jq -s 'sort_by(-.total_compressed_size) | .[0:10] | .[] | {filename, total_compressed_size, num_parts}'
```

### Directory tree for a route

```bash
grep '"route":"/"' .next/diagnostics/analyze/ndjson/sources.ndjson \
  | jq 'select(.parent_id == null)'
```
