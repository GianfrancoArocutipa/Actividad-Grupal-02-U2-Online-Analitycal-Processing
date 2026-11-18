---
title: "Building a Zero-AWS Power Grid OLAP Explorer in the Browser with DuckDB-Wasm and Apache Parquet"
published: true
description: "A 54,000-row Star Schema of Peruvian electricity dispatch, vectorised ROLLUP, PIVOT, and CUBE queries running in WebAssembly, and automated CI/CD deployment to GitHub Pages."
tags: duckdb, sql, dataengineering, javascript
---

Analyzing a national power grid inevitably leads to multi-dimensional questions: *"How many megawatt-hours did solar and wind power plants inject into the Southern grid during 2025?"*, *"How does operating margin evolve across quarters?"*, or *"How many tons of $\text{CO}_2$ emissions are offset when hydro generation replaces natural gas?"*. To answer these questions at millisecond latency without provisioning expensive cloud clusters or relying on AWS services, we built **Energía Perú OLAP**, a browser-native analytical workbench powered by **DuckDB-Wasm** and **Apache Parquet**.

The project models **54,000 electricity dispatch blocks** across 2024 and 2025 inspired by Peru's National Interconnected Electrical System (**SEIN**), spanning twelve power plants, three generation technologies, and six departments.

[Launch Live OLAP Application](https://gianfrancoarocutipa.github.io/Actividad-Grupal-02-U2-Online-Analitycal-Processing/) · [Explore Public GitHub Repository](https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing) · [View CI/CD Deployment Workflow](https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing/actions/workflows/pages.yml)

---

## 1. Designing the Star Schema and Grain

Every row in our central fact table (`fact_dispatch`) represents a single power injection block from a generation plant into a grid zone on a given date. It stores four additive measures: dispatched energy (`energy_mwh`), spot market valuation (`revenue_usd`), operating cost (`op_cost_usd`), and carbon emissions (`co2_tons`).

Surrounding the fact table, we defined three denormalized dimension tables to support hierarchical navigation:

- **`dim_date`** (731 days): calendar date, `year`, `quarter`, and `month_label` (`2024-01` through `2025-12`).
- **`dim_plant`** (12 power plants): generation technology (`Hidroeléctrica`, `Solar / Eólica`, `Gas Natural`) and facility name (`C.H. Mantaro`, `C.H. Cerro del Águila`, `C.S. Rubí`, `C.E. Wayra`, `C.T. Kallpa`, among others).
- **`dim_zone`** (6 departments): SEIN grid region (`Norte`, `Centro`, `Sur`) and department (`Piura`, `La Libertad`, `Lima`, `Junín`, `Arequipa`, `Moquegua`).

```text
                    dim_date
                       │
dim_plant ───── fact_dispatch ───── dim_zone
```

Across the 54,000 dispatch blocks, the Star Schema consolidates **11,470,432 MWh** of generated electricity, **USD 578.07 million** in spot market valuation, and **1,550,133.85 tons of $\text{CO}_2$**.

---

## 2. From Native DuckDB in Python to DuckDB-Wasm in the Browser

Our architecture pairs two execution environments of the DuckDB columnar engine:

1. **Deterministic Generation & Parquet Compression in CI ([`scripts/build_data.py`](https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing/blob/main/scripts/build_data.py))**: Python uses a fixed seed (`SEED = 202602`) to populate the Star Schema inside DuckDB, validates primary/foreign key integrity, and exports each table into `ZSTD`-compressed `.parquet` files.
2. **In-Browser Vectorized Execution ([`src/main.js`](https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing/blob/main/src/main.js))**: When a visitor loads the static app on GitHub Pages, the browser boots `@duckdb/duckdb-wasm` inside a **Web Worker**, registers the four Parquet files in DuckDB's virtual file system, and runs [`public/schema.sql`](https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing/blob/main/public/schema.sql) to expose the joined `dispatch` analytical view.

```text
Python + DuckDB ──► Apache Parquet (ZSTD)
                            │
                            ▼
GitHub Pages ──► DuckDB-Wasm (Web Worker) ──► Millisecond OLAP Queries
```

Because the WebAssembly binaries (`.wasm`) and worker scripts are bundled directly by Vite during the build, the application runs with zero backend servers and zero external CDN failure points.

---

## 3. Slice, Dice, and Drill-Down on the Energy Matrix

Selecting the year `2025` applies a single-dimension filter across the cube (**Slice**). Combining `2025` with the `Sur` grid zone and `Solar / Eólica` technology isolates a multi-dimensional sub-cube (**Dice**).

Switching the **Group by (Drill-down)** selector allows users to navigate from annual totals down to quarter, month, grid zone, department, technology, or individual power plant while keeping all active filters applied:

```sql
select
    cast(month_label as varchar) as segment,
    cast(sum(energy_mwh) as double) as energy_mwh,
    cast(sum(revenue_usd) as double) as revenue_usd,
    cast(sum(margin_usd) as double) as margin_usd,
    cast(sum(co2_tons) as double) as co2_tons,
    count(*) as dispatch_blocks
from dispatch
where year = 2025
  and zone = 'Sur'
  and source_type = 'Solar / Eólica'
group by month_label
order by month_label;
```

An expandable SQL inspector panel in the UI displays the exact SQL statements executed by DuckDB-Wasm on every interaction.

---

## 4. Multi-Dimensional Operations: `ROLLUP`, `PIVOT`, and `CUBE`

Beyond single-dimension breakdowns, the workbench provides three dedicated tabs for advanced OLAP aggregations that react dynamically to the active Slice & Dice filters:

### Hierarchical Time Aggregation with `GROUP BY ROLLUP`

Computes quarterly totals, annual subtotals, and the overall SEIN grand total in a single pass, using `GROUPING()` to label each aggregation level:

```sql
select
    case
        when grouping(year) = 1 then 'TOTAL SEIN'
        when grouping(quarter) = 1 then cast(year as varchar) || ' · Subtotal anual'
        else year || '-T' || quarter
    end as segment,
    cast(sum(energy_mwh) as double) as energy_mwh,
    cast(sum(revenue_usd) as double) as revenue_usd
from dispatch
group by rollup(year, quarter)
order by grouping(year), year, grouping(quarter), quarter;
```

### Cross-Tabulation with `FILTER` (Pivot) and `GROUP BY CUBE`

The **Pivot** tab pivots generation technologies into columns (`Hidroeléctrica`, `Solar / Eólica`, and `Gas Natural`) using conditional aggregation (`SUM(energy_mwh) FILTER (WHERE ...)`) to compare MWh contribution across grid zones. Meanwhile, the **Cube** tab executes `GROUP BY CUBE(zone, source_type)` to compute every two-dimensional combination and marginal subtotal between geography and energy source.

---

## 5. Automated Validation and CI/CD Deployment to GitHub Pages

Before deploying any changes, our pipeline validates both the SQL query builder and the accounting reconciliation of the Star Schema:

1. **Query Builder Unit Tests (`npm run test:queries`)**: Verifies all 7 dimensions, `WHERE` clause construction, strict allow-list validation against SQL injection, and `ROLLUP`, `PIVOT`, and `CUBE` query generation via [`scripts/test-queries.mjs`](https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing/blob/main/scripts/test-queries.mjs).
2. **Star Schema Reconciliation (`python scripts/build_data.py`)**: Asserts that joining `fact_dispatch` with the three dimension tables preserves all 54,000 rows without negative measures, executes every query case from [`scripts/query-cases.mjs`](https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing/blob/main/scripts/query-cases.mjs), and verifies that every dimensional breakdown and `ROLLUP` grand total reconciles with the exact **11,470,432.00 MWh** fact sum.
3. **GitHub Actions CI/CD ([`.github/workflows/pages.yml`](https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing/blob/main/.github/workflows/pages.yml))**: On every push to `main`, GitHub Actions provisions Python 3.11 and Node.js 22, runs the test suite, builds the Parquet files, bundles the production assets with Vite, and deploys `dist/` to **GitHub Pages** via `actions/deploy-pages@v4`.

---

## 6. Reproduce the Project Locally

Clone the repository and run the data generator and local development server using Python 3.11+ and Node.js 22+:

```bash
git clone https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing.git
cd Actividad-Grupal-02-U2-Online-Analitycal-Processing
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run test:queries
.venv/bin/python scripts/build_data.py
npm run dev
```

PowerShell commands for Windows are also included in the `README.md`. Open the local URL printed by Vite to slice and dice the 54,000 power dispatch blocks, switch between `Roll-up`, `Pivot`, and `Cube`, and export any view to CSV.
