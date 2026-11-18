export const dimensions = {
  year: { sql: 'year', label: 'Año' },
  quarter: { sql: "year || '-T' || quarter", label: 'Trimestre' },
  month: { sql: 'month_label', label: 'Mes' },
  zone: { sql: 'zone', label: 'Zona eléctrica' },
  department: { sql: 'department', label: 'Departamento' },
  source_type: { sql: 'source_type', label: 'Tecnología' },
  plant_name: { sql: 'plant_name', label: 'Central generadora' },
};

function checked(value, allowed) {
  if (!allowed.includes(value)) throw new Error(`Valor de filtro inválido: ${value}`);
  return value;
}

export function whereClause(filters) {
  const conditions = [];
  if (filters.year) conditions.push(`year = ${checked(filters.year, ['2024', '2025'])}`);
  if (filters.zone) conditions.push(`zone = '${checked(filters.zone, ['Norte', 'Centro', 'Sur'])}'`);
  if (filters.source_type) {
    conditions.push(
      `source_type = '${checked(filters.source_type, ['Hidroeléctrica', 'Solar / Eólica', 'Gas Natural'])}'`,
    );
  }
  return conditions.length ? `where ${conditions.join(' and ')}` : '';
}

export function buildQueries(filters) {
  if (!Object.hasOwn(dimensions, filters.dimension)) throw new Error('Dimensión inválida');
  const dimension = dimensions[filters.dimension].sql;
  const where = whereClause(filters);
  const metrics = `cast(sum(energy_mwh) as double) as energy_mwh,
    cast(sum(revenue_usd) as double) as revenue_usd,
    cast(sum(margin_usd) as double) as margin_usd,
    cast(sum(co2_tons) as double) as co2_tons,
    count(*) as dispatch_blocks`;

  const detail = `select cast(${dimension} as varchar) as segment, ${metrics}
from dispatch ${where}
group by ${dimension}
order by ${dimension}`;

  return {
    detail,
    totals: `select ${metrics} from dispatch ${where}`,
    rollup: `select case
  when grouping(year) = 1 then 'TOTAL SEIN'
  when grouping(quarter) = 1 then cast(year as varchar) || ' · Subtotal anual'
  else year || '-T' || quarter
end as segment, ${metrics}
from dispatch ${where}
group by rollup(year, quarter)
order by grouping(year), year, grouping(quarter), quarter`,
    pivot: `select zone as segment,
  cast(coalesce(sum(energy_mwh) filter (where source_type = 'Hidroeléctrica'), 0) as double) as hydro_mwh,
  cast(coalesce(sum(energy_mwh) filter (where source_type = 'Solar / Eólica'), 0) as double) as renewable_mwh,
  cast(coalesce(sum(energy_mwh) filter (where source_type = 'Gas Natural'), 0) as double) as thermal_mwh,
  cast(sum(energy_mwh) as double) as energy_mwh
from dispatch ${where}
group by zone
order by zone`,
    cube: `select
  coalesce(zone, 'TODAS LAS ZONAS') as zone_segment,
  coalesce(source_type, 'TODAS LAS TECNOLOGÍAS') as source_segment,
  cast(sum(energy_mwh) as double) as energy_mwh,
  cast(sum(revenue_usd) as double) as revenue_usd,
  cast(sum(co2_tons) as double) as co2_tons
from dispatch ${where}
group by cube(zone, source_type)
order by grouping(zone), zone_segment, grouping(source_type), source_segment`,
  };
}
