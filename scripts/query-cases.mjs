import { buildQueries } from '../src/queries.js';

const cases = [];
for (const dimension of ['year', 'quarter', 'month', 'zone', 'department', 'source_type', 'plant_name']) {
  const queries = buildQueries({ dimension });
  cases.push({ name: dimension, sql: queries.detail, total: queries.totals, metricColumn: 1 });
}
const filtered = buildQueries({
  dimension: 'month',
  year: '2025',
  zone: 'Sur',
  source_type: 'Solar / Eólica',
});
for (const [name, sql] of Object.entries(filtered)) {
  cases.push({ name: `filtrado-${name}`, sql });
}
console.log(JSON.stringify(cases));
