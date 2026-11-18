# Energía Perú · Explorador OLAP con DuckDB-Wasm y Apache Parquet

Solución de Procesamiento Analítico en Línea (**OLAP**) 100% libre de AWS que ejecuta consultas multidimensionales (`Slice`, `Dice`, `Drill-down`, `GROUP BY ROLLUP`, `FILTER` Pivot y `GROUP BY CUBE`) directamente en el navegador mediante **DuckDB-Wasm** sobre un esquema estrella de **54.000 bloques de despacho eléctrico** del Sistema Eléctrico Interconectado Nacional (**SEIN Perú**, 2024–2025).

- **Aplicación desplegada (GitHub Pages):** `https://gianfrancoarocutipa.github.io/Actividad-Grupal-02-U2-Online-Analitycal-Processing/`

---

## Modelo Estrella en Apache Parquet

```text
                    dim_date (731 días · 2024-2025)
                       │
dim_plant (12) ─── fact_dispatch (54.000 filas) ─── dim_zone (6 dptos / 3 zonas)
```

| Tabla Parquet | Filas | Descripción |
| :--- | :---: | :--- |
| `fact_dispatch.parquet` | 54.000 | Bloques de despacho con `energy_mwh`, `revenue_usd`, `op_cost_usd` y `co2_tons`. |
| `dim_date.parquet` | 731 | Calendario diario 2024–2025 con jerarquía `year → quarter → month_label`. |
| `dim_plant.parquet` | 12 | Centrales generadoras agrupadas en `Hidroeléctrica`, `Solar / Eólica` y `Gas Natural`. |
| `dim_zone.parquet` | 6 | Departamentos del Perú agrupados en zonas operativas `Norte`, `Centro` y `Sur`. |

## Ejecución Local

### En Windows (PowerShell)

```powershell
git clone https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing.git
cd Actividad-Grupal-02-U2-Online-Analitycal-Processing
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
npm ci
npm run test:queries
.\.venv\Scripts\python scripts/build_data.py
npm run dev
```

### En Linux / macOS

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
