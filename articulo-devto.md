---
title: "Construimos una solución OLAP de Matriz Energética con DuckDB-Wasm y Apache Parquet en el navegador"
published: true
description: "Un esquema estrella de 54.000 bloques de despacho eléctrico en el Perú, operaciones ROLLUP, PIVOT y CUBE ejecutadas en WebAssembly y despliegue automatizado con GitHub Actions y Pages."
tags: duckdb, sql, dataengineering, javascript
---

Analizar la matriz eléctrica de un país suele implicar preguntas multidimensionales: «¿Cuántos megavatios-hora aportaron las centrales solares y eólicas en la zona Sur durante 2025?», «¿cómo evoluciona el margen operativo por trimestre?» o «¿cuántas toneladas de $\text{CO}_2$ evitamos al sustituir generación térmica por hidroeléctrica?». Para responder estas preguntas sin depender de servidores costosos ni de servicios de AWS, construimos **Energía Perú OLAP**, un explorador analítico que ejecuta consultas vectorizadas dentro del navegador con **DuckDB-Wasm** y **Apache Parquet**.

El proyecto modela **54.000 bloques de despacho eléctrico** de 2024 y 2025 inspirados en el Sistema Eléctrico Interconectado Nacional (**SEIN**), distribuidos entre doce centrales generadoras, tres tecnologías y seis departamentos del Perú.

[Abrir la aplicación interactiva](https://gianfrancoarocutipa.github.io/Actividad-Grupal-02-U2-Online-Analitycal-Processing/) · [Explorar el repositorio público](https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing) · [Ver el workflow de despliegue](https://github.com/GianfrancoArocutipa/Actividad-Grupal-02-U2-Online-Analitycal-Processing/actions/workflows/pages.yml)

---

## 1. Diseño del esquema estrella y granularidad

Cada registro de la tabla de hechos (`fact_dispatch`) representa un bloque de inyección de energía de una central en una zona y fecha determinadas. Almacena cuatro métricas aditivas: energía despachada (`energy_mwh`), valorización en el mercado spot (`revenue_usd`), costo operativo (`op_cost_usd`) y emisiones de carbono (`co2_tons`).

Alrededor de la tabla de hechos definimos tres dimensiones desnormalizadas para navegar por sus jerarquías:

- **`dim_date`** (731 días): fecha, año (`year`), trimestre (`quarter`) y etiqueta mensual (`month_label`).
- **`dim_plant`** (12 centrales): tecnología (`Hidroeléctrica`, `Solar / Eólica`, `Gas Natural`) y central (`C.H. Mantaro`, `C.H. Cerro del Águila`, `C.S. Rubí`, `C.E. Wayra`, `C.T. Kallpa`, entre otras).
- **`dim_zone`** (6 departamentos): zona operativa del SEIN (`Norte`, `Centro`, `Sur`) y departamento (`Piura`, `La Libertad`, `Lima`, `Junín`, `Arequipa`, `Moquegua`).

```text
                    dim_date
                       │
dim_plant ───── fact_dispatch ───── dim_zone
```

En total, el dataset consolida **11.470.432 MWh** despachados, **USD 578,07 millones** en valorización spot y **1.550.133,85 toneladas de $\text{CO}_2$**.

---

## 2. De DuckDB en Python a DuckDB-Wasm en el navegador

El flujo de datos combina dos entornos de ejecución de DuckDB:

1. **Generación y compresión columnar en CI (`scripts/build_data.py`)**: Python utiliza una semilla determinista (`SEED = 202602`) para poblar las cuatro tablas en DuckDB, valida la integridad referencial y exporta cada tabla a archivos `.parquet` comprimidos con `ZSTD`.
2. **Motor analítico en el cliente (`src/main.js`)**: Cuando un usuario abre la aplicación en GitHub Pages, el navegador instancia `@duckdb/duckdb-wasm` dentro de un **Web Worker**, registra los cuatro archivos Parquet en el sistema de archivos virtual y ejecuta `public/schema.sql` para exponer la vista analítica `dispatch`.

```text
Python + DuckDB ──► Apache Parquet (ZSTD)
                            │
                            ▼
GitHub Pages ──► DuckDB-Wasm (Web Worker) ──► Consultas OLAP en milisegundos
```

Al alojar los binarios `.wasm` y los workers directamente en el bundle de Vite, la aplicación no depende de CDNs externos ni de backends en la nube.

---

## 3. Slice, Dice y Drill-down sobre la matriz energética

Seleccionar el año `2025` aplica un corte unidimensional sobre el cubo (**Slice**). Al combinarlo con la zona `Sur` y la tecnología `Solar / Eólica`, acotamos una subcelda multidimensional (**Dice**).

Cambiar el selector **Agrupar por** permite hacer **Drill-down** desde el nivel anual hasta trimestre, mes, zona eléctrica, departamento o central generadora manteniendo activos los filtros:

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

El panel desplegable de la interfaz muestra en tiempo real las sentencias SQL exactas que DuckDB-Wasm acaba de ejecutar.

---

## 4. Operaciones multidimensionales: `ROLLUP`, `PIVOT` y `CUBE`

Además del desglose por dimensión, la aplicación incluye tres pestañas dedicadas a operaciones OLAP avanzadas que responden a los mismos filtros activos:

### Jerarquía temporal con `GROUP BY ROLLUP`

Calcula en una sola pasada los trimestres, el subtotal de cada año y el total general del SEIN utilizando la función `GROUPING()` para etiquetar cada nivel de agregación:

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

### Matriz cruzada con `FILTER` (Pivot) y `GROUP BY CUBE`

La pestaña **Pivot** transforma las tecnologías en columnas (`Hidroeléctrica`, `Solar / Eólica` y `Gas Natural`) para comparar su aporte en MWh dentro de cada zona eléctrica, mientras que la pestaña **Cube** ejecuta `group by cube(zone, source_type)` para obtener todas las combinaciones cruzadas y marginales entre geografía y fuente de energía.

---

## 5. Validación automatizada y despliegue en GitHub Pages

Antes de publicar la aplicación, el pipeline verifica tanto la lógica SQL como la conciliación contable del modelo estrella:

1. **Pruebas unitarias del generador SQL (`npm run test:queries`)**: Verifica con `node:assert` las 7 dimensiones, las cláusulas `WHERE`, el rechazo de parámetros no permitidos y la generación de `ROLLUP`, `PIVOT` y `CUBE`.
2. **Conciliación contra DuckDB (`python scripts/build_data.py`)**: Comprueba que el join del modelo estrella preserve los 54.000 bloques sin métricas negativas, ejecuta los casos de `scripts/query-cases.mjs` y verifica que la suma de cada dimensión y el total del `ROLLUP` coincidan exactamente con los **11.470.432 MWh** de la tabla de hechos.
3. **CI/CD en GitHub Actions (`.github/workflows/pages.yml`)**: En cada push a `main`, instala Python 3.11 y Node.js 22, ejecuta las pruebas, regenera los archivos Parquet, compila el bundle estático con Vite y lo despliega en **GitHub Pages** mediante `actions/deploy-pages@v4`.

---

## 6. Reproducir el proyecto localmente

Clona el repositorio y ejecuta el generador y el servidor de desarrollo con Python 3.11+ y Node.js 22+:

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

En Windows con PowerShell puedes usar `.\.venv\Scripts\python` tal como se detalla en el `README.md`. Abre la URL local que muestra Vite para explorar los 54.000 bloques de despacho, alternar entre `Roll-up`, `Pivot` y `Cube`, y exportar cualquier selección a CSV.
