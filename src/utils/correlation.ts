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
