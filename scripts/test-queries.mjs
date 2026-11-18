import assert from 'node:assert/strict';
import { buildQueries, dimensions, whereClause } from '../src/queries.js';

assert.equal(Object.keys(dimensions).length, 7);
assert.equal(whereClause({}), '');
assert.equal(
  whereClause({ year: '2025', zone: 'Sur', source_type: 'Solar / Eólica' }),
  "where year = 2025 and zone = 'Sur' and source_type = 'Solar / Eólica'",
);

assert.throws(() => whereClause({ year: '2030' }), /Valor de filtro inválido/);
assert.throws(() => buildQueries({ dimension: 'invalid' }), /Dimensión inválida/);

const q = buildQueries({ dimension: 'quarter', year: '2025', zone: 'Centro' });
assert.match(q.detail, /group by year \|\| '-T' \|\| quarter/);
assert.match(q.rollup, /group by rollup\(year, quarter\)/);
assert.match(q.pivot, /filter \(where source_type = 'Hidroeléctrica'\)/);
assert.match(q.cube, /group by cube\(zone, source_type\)/);

console.log('Pruebas de generador SQL OLAP completadas con éxito (7 dimensiones + ROLLUP + PIVOT + CUBE).');
