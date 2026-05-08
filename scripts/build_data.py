#!/usr/bin/env python3
import csv
import json
import math
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
from esda import Moran_Local
from libpysal.weights import Queen
from shapely.geometry import shape


ROOT = Path(__file__).resolve().parents[1]
REDUCED_DIR = ROOT / "time_series_data" / "reduced_geojson"
OUTPUT_DIR = ROOT / "data"
EXPORT_DIR = OUTPUT_DIR / "exports"

COUNTY_URL = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"


@dataclass
class DailySummary:
    date_iso: str
    source_file: str
    total_cases: int
    total_deaths: int
    missing_cases_zip_count: int
    missing_deaths_zip_count: int


def parse_date_from_name(name: str) -> date:
    # Expected input like nc_zip1002.json
    suffix = name.removeprefix("nc_zip").removesuffix(".json")
    month = int(suffix[:2])
    day = int(suffix[2:])
    return date(2020, month, day)


def as_int(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if math.isnan(value):
            return None
        return int(value)
    text = str(value).strip()
    if text == "":
        return None
    try:
        return int(float(text.replace(",", "")))
    except ValueError:
        return None


def read_geojson(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=True)


def build_summaries(files):
    summaries = []
    for source in files:
        data = read_geojson(source)
        total_cases = 0
        total_deaths = 0
        missing_cases = 0
        missing_deaths = 0

        for feature in data.get("features", []):
            props = feature.get("properties", {})
            cases = as_int(props.get("Cases"))
            deaths = as_int(props.get("Deaths"))

            if cases is None:
                missing_cases += 1
            else:
                total_cases += cases

            if deaths is None:
                missing_deaths += 1
            else:
                total_deaths += deaths

        dt = parse_date_from_name(source.name)
        summaries.append(
            DailySummary(
                date_iso=dt.isoformat(),
                source_file=f"time_series_data/reduced_geojson/{source.name}",
                total_cases=total_cases,
                total_deaths=total_deaths,
                missing_cases_zip_count=missing_cases,
                missing_deaths_zip_count=missing_deaths,
            )
        )

    summaries.sort(key=lambda x: x.date_iso)
    return summaries


def build_manifest(summaries):
    return {
        "name": "NC COVID-19 ZIP dataset (2020)",
        "date_range": {
            "start": summaries[0].date_iso,
            "end": summaries[-1].date_iso,
        },
        "dates": [
            {
                "date": s.date_iso,
                "source": s.source_file,
                "total_cases": s.total_cases,
                "total_deaths": s.total_deaths,
                "missing_cases_zip_count": s.missing_cases_zip_count,
                "missing_deaths_zip_count": s.missing_deaths_zip_count,
            }
            for s in summaries
        ],
    }


def write_summary_csv(path: Path, summaries):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "date",
                "source",
                "total_cases",
                "total_deaths",
                "missing_cases_zip_count",
                "missing_deaths_zip_count",
            ]
        )
        for s in summaries:
            writer.writerow(
                [
                    s.date_iso,
                    s.source_file,
                    s.total_cases,
                    s.total_deaths,
                    s.missing_cases_zip_count,
                    s.missing_deaths_zip_count,
                ]
            )


def build_clean_export(source_path: Path):
    raw = read_geojson(source_path)
    cleaned = {
        "type": "FeatureCollection",
        "name": "nc_zip_2020_10_02",
        "features": [],
    }

    for feature in raw.get("features", []):
        props = feature.get("properties", {})
        cleaned_props = {
            "zip": str(props.get("ZIPCode", "")).zfill(5),
            "place": props.get("Place"),
            "total_pop": as_int(props.get("TotalPop")),
            "cases": as_int(props.get("Cases")),
            "deaths": as_int(props.get("Deaths")),
            "note": props.get("Note"),
        }
        cleaned["features"].append(
            {
                "type": "Feature",
                "properties": cleaned_props,
                "geometry": feature.get("geometry"),
            }
        )

    return cleaned


def write_clean_csv(path: Path, cleaned_geojson):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["zip", "place", "total_pop", "cases", "deaths", "note"])
        for feature in cleaned_geojson.get("features", []):
            p = feature.get("properties", {})
            writer.writerow(
                [
                    p.get("zip"),
                    p.get("place"),
                    p.get("total_pop"),
                    p.get("cases"),
                    p.get("deaths"),
                    p.get("note"),
                ]
            )


def build_local_moran(cleaned_geojson):
    features = cleaned_geojson.get("features", [])
    geometries = []
    values = []
    index_map = []

    for idx, feature in enumerate(features):
        geometry = feature.get("geometry")
        if not geometry:
            continue
        geom_obj = shape(geometry)
        if geom_obj.is_empty:
            continue

        geometries.append(geom_obj)
        cases = feature.get("properties", {}).get("cases")
        values.append(0 if cases is None else cases)
        index_map.append(idx)

    x = np.array(values, dtype=float)
    weights = Queen.from_iterable(geometries)
    weights.transform = "r"

    # Fixed seed for reproducibility.
    moran = Moran_Local(x, weights, permutations=999, seed=42)

    def label(q, p):
        if p > 0.05:
            return "Not significant"
        if q == 1:
            return "High-High"
        if q == 2:
            return "Low-High"
        if q == 3:
            return "Low-Low"
        if q == 4:
            return "High-Low"
        return "Not significant"

    moran_i_values = [None] * len(features)
    moran_p_values = [None] * len(features)
    moran_q_values = [None] * len(features)
    moran_cluster_values = ["Not significant"] * len(features)

    for local_idx, feature_idx in enumerate(index_map):
        p_sim = float(moran.p_sim[local_idx])
        q = int(moran.q[local_idx])
        moran_i_values[feature_idx] = float(moran.Is[local_idx])
        moran_p_values[feature_idx] = p_sim
        moran_q_values[feature_idx] = q
        moran_cluster_values[feature_idx] = label(q, p_sim)

    out = {
        "type": "FeatureCollection",
        "name": "nc_zip_2020_10_02_local_moran",
        "features": [],
        "metadata": {
            "variable": "cases",
            "date": "2020-10-02",
            "permutations": 999,
            "significance_level": 0.05,
        },
    }

    for idx, feature in enumerate(features):
        p = dict(feature.get("properties", {}))
        p["moran_i"] = moran_i_values[idx]
        p["moran_p"] = moran_p_values[idx]
        p["moran_q"] = moran_q_values[idx]
        p["moran_cluster"] = moran_cluster_values[idx]

        out["features"].append(
            {
                "type": "Feature",
                "properties": p,
                "geometry": feature.get("geometry"),
            }
        )

    return out


def download_counties(out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(COUNTY_URL, timeout=60) as response:
        data = response.read().decode("utf-8")
    payload = json.loads(data)

    nc_features = []
    for feature in payload.get("features", []):
        fips = str(feature.get("id", ""))
        if not fips.startswith("37"):
            continue
        props = feature.get("properties", {})
        nc_features.append(
            {
                "type": "Feature",
                "properties": {
                    "fips": fips,
                    "name": props.get("NAME"),
                    "state": props.get("STATE"),
                },
                "geometry": feature.get("geometry"),
            }
        )

    write_json(
        out_path,
        {
            "type": "FeatureCollection",
            "name": "nc_counties",
            "features": nc_features,
        },
    )


def main():
    files = sorted(REDUCED_DIR.glob("nc_zip*.json"), key=lambda p: p.name)
    if not files:
        raise RuntimeError("No reduced GeoJSON files were found.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    summaries = build_summaries(files)
    write_json(OUTPUT_DIR / "date_manifest.json", build_manifest(summaries))
    write_json(
        OUTPUT_DIR / "daily_summary.json",
        [
            {
                "date": s.date_iso,
                "total_cases": s.total_cases,
                "total_deaths": s.total_deaths,
                "missing_cases_zip_count": s.missing_cases_zip_count,
                "missing_deaths_zip_count": s.missing_deaths_zip_count,
            }
            for s in summaries
        ],
    )
    write_summary_csv(OUTPUT_DIR / "daily_summary.csv", summaries)

    oct2 = REDUCED_DIR / "nc_zip1002.json"
    if not oct2.exists():
        oct2 = files[-1]

    cleaned = build_clean_export(oct2)
    write_json(EXPORT_DIR / "nc_zip_2020-10-02.geojson", cleaned)
    write_clean_csv(EXPORT_DIR / "nc_zip_2020-10-02.csv", cleaned)

    moran = build_local_moran(cleaned)
    write_json(EXPORT_DIR / "nc_zip_2020-10-02_moran.geojson", moran)

    download_counties(EXPORT_DIR / "nc_counties.geojson")
    print("Data build complete.")


if __name__ == "__main__":
    main()
