export function slidingCorrelation(
  seriesA: number[],
  seriesB: number[],
  window: number
): Array<number | null> {
  const safeWindow = Math.max(Math.floor(window), 1);
  const length = Math.min(seriesA.length, seriesB.length);
  const result: Array<number | null> = new Array(length);

  for (let i = 0; i < length; i++) {
    if (i < safeWindow) {
      result[i] = null;
      continue;
    }

    const sliceA = seriesA.slice(i - safeWindow, i);
    const sliceB = seriesB.slice(i - safeWindow, i);

    const meanA = sliceA.reduce((a, b) => a + b, 0) / safeWindow;
    const meanB = sliceB.reduce((a, b) => a + b, 0) / safeWindow;

    const cov = sliceA.reduce((acc, aVal, idx) => {
      return acc + (aVal - meanA) * (sliceB[idx] - meanB);
    }, 0) / safeWindow;

    const stdA = Math.sqrt(
      sliceA.reduce((acc, aVal) => acc + Math.pow(aVal - meanA, 2), 0) / safeWindow
    );

    const stdB = Math.sqrt(
      sliceB.reduce((acc, bVal) => acc + Math.pow(bVal - meanB, 2), 0) / safeWindow
    );

    if (stdA === 0 || stdB === 0) {
      result[i] = null;
      continue;
    }

    result[i] = cov / (stdA * stdB);
  }

  return result;
}

export function smoothSeries(values: Array<number | null>, radius: number): Array<number | null> {
  const windowRadius = Math.max(Math.floor(radius), 0);
  if (windowRadius === 0) {
    return values.slice();
  }

  return values.map((value, idx) => {
    if (value === null) {
      return null;
    }

    let sum = 0;
    let count = 0;

    for (let offset = -windowRadius; offset <= windowRadius; offset++) {
      const neighborIndex = idx + offset;
      if (neighborIndex < 0 || neighborIndex >= values.length) {
        continue;
      }

      const neighborValue = values[neighborIndex];
      if (neighborValue === null || !Number.isFinite(neighborValue)) {
        continue;
      }

      sum += neighborValue;
      count++;
    }

    return count > 0 ? sum / count : null;
  });
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const performLinearRegression = (seriesA: number[], seriesB: number[]) => {
  const length = Math.min(seriesA.length, seriesB.length);
  const pairs: Array<{ a: number; b: number }> = [];

  for (let i = 0; i < length; i++) {
    const a = seriesA[i];
    const b = seriesB[i];
    if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
      continue;
    }
    pairs.push({ a, b });
  }

  if (pairs.length < 2) {
    return { alpha: 0, beta: 0, valid: false } as const;
  }

  const n = pairs.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const pair of pairs) {
    sumX += pair.b;
    sumY += pair.a;
    sumXY += pair.a * pair.b;
    sumXX += pair.b * pair.b;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    const meanY = sumY / n;
    return { alpha: meanY, beta: 0, valid: true } as const;
  }

  const beta = (n * sumXY - sumX * sumY) / denominator;
  const alpha = (sumY - beta * sumX) / n;
  return { alpha, beta, valid: true } as const;
};

export function computeCointegrationZScore(
  seriesA: number[],
  seriesB: number[],
  window: number
): Array<number | null> {
  const length = Math.min(seriesA.length, seriesB.length);
  const residuals: Array<number | null> = new Array(length).fill(null);
  if (!length) {
    return residuals;
  }

  const regression = performLinearRegression(seriesA, seriesB);
  if (!regression.valid) {
    return residuals;
  }

  for (let i = 0; i < length; i++) {
    const a = seriesA[i];
    const b = seriesB[i];
    if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
      continue;
    }
    residuals[i] = a - (regression.alpha + regression.beta * b);
  }

  const safeWindow = Math.max(Math.floor(window), 2);
  const zscores: Array<number | null> = new Array(length).fill(null);

  for (let i = 0; i < length; i++) {
    const currentResidual = residuals[i];
    if (i < safeWindow - 1 || currentResidual === null) {
      zscores[i] = null;
      continue;
    }

    const start = Math.max(0, i - (safeWindow - 1));
    const slice: number[] = [];
    for (let idx = start; idx <= i; idx++) {
      const value = residuals[idx];
      if (value === null || !Number.isFinite(value)) {
        continue;
      }
      slice.push(value);
    }

    if (slice.length < 2) {
      zscores[i] = null;
      continue;
    }

    const mean = slice.reduce((acc, val) => acc + val, 0) / slice.length;
    const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);

    if (!Number.isFinite(std) || std === 0) {
      zscores[i] = null;
      continue;
    }

    zscores[i] = (currentResidual - mean) / std;
  }

  return zscores;
}
