create table dim_date as select * from read_parquet('dim_date.parquet');
create table dim_plant as select * from read_parquet('dim_plant.parquet');
create table dim_zone as select * from read_parquet('dim_zone.parquet');
create table fact_dispatch as select * from read_parquet('fact_dispatch.parquet');

create view dispatch as
select
    f.dispatch_id,
    d.dispatch_date,
    d.year,
    d.quarter,
    d.month,
    d.month_label,
    z.zone,
    z.department,
    p.source_type,
    p.plant_name,
    f.energy_mwh,
    f.revenue_usd,
    f.op_cost_usd,
    f.revenue_usd - f.op_cost_usd as margin_usd,
    f.co2_tons
from fact_dispatch f
join dim_date d using (date_id)
join dim_plant p using (plant_id)
join dim_zone z using (zone_id);
