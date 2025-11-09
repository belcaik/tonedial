export type ProbabilityEntry = {
  key: string;
  weight: number;
};

export type AliasTable = {
  keys: string[];
  probabilities: number[];
  aliases: number[];
};

export function buildAliasTable(entries: ProbabilityEntry[]): AliasTable {
  if (!entries.length) {
    throw new Error('Alias table requires at least one entry');
  }

  const filtered = entries.filter((entry) => entry.weight > 0);
  if (!filtered.length) {
    throw new Error('Alias table weights must contain at least one positive value');
  }

  const keys = filtered.map((entry) => entry.key);
  const weights = filtered.map((entry) => entry.weight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const n = filtered.length;
  const scaled = weights.map((weight) => (weight / totalWeight) * n);

  const probabilities = new Array<number>(n);
  const aliases = new Array<number>(n).fill(-1);
  const small: number[] = [];
  const large: number[] = [];

  scaled.forEach((value, index) => {
    if (value < 1) {
      small.push(index);
    } else {
      large.push(index);
    }
  });

  while (small.length && large.length) {
    const less = small.pop()!;
    const more = large.pop()!;

    probabilities[less] = scaled[less];
    aliases[less] = more;

    scaled[more] = scaled[more] + scaled[less] - 1;
    if (scaled[more] < 1) {
      small.push(more);
    } else {
      large.push(more);
    }
  }

  [...small, ...large].forEach((index) => {
    probabilities[index] = 1;
    aliases[index] = index;
  });

  return { keys, probabilities, aliases };
}

export function sampleAlias(table: AliasTable, rng: () => number = Math.random): string {
  const { keys, probabilities, aliases } = table;
  if (!keys.length) {
    throw new Error('Alias table is empty');
  }

  const column = Math.floor(rng() * keys.length);
  const coin = rng();

  if (coin < probabilities[column]) {
    return keys[column];
  }

  return keys[aliases[column]];
}
