// Global state
let fullDataset = [];
let filteredDataset = [];
let isDark = false;
let heatmapInstance;

// Color palette manager
const palette = {
  text: () => isDark ? '#fff' : '#666',
  grid: () => isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
  bar: () => isDark ? 'rgba(100,180,255,0.7)' : 'rgba(54,162,235,0.7)',
  bev: () => isDark ? '#5CD6D6' : '#4BC0C0',
  phev: () => isDark ? '#FF7F94' : '#FF6384',
  line: () => isDark ? 'rgb(255,120,140)' : 'rgb(255,99,132)'
};

// Initialize app
window.addEventListener('DOMContentLoaded', () => {
  configureThemeToggle();

  if (!window.evData) {
    console.error("No dataset detected.");
    return;
  }

  fullDataset = preprocessData(window.evData);
  renderFilters(fullDataset);
  bindFilterEvents();
  handleFiltering();
  initHeatmap();
});

// Theme Toggle
function configureThemeToggle() {
  document.body.classList.toggle('dark-mode', isDark);

  const toggle = document.getElementById('dark-mode-toggle');
  toggle.innerText = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
  toggle.addEventListener('click', () => {
    isDark = !isDark;
    document.body.classList.toggle('dark-mode', isDark);
    toggle.innerText = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
    refreshCharts();
    if (heatmapInstance) {
      heatmapInstance.setStyle(isDark 
        ? 'mapbox://styles/mapbox/dark-v10' 
        : 'mapbox://styles/mapbox/light-v10');
    }
    initHeatmap();
  });
}

// Clean raw dataset
function preprocessData(data) {
  return data.filter(item =>
    item.Make &&
    item['Model Year'] &&
    !isNaN(Number(item['Model Year']))
  ).map(entry => ({
    ...entry,
    'Model Year': +entry['Model Year'],
    'Electric Range': +entry['Electric Range'] || 0,
    'City': entry.City || 'Unknown'
  }));
}

// Event bindings
function bindFilterEvents() {
  document.getElementById('city-filter').addEventListener('change', handleFiltering);
  document.getElementById('vehicle-type-filter').addEventListener('change', handleFiltering);
  document.getElementById('year-filter').addEventListener('input', e => {
    document.getElementById('year-range-value').textContent = e.target.value;
    handleFiltering();
  });
}

// Filter UI setup
function renderFilters(data) {
  const citySet = [...new Set(data.map(d => d.City))].sort();
  const cityFilter = document.getElementById('city-filter');
  cityFilter.innerHTML = `<option value="">All Cities</option>` + 
    citySet.map(city => `<option value="${city}">${city}</option>`).join('');

  const years = data.map(d => d['Model Year']);
  const yearInput = document.getElementById('year-filter');
  yearInput.min = Math.min(...years);
  yearInput.max = Math.max(...years);
  yearInput.value = yearInput.min;
  document.getElementById('year-range-value').textContent = yearInput.min;
}

// Apply filters
function handleFiltering() {
  const city = document.getElementById('city-filter').value;
  const vehicleType = document.getElementById('vehicle-type-filter').value;
  const minYear = +document.getElementById('year-filter').value;

  filteredDataset = fullDataset.filter(item => {
    if (city && item.City !== city) return false;
    if (vehicleType) {
      const isBEV = item['Electric Vehicle Type'].includes('Battery');
      if ((vehicleType === 'BEV' && !isBEV) || (vehicleType === 'PHEV' && isBEV)) return false;
    }
    return item['Model Year'] >= minYear;
  });

  updateAll(filteredDataset);
}

// Master update
function updateAll(data) {
  updateStats(data);
  buildYearGraph(data);
  buildTypePie(data);
  buildRangeLine(data);
  topManufacturers(data);
  populateSampleTable(data);
  refreshHeatmap(data);
}

// KPI Cards
function updateStats(data) {
  document.getElementById('total-evs').textContent = data.length.toLocaleString();
  document.getElementById('unique-brands').textContent = new Set(data.map(v => v.Make)).size;

  const cityCount = data.reduce((map, curr) => {
    map[curr.City] = (map[curr.City] || 0) + 1;
    return map;
  }, {});
  const [topCity = 'N/A', count = 0] = Object.entries(cityCount).sort((a, b) => b[1] - a[1])[0] || [];
  document.getElementById('top-City').textContent = `${topCity} (${count.toLocaleString()})`;
}

// Charts
function buildYearGraph(data) {
  const yearly = {};
  data.forEach(row => yearly[row['Model Year']] = (yearly[row['Model Year']] || 0) + 1);

  const ctx = document.getElementById('yearChart');
  if (ctx.chart) ctx.chart.destroy();

  ctx.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(yearly).sort(),
      datasets: [{
        label: 'EV Registrations',
        data: Object.values(yearly),
        backgroundColor: palette.bar(),
        borderColor: palette.bar(),
        borderWidth: 1
      }]
    },
    options: baseChartOptions()
  });
}

function buildTypePie(data) {
  const split = { BEV: 0, PHEV: 0 };
  data.forEach(row => {
    row['Electric Vehicle Type'].includes('Battery') ? split.BEV++ : split.PHEV++;
  });

  const ctx = document.getElementById('typeChart');
  if (ctx.chart) ctx.chart.destroy();

  ctx.chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(split),
      datasets: [{
        data: Object.values(split),
        backgroundColor: [palette.bev(), palette.phev()],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      animation: {
        duration: 2000, 
        easing: 'easeOutQuart' 
      },
      scales: {},
      plugins: {
        legend: { labels: { color: palette.text() } },
        tooltip: {
          callbacks: {
            label: context => {
              const total = context.dataset.data.reduce((a, b) => a + b);
              const pct = ((context.raw / total) * 100).toFixed(1);
              return `${context.label}: ${context.raw} (${pct}%)`;
            }
          }
        }
      }
      
    }
  });
}

function buildRangeLine(data) {
  const avg = {};
  data.forEach(d => {
    const y = d['Model Year'];
    if (!avg[y]) avg[y] = { sum: 0, count: 0 };
    avg[y].sum += d['Electric Range'];
    avg[y].count++;
  });

  const labels = Object.keys(avg).sort();
  const values = labels.map(y => (avg[y].sum / avg[y].count).toFixed(0));

  const ctx = document.getElementById('rangeChart');
  if (ctx.chart) ctx.chart.destroy();

  ctx.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Avg Range (miles)',
        data: values,
        fill: true,
        tension: 0.3,
        borderColor: palette.line(),
        backgroundColor: isDark ? 'rgba(255,120,140,0.2)' : 'rgba(255,99,132,0.2)'
      }]
    },
    options: baseChartOptions(true)
  });
}


function baseChartOptions(includeScales = true) {
  const options = {
    plugins: {
      legend: {
        labels: {
          color: isDark ? 'white' : 'black'
        }
      }
    }
  };

  if (includeScales) {
    options.scales = {
      x: { grid: { color: palette.grid() }, ticks: { color: palette.text() } },
      y: { beginAtZero: true, grid: { color: palette.grid() }, ticks: { color: palette.text() } },
    };
  }

  return options;
}

function refreshCharts() {
  ['yearChart', 'typeChart', 'rangeChart'].forEach(id => {
    const chart = document.getElementById(id)?.chart;
    if (!chart) return;

    // Set chart options based on chart type
    chart.options = baseChartOptions(
      chart.config.type === 'line' || chart.config.type === 'bar'
    );

    chart.update();
  });
}

// Tables
function topManufacturers(data) {
  const count = {};
  data.forEach(d => count[d.Make] = (count[d.Make] || 0) + 1);

  const top = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const body = document.querySelector('#manufacturer-table tbody');
  body.innerHTML = top.map(([make, num], i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${make}</td>
      <td>${num.toLocaleString()}</td>
      <td>${((num / data.length) * 100).toFixed(1)}%</td>
    </tr>
  `).join('');
}

function populateSampleTable(data) {
  const tbody = document.querySelector('#sample-data-table tbody');
  tbody.innerHTML = data.slice(0, 50).map(d => `
    <tr>
      <td>${d.Make}</td>
      <td>${d['Model Year']}</td>
      <td>${d.City}</td>
      <td>${d['Electric Range']}</td>
      <td>${d['Electric Vehicle Type'].includes('Battery') ? 'BEV' : 'PHEV'}</td>
    </tr>
  `).join('');
}

// Heatmap using Mapbox
function initHeatmap() {
  heatmapInstance = new mapboxgl.Map({
    container: 'heatmap',
    style: isDark ? 'mapbox://styles/mapbox/dark-v10' : 'mapbox://styles/mapbox/light-v10',
    center: [-120.5, 47.5],
    zoom: 0
  });

  heatmapInstance.on('load', () => {
    heatmapInstance.addSource('ev-data', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    heatmapInstance.addLayer({
      id: 'ev-heat-layer',
      type: 'heatmap',
      source: 'ev-data',
      paint: {
        'heatmap-weight': 1,
        'heatmap-radius': 15,
        'heatmap-opacity': 0.8,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,255,0)', 0.2, 'royalblue', 0.4, 'cyan',
          0.6, 'lime', 0.8, 'yellow', 1, 'red'
        ]
      }
    });

    refreshHeatmap(filteredDataset);
  });
}

function refreshHeatmap(data) {
  if (!heatmapInstance?.getSource('ev-data')) return;

  const features = data.map(entry => {
    const coords = entry['Vehicle Location']?.match(/-?\d+\.\d+/g);
    if (!coords || coords.length < 2) return null;
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [parseFloat(coords[0]), parseFloat(coords[1])]
      },
      properties: {}
    };
  }).filter(Boolean);

  heatmapInstance.getSource('ev-data').setData({
    type: 'FeatureCollection',
    features
  });

  const city = document.getElementById('city-filter').value;
  const center = features.length > 0 ? features[0].geometry.coordinates : [-120.5, 47.5];
  heatmapInstance.flyTo({ center, zoom: city ? 11 : 5 });
}
