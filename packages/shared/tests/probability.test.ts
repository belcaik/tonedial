import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAliasTable, sampleAlias } from '../src/probability.ts';

function mockRng(sequence: number[]) {
  let index = 0;
  return () => {
    const value = sequence[index] ?? sequence[sequence.length - 1];
    index += 1;
    return value;
  };
}

describe('probability alias method', () => {
  it('builds alias table with stable keys', () => {
    const table = buildAliasTable([
      { key: 'a', weight: 1 },
      { key: 'b', weight: 3 },
      { key: 'c', weight: 1 },
    ]);
    assert.deepEqual(table.keys, ['a', 'b', 'c']);
    assert.equal(table.probabilities.length, 3);
    assert.equal(table.aliases.length, 3);
  });

  it('samples deterministically when rng mocked', () => {
    const table = buildAliasTable([
      { key: 'x', weight: 1 },
      { key: 'y', weight: 3 },
    ]);
    const rng = mockRng([0.1, 0.9, 0.6, 0.2]);
    const first = sampleAlias(table, rng);
    const second = sampleAlias(table, rng);
    assert.ok(['x', 'y'].includes(first));
    assert.ok(['x', 'y'].includes(second));
  });

  it('throws when no positive weights provided', () => {
    assert.throws(() => buildAliasTable([{ key: 'a', weight: 0 }]));
  });
});
