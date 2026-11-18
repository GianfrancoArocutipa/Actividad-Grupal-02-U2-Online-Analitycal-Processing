"""Genera el modelo estrella de despacho eléctrico (SEIN Perú) en Parquet y valida las consultas OLAP."""

import csv
import json
import random
import subprocess
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory

import duckdb


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "data"
SEED = 202602
ROW_COUNT = 54_000

# (plant_id, source_type, plant_name, base_price_usd_mwh, op_cost_usd_mwh, co2_factor_ton_mwh)
PLANTS = [
    (1, "Hidroeléctrica", "C.H. Mantaro", 44, 12, Decimal("0.000")),
    (2, "Hidroeléctrica", "C.H. Cerro del Águila", 46, 13, Decimal("0.000")),
    (3, "Hidroeléctrica", "C.H. Chaglla", 45, 12, Decimal("0.000")),
    (4, "Hidroeléctrica", "C.H. Machupicchu", 43, 11, Decimal("0.000")),
    (5, "Solar / Eólica", "C.S. Rubí", 38, 8, Decimal("0.000")),
    (6, "Solar / Eólica", "C.S. Clemesí", 39, 8, Decimal("0.000")),
    (7, "Solar / Eólica", "C.E. Wayra", 41, 9, Decimal("0.000")),
    (8, "Solar / Eólica", "C.E. Punta Lomitas", 40, 9, Decimal("0.000")),
    (9, "Gas Natural", "C.T. Kallpa", 64, 39, Decimal("0.410")),
    (10, "Gas Natural", "C.T. Chilca1", 62, 37, Decimal("0.395")),
    (11, "Gas Natural", "C.T. Fenix", 63, 38, Decimal("0.385")),
    (12, "Gas Natural", "C.T. Malacas", 68, 43, Decimal("0.435")),
]

ZONES = [
    (1, "Norte", "Piura"),
    (2, "Norte", "La Libertad"),
    (3, "Centro", "Lima"),
    (4, "Centro", "Junín"),
    (5, "Sur", "Arequipa"),
    (6, "Sur", "Moquegua"),
]


def main() -> None:
    rng = random.Random(SEED)
    OUTPUT.mkdir(parents=True, exist_ok=True)

    with duckdb.connect(config={"threads": 1}) as db:
        print("Generando esquema estrella de despacho eléctrico (dim_date, dim_plant, dim_zone, fact_dispatch)...", flush=True)
        db.execute("""
            create table dim_date (
                date_id integer primary key,
                dispatch_date date not null,
                year integer not null,
                quarter integer not null,
                month integer not null,
                month_label varchar not null
            );
            create table dim_plant (
                plant_id integer primary key,
                source_type varchar not null,
                plant_name varchar not null
            );
            create table dim_zone (
                zone_id integer primary key,
                zone varchar not null,
                department varchar not null
            );
            create table fact_dispatch (
                dispatch_id integer primary key,
                date_id integer references dim_date(date_id),
                plant_id integer references dim_plant(plant_id),
                zone_id integer references dim_zone(zone_id),
                energy_mwh decimal(12,2) not null,
                revenue_usd decimal(14,2) not null,
                op_cost_usd decimal(14,2) not null,
                co2_tons decimal(12,2) not null
            );
        """)

        dates = [date(2024, 1, 1) + timedelta(days=offset) for offset in range(731)]
        db.begin()
        db.execute("""
            insert into dim_date
            select
                cast(strftime(day, '%Y%m%d') as integer),
                cast(day as date),
                year(day),
                quarter(day),
                month(day),
                strftime(day, '%Y-%m')
            from generate_series(date '2024-01-01', date '2025-12-31', interval '1 day') as days(day)
        """)
        db.executemany("insert into dim_plant values (?, ?, ?)", [p[:3] for p in PLANTS])
        db.executemany("insert into dim_zone values (?, ?, ?)", ZONES)

        rows = []
        for dispatch_id in range(1, ROW_COUNT + 1):
            day = rng.choice(dates)
            plant_id, _, _, price_usd, cost_usd, co2_factor = rng.choice(PLANTS)
            zone_id = rng.choices([1, 2, 3, 4, 5, 6], weights=[2, 2, 6, 4, 3, 3])[0]
            mwh = Decimal(rng.randint(45, 380))
            spot_factor = Decimal(rng.choice([95, 100, 100, 105, 110])) / Decimal(100)
            revenue = (mwh * Decimal(price_usd) * spot_factor).quantize(Decimal("0.01"))
            op_cost = (mwh * Decimal(cost_usd)).quantize(Decimal("0.01"))
            co2 = (mwh * co2_factor).quantize(Decimal("0.01"))
            rows.append((
                dispatch_id,
                int(day.strftime("%Y%m%d")),
                plant_id,
                zone_id,
                mwh,
                revenue,
                op_cost,
                co2,
            ))

        with TemporaryDirectory(prefix="olap-energia-") as temp_dir:
            csv_path = Path(temp_dir) / "dispatch.csv"
            with csv_path.open("w", newline="", encoding="utf-8") as stream:
                csv.writer(stream).writerows(rows)
            escaped = str(csv_path).replace("'", "''")
            db.execute(f"copy fact_dispatch from '{escaped}' (format csv, header false)")
        db.commit()

        print("Exportando tablas del modelo estrella a Apache Parquet (ZSTD)...", flush=True)
        for table in ("dim_date", "dim_plant", "dim_zone", "fact_dispatch"):
            target = str(OUTPUT / f"{table}.parquet").replace("'", "''")
            db.execute(f"copy {table} to '{target}' (format parquet, compression zstd)")

    with duckdb.connect(config={"threads": 1}) as db:
        for table in ("dim_date", "dim_plant", "dim_zone", "fact_dispatch"):
            source = str(OUTPUT / f"{table}.parquet").replace("'", "''")
            db.execute(f"create table {table} as select * from read_parquet('{source}')")

        schema_sql = (ROOT / "public" / "schema.sql").read_text(encoding="utf-8")
        view_sql = "create view dispatch as" + schema_sql.split("create view dispatch as", 1)[1]
        db.execute(view_sql)

        total, energy, revenue, margin, co2 = db.execute("""
            select
                count(*),
                sum(energy_mwh),
                sum(revenue_usd),
                sum(margin_usd),
                sum(co2_tons)
            from dispatch
        """).fetchone()

        if total != ROW_COUNT:
            raise ValueError(f"El modelo estrella devolvió {total} filas en lugar de {ROW_COUNT}")

        invalid = db.execute("""
            select count(*)
            from dispatch
            where energy_mwh <= 0 or revenue_usd <= 0 or op_cost_usd <= 0 or margin_usd <= 0 or co2_tons < 0
        """).fetchone()[0]
        if invalid:
            raise ValueError("Se detectaron bloques de despacho con métricas inválidas")

        result = subprocess.run(
            ["node", "scripts/query-cases.mjs"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        cases = json.loads(result.stdout)
        for case in cases:
            table = db.execute(case["sql"]).fetchall()
            if not table:
                raise ValueError(f"La consulta {case['name']} no devolvió filas")
            if "total" in case:
                expected_energy = db.execute(case["total"]).fetchone()[0]
                if round(sum(row[case["metricColumn"]] for row in table), 2) != round(expected_energy, 2):
                    raise ValueError(f"Los segmentos de {case['name']} no concilian con el total de energía")
            print(f"OK {case['name']}: {len(table)} filas")

        rollup_total = db.execute(
            "select sum(energy_mwh) from dispatch group by rollup(year) having grouping(year) = 1"
        ).fetchone()[0]
        if rollup_total != energy:
            raise ValueError("El total general de ROLLUP no coincide con la suma de hechos")

    metadata = {
        "synthetic": True,
        "seed": SEED,
        "rows": total,
        "period": "2024–2025",
        "energy_mwh": str(energy),
        "revenue_usd": str(revenue),
        "margin_usd": str(margin),
        "co2_tons": str(co2),
        "plants": len(PLANTS),
        "zones": len(ZONES),
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == "__main__":
    main()
