import * as duckdb from '@duckdb/duckdb-wasm';
import mvpModule from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehModule from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { buildQueries, dimensions } from './queries.js';
import './styles.css';

const form = document.querySelector('#filters');
const controls = document.querySelector('#controls');
const status = document.querySelector('#status');
const exportButton = document.querySelector('#export');
const rollupButton = document.querySelector('#rollup-tab');
const pivotButton = document.querySelector('#pivot-tab');
const cubeButton = document.querySelector('#cube-tab');

const usd = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });

const formatMwh = value => `${integer.format(value ?? 0)} MWh`;
const formatCo2 = value => `${decimal.format(value ?? 0)} t`;

const regularColumns = [
  ['segment', 'Segmento', String],
  ['energy_mwh', 'Energía (MWh)', formatMwh],
  ['revenue_usd', 'Valorización (USD)', usd.format],
  ['margin_usd', 'Margen Op. (USD)', usd.format],
  ['co2_tons', 'Emisiones CO₂', formatCo2],
  ['dispatch_blocks', 'Bloques', integer.format],
];

const pivotColumns = [
  ['segment', 'Zona eléctrica', String],
  ['hydro_mwh', 'Hidroeléctrica', formatMwh],
  ['renewable_mwh', 'Solar / Eólica', formatMwh],
  ['thermal_mwh', 'Gas Natural', formatMwh],
  ['energy_mwh', 'Total Zona', formatMwh],
];

const cubeColumns = [
  ['zone_segment', 'Zona eléctrica', String],
  ['source_segment', 'Tecnología', String],
  ['energy_mwh', 'Energía (MWh)', formatMwh],
  ['revenue_usd', 'Valorización (USD)', usd.format],
  ['co2_tons', 'Emisiones CO₂', formatCo2],
];

let connection;
let currentQueries;
let currentRows = [];
let operation = 'rollup';

function tableRows(result) {
  return result.toArray().map(row =>
    Object.fromEntries(result.schema.fields.map(field => [field.name, row[field.name]])),
  );
}

function renderTable(id, rows, columns) {
  const table = document.querySelector(id);
  const headRow = document.createElement('tr');
  for (const [, label] of columns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    headRow.append(cell);
  }
  table.tHead.replaceChildren(headRow);
  const body = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const [key, , format] of columns) {
      const td = document.createElement('td');
      td.textContent = format(row[key]);
      tr.append(td);
    }
    body.append(tr);
  }
  table.tBodies[0].replaceChildren(body);
}

function renderChart(rows) {
  const chart = document.querySelector('#chart');
  const maximum = Math.max(1, ...rows.map(row => Number(row.energy_mwh)));
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const bar = document.createElement('div');
    bar.className = 'chart-row';
    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent = row.segment;
    const track = document.createElement('div');
    track.className = 'chart-track';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('div');
    fill.className = 'chart-fill';
    fill.style.width = `${(Number(row.energy_mwh) * 100) / maximum}%`;
    track.append(fill);
    const value = document.createElement('span');
    value.className = 'chart-value';
    value.textContent = formatMwh(row.energy_mwh);
    bar.append(label, track, value);
    fragment.append(bar);
  }
  chart.replaceChildren(fragment);
}

function setBusy(busy) {
  controls.disabled = busy;
  exportButton.disabled = busy;
  rollupButton.disabled = busy;
  pivotButton.disabled = busy;
  cubeButton.disabled = busy;
  document.querySelector('main').setAttribute('aria-busy', String(busy));
}

function showError(error) {
  console.error(error);
  status.classList.add('error');
  status.textContent = `No se pudo completar el análisis OLAP. ${error.message}.`;
}

async function renderOperation() {
  const rows = tableRows(await connection.query(currentQueries[operation]));
  const cols =
    operation === 'pivot' ? pivotColumns : operation === 'cube' ? cubeColumns : regularColumns;
  renderTable('#operation', rows, cols);
  rollupButton.setAttribute('aria-pressed', String(operation === 'rollup'));
  pivotButton.setAttribute('aria-pressed', String(operation === 'pivot'));
  cubeButton.setAttribute('aria-pressed', String(operation === 'cube'));
  const titles = { rollup: 'Roll-up', pivot: 'Pivot', cube: 'Cube' };
  document.querySelector('#operation-sql-heading').textContent = titles[operation];
  document.querySelector('#operation-sql').textContent = currentQueries[operation];
}

async function refresh() {
  setBusy(true);
  status.classList.remove('error');
  status.textContent = 'Ejecutando consultas OLAP en DuckDB-Wasm…';
  try {
    const filters = Object.fromEntries(
      ['year', 'zone', 'source_type', 'dimension'].map(name => [
        name,
        form.elements.namedItem(name).value,
      ]),
    );
    currentQueries = buildQueries(filters);
    const start = performance.now();
    currentRows = tableRows(await connection.query(currentQueries.detail));
    const [totals] = tableRows(await connection.query(currentQueries.totals));

    document.querySelector('#energy-mwh').textContent = formatMwh(totals.energy_mwh ?? 0);
    document.querySelector('#revenue-usd').textContent = usd.format(totals.revenue_usd ?? 0);
    document.querySelector('#margin-usd').textContent = usd.format(totals.margin_usd ?? 0);
    document.querySelector('#co2-tons').textContent = formatCo2(totals.co2_tons ?? 0);

    const label = dimensions[filters.dimension].label;
    document.querySelector('#result-heading').textContent = `Energía despachada por ${label.toLowerCase()}`;
    document.querySelector('#result-caption').textContent = `${currentRows.length} segmentos · ${
      filters.year || '2024–2025'
    } · ${filters.zone || 'Todas las zonas'} · ${filters.source_type || 'Todas las tecnologías'}`;

    renderTable('#results', currentRows, [['segment', label, String], ...regularColumns.slice(1)]);
    renderChart(currentRows);
    document.querySelector('#detail-sql').textContent = currentQueries.detail;
    await renderOperation();
    status.textContent = `DuckDB-Wasm listo · ${integer.format(
      totals.dispatch_blocks,
    )} bloques analizados · Consultas en ${(performance.now() - start).toFixed(0)} ms`;
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('change', refresh);
document.querySelector('#reset-filters').addEventListener('click', () => {
  form.reset();
  refresh();
});

for (const [button, view] of [
  [rollupButton, 'rollup'],
  [pivotButton, 'pivot'],
  [cubeButton, 'cube'],
]) {
  button.addEventListener('click', async () => {
    setBusy(true);
    operation = view;
    try {
      await renderOperation();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  });
}

exportButton.addEventListener('click', () => {
  const columns = regularColumns.map(([key]) => key);
  const escape = value => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [columns, ...currentRows.map(row => columns.map(key => row[key]))]
    .map(row => row.map(escape).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'despacho-energia-olap.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function initialize() {
  try {
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: mvpModule, mainWorker: mvpWorker },
      eh: { mainModule: ehModule, mainWorker: ehWorker },
    });
    const worker = new Worker(bundle.mainWorker);
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
    await db.instantiate(bundle.mainModule);
    const tables = ['dim_date', 'dim_plant', 'dim_zone', 'fact_dispatch'];
    await Promise.all(
      tables.map(async table => {
        const response = await fetch(`${import.meta.env.BASE_URL}data/${table}.parquet`);
        if (!response.ok) throw new Error(`Error HTTP ${response.status} al cargar ${table}`);
        await db.registerFileBuffer(
          `${table}.parquet`,
          new Uint8Array(await response.arrayBuffer()),
        );
      }),
    );
    const schema = await fetch(`${import.meta.env.BASE_URL}schema.sql`);
    if (!schema.ok) throw new Error('No se pudo cargar el esquema estrella');
    connection = await db.connect();
    await connection.query(await schema.text());
    await refresh();
  } catch (error) {
    setBusy(true);
    showError(error);
  }
}

initialize();
