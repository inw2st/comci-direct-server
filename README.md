# Direct Comcigan Relay

This server wraps `comcigan-parser`, which parses the official Comcigan timetable HTML table directly.

## Why this is different from `pycomcigan`

`pycomcigan` returned incomplete subject data for some schools. `comcigan-parser` extracts timetable cells from the rendered table and separates:

- subject
- teacher

The parsing logic is based on the official table structure rather than an alternate reimplementation.

## Endpoints

### `GET /health`

Health check.

### `GET /meta`

Current and next week windows in Asia/Seoul.

### `GET /schools/search?q=화홍고`

Search school candidates.

### `GET /timetable/verify`

Example:

```text
/timetable/verify?school_name=화홍고등학교&region_name=경기&grade=3&class_num=2&target_date=2026-03-05
```

If the school search result already includes `school_code` and `school_type`, you can pass them directly to avoid a second search.

## Local run

```bash
cd comci-direct-server
npm install
npm start
```

## Railway

Deploy this directory as the service root.
