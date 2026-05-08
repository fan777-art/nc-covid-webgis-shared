# NC COVID-19 ZIP Web GIS Outputs

This workspace contains a Web GIS dashboard built from the NC COVID ZIP dataset.

## What was done

1. Pulled and inspected NC ZIP-level COVID data from `time_series_data/reduced_geojson`.
2. Built a ZIP-level web map client with Leaflet (`index.html`, `assets/app.js`, `assets/styles.css`).
3. Added daily summary time-series support using `data/daily_summary.json`.
4. Created cleaned exports in GeoJSON/CSV format.

## Generated outputs

- `data/date_manifest.json`: date-to-source index for all available days.
- `data/daily_summary.json`: totals for cases/deaths by date.
- `data/daily_summary.csv`: CSV export of daily totals.
- `data/exports/nc_zip_2020-10-02.geojson`: cleaned ZIP layer snapshot.
- `data/exports/nc_zip_2020-10-02.csv`: cleaned ZIP snapshot in CSV.
- `data/exports/nc_counties.geojson`: NC county boundaries overlay layer.
- `data/exports/nc_zip_2020-10-02_moran.geojson`: Local Moran's I result layer.

## Features in the web client

- Daily ZIP choropleth map for cases/deaths.
- Color scheme switcher for choropleth symbology.
- Date slider for time navigation.
- County boundaries overlay toggle.
- Local Moran's I layer toggle (Oct 2, 2020 snapshot).
- Summary time-series chart for cases/deaths.
- ZIP-level hover/click details panel.

## Rebuild data artifacts

Run:

```bash
python scripts/build_data.py
```

## Run locally

From repo root:

```bash
python -m http.server 8000
```

Then open:

`http://localhost:8000/`
