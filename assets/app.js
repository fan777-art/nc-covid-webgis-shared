const palettes = {
  reds: ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#de2d26", "#a50f15"],
  blues: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"],
  greens: ["#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#31a354", "#006d2c"],
  oranges: ["#fff5eb", "#fee6ce", "#fdd0a2", "#fdae6b", "#fd8d3c", "#e6550d", "#a63603"]
};

const moranColors = {
  "High-High": "#b91c1c",
  "Low-Low": "#1d4ed8",
  "High-Low": "#f97316",
  "Low-High": "#9333ea",
  "Not significant": "#d1d5db"
};

const state = {
  manifest: null,
  summary: null,
  map: null,
  chart: null,
  zipLayer: null,
  countyLayer: null,
  moranLayer: null,
  metric: "Cases",
  scheme: "reds",
  dateIndex: 0,
  isMoranMode: false,
  currentBreaks: [],
  currentColors: []
};

const refs = {
  metricSelect: document.getElementById("metricSelect"),
  schemeSelect: document.getElementById("schemeSelect"),
  dateSlider: document.getElementById("dateSlider"),
  dateLabel: document.getElementById("dateLabel"),
  countiesToggle: document.getElementById("countiesToggle"),
  moranToggle: document.getElementById("moranToggle"),
  totalCases: document.getElementById("totalCases"),
  totalDeaths: document.getElementById("totalDeaths"),
  legend: document.getElementById("legend"),
  zipDetails: document.getElementById("zipDetails")
};

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatInt(value) {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return Number(value).toLocaleString("en-US");
}

function formatDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getQuantileBreaks(values, classes) {
  if (!values.length) {
    return [];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const breaks = [];
  for (let i = 1; i < classes; i += 1) {
    const idx = Math.floor((i / classes) * (sorted.length - 1));
    breaks.push(sorted[idx]);
  }
  const deduped = [];
  for (const b of breaks) {
    if (deduped.length === 0 || b > deduped[deduped.length - 1]) {
      deduped.push(b);
    }
  }
  return deduped;
}

function getClassColor(value, breaks, colors) {
  if (value === null) {
    return "#e5e7eb";
  }
  for (let i = 0; i < breaks.length; i += 1) {
    if (value <= breaks[i]) {
      return colors[i];
    }
  }
  return colors[breaks.length];
}

function featureMetricValue(props) {
  return state.metric === "Cases"
    ? toNumber(props.Cases ?? props.cases)
    : toNumber(props.Deaths ?? props.deaths);
}

function getZipProperties(props) {
  return {
    zip: props.ZIPCode ?? props.zip ?? "N/A",
    place: props.Place ?? props.place ?? "N/A",
    cases: toNumber(props.Cases ?? props.cases),
    deaths: toNumber(props.Deaths ?? props.deaths),
    totalPop: toNumber(props.TotalPop ?? props.total_pop),
    moranCluster: props.moran_cluster ?? "-"
  };
}

function updateDetails(props) {
  const d = getZipProperties(props);
  const rows = Array.from(refs.zipDetails.querySelectorAll("dd"));
  rows[0].textContent = d.zip;
  rows[1].textContent = d.place;
  rows[2].textContent = formatInt(d.cases);
  rows[3].textContent = formatInt(d.deaths);
  rows[4].textContent = formatInt(d.totalPop);
  rows[5].textContent = d.moranCluster;
}

function resetDetails() {
  updateDetails({});
}

function updateLegendForChoropleth() {
  const metricLabel = state.metric;
  const lines = [`<strong>${metricLabel}</strong>`];

  let low = 0;
  for (let i = 0; i < state.currentColors.length; i += 1) {
    const color = state.currentColors[i];
    const high = state.currentBreaks[i];
    if (high !== undefined) {
      lines.push(
        `<div class="legend-item"><span class="swatch" style="background:${color}"></span><span>${formatInt(low)} - ${formatInt(high)}</span></div>`
      );
      low = high + 1;
    } else {
      lines.push(
        `<div class="legend-item"><span class="swatch" style="background:${color}"></span><span>${formatInt(low)}+</span></div>`
      );
    }
  }
  lines.push('<div class="legend-item"><span class="swatch" style="background:#e5e7eb"></span><span>No data</span></div>');
  refs.legend.innerHTML = lines.join("");
}

function updateLegendForMoran() {
  const order = ["High-High", "Low-Low", "High-Low", "Low-High", "Not significant"];
  const lines = ["<strong>Local Moran's I</strong>"];
  for (const label of order) {
    lines.push(
      `<div class="legend-item"><span class="swatch" style="background:${moranColors[label]}"></span><span>${label}</span></div>`
    );
  }
  refs.legend.innerHTML = lines.join("");
}

function styleZipFeature(feature) {
  const value = featureMetricValue(feature.properties || {});
  return {
    color: "#3b4b5a",
    weight: 0.4,
    fillOpacity: 0.78,
    fillColor: getClassColor(value, state.currentBreaks, state.currentColors)
  };
}

function styleMoranFeature(feature) {
  const cluster = feature.properties?.moran_cluster || "Not significant";
  return {
    color: "#374151",
    weight: 0.5,
    fillOpacity: 0.78,
    fillColor: moranColors[cluster] || moranColors["Not significant"]
  };
}

function bindInteractions(layer) {
  layer.on({
    mouseover: (e) => {
      e.target.setStyle({ weight: 1.6, color: "#111827" });
      updateDetails(e.target.feature.properties || {});
    },
    mouseout: (e) => {
      if (state.isMoranMode && state.moranLayer) {
        state.moranLayer.resetStyle(e.target);
      } else if (state.zipLayer) {
        state.zipLayer.resetStyle(e.target);
      }
      resetDetails();
    },
    click: (e) => {
      updateDetails(e.target.feature.properties || {});
    }
  });
}

function updateTotals() {
  const selected = state.manifest.dates[state.dateIndex];
  refs.totalCases.textContent = formatInt(selected.total_cases);
  refs.totalDeaths.textContent = formatInt(selected.total_deaths);
}

function loadZipLayer(geojson) {
  if (state.zipLayer) {
    state.map.removeLayer(state.zipLayer);
  }

  const values = geojson.features
    .map((f) => featureMetricValue(f.properties || {}))
    .filter((n) => n !== null);

  state.currentBreaks = getQuantileBreaks(values, 6);
  state.currentColors = palettes[state.scheme].slice(0, state.currentBreaks.length + 1);

  state.zipLayer = L.geoJSON(geojson, {
    style: styleZipFeature,
    onEachFeature: (_feature, layer) => bindInteractions(layer)
  });

  if (!state.isMoranMode) {
    state.zipLayer.addTo(state.map);
    updateLegendForChoropleth();
  }
}

async function ensureCountyLayer() {
  if (state.countyLayer) {
    return;
  }
  const resp = await fetch("data/exports/nc_counties.geojson");
  const counties = await resp.json();
  state.countyLayer = L.geoJSON(counties, {
    style: {
      color: "#111827",
      weight: 1.1,
      fillOpacity: 0
    }
  });
}

async function ensureMoranLayer() {
  if (state.moranLayer) {
    return;
  }
  const resp = await fetch("data/exports/nc_zip_2020-10-02_moran.geojson");
  const moran = await resp.json();
  state.moranLayer = L.geoJSON(moran, {
    style: styleMoranFeature,
    onEachFeature: (_feature, layer) => bindInteractions(layer)
  });
}

async function renderDate(index) {
  const entry = state.manifest.dates[index];
  refs.dateLabel.textContent = formatDate(entry.date);
  const resp = await fetch(entry.source);
  const geojson = await resp.json();
  loadZipLayer(geojson);
  updateTotals();

  if (state.isMoranMode) {
    if (state.zipLayer && state.map.hasLayer(state.zipLayer)) {
      state.map.removeLayer(state.zipLayer);
    }
    if (state.moranLayer && !state.map.hasLayer(state.moranLayer)) {
      state.moranLayer.addTo(state.map);
    }
    updateLegendForMoran();
  }
}

function buildChart() {
  const labels = state.summary.map((d) => d.date);
  const cases = state.summary.map((d) => d.total_cases);
  const deaths = state.summary.map((d) => d.total_deaths);

  state.chart = new Chart(document.getElementById("summaryChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Total cases",
          data: cases,
          borderColor: "#0f766e",
          backgroundColor: "#0f766e22",
          borderWidth: 2,
          fill: false,
          tension: 0.2,
          pointRadius: 0
        },
        {
          label: "Total deaths",
          data: deaths,
          borderColor: "#b91c1c",
          backgroundColor: "#b91c1c22",
          borderWidth: 2,
          fill: false,
          tension: 0.2,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top"
        },
        tooltip: {
          callbacks: {
            title: (items) => formatDate(items[0].label)
          }
        }
      },
      scales: {
        x: {
          ticks: {
            callback: (val, idx) => {
              if (idx % 20 !== 0 && idx !== labels.length - 1) {
                return "";
              }
              return labels[idx].slice(5);
            },
            maxRotation: 0,
            autoSkip: false
          }
        },
        y: {
          ticks: {
            callback: (v) => Number(v).toLocaleString("en-US")
          }
        }
      }
    }
  });
}

async function init() {
  const [manifestResp, summaryResp] = await Promise.all([
    fetch("data/date_manifest.json"),
    fetch("data/daily_summary.json")
  ]);
  state.manifest = await manifestResp.json();
  state.summary = await summaryResp.json();

  state.map = L.map("map", { zoomControl: true }).setView([35.5, -79.2], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.map);

  refs.dateSlider.max = String(state.manifest.dates.length - 1);
  refs.dateSlider.value = String(state.manifest.dates.length - 1);
  state.dateIndex = state.manifest.dates.length - 1;

  buildChart();
  await renderDate(state.dateIndex);

  refs.metricSelect.addEventListener("change", async (e) => {
    state.metric = e.target.value;
    await renderDate(state.dateIndex);
  });

  refs.schemeSelect.addEventListener("change", async (e) => {
    state.scheme = e.target.value;
    await renderDate(state.dateIndex);
  });

  refs.dateSlider.addEventListener("input", async (e) => {
    state.dateIndex = Number(e.target.value);
    await renderDate(state.dateIndex);
  });

  refs.countiesToggle.addEventListener("change", async (e) => {
    await ensureCountyLayer();
    if (e.target.checked) {
      state.countyLayer.addTo(state.map);
    } else if (state.countyLayer) {
      state.map.removeLayer(state.countyLayer);
    }
  });

  refs.moranToggle.addEventListener("change", async (e) => {
    state.isMoranMode = e.target.checked;
    await ensureMoranLayer();

    if (state.isMoranMode) {
      if (state.zipLayer) {
        state.map.removeLayer(state.zipLayer);
      }
      state.moranLayer.addTo(state.map);
      updateLegendForMoran();
    } else {
      if (state.moranLayer) {
        state.map.removeLayer(state.moranLayer);
      }
      if (state.zipLayer) {
        state.zipLayer.addTo(state.map);
      }
      updateLegendForChoropleth();
    }
  });
}

init().catch((err) => {
  console.error(err);
  refs.legend.innerHTML = "<strong>Failed to load data.</strong>";
});
