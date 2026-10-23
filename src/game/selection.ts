export function validateProbabilities(segments: readonly { probability: number }[]): number {
  const total = segments.reduce((sum, segment) => {
    if (!Number.isFinite(segment.probability) || segment.probability < 0 || segment.probability > 1) {
      throw new Error('Segment probability must be a finite number between 0 and 1.');
    }
    return sum + segment.probability;
  }, 0);
  if (Math.abs(total - 1) > 1e-9) throw new Error('Segment probabilities must sum to 1.');
  return total;
}

function decimalParts(value: number) {
  const [mantissa, exponent] = value.toExponential().split('e');
  return {
    digits: BigInt(mantissa!.replace('.', '')),
    places: (mantissa!.split('.')[1]?.length ?? 0) - Number(exponent),
  };
}

export function selectSegment(segments: readonly { probability: number }[], randomValue: number): number {
  validateProbabilities(segments);
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new Error('Random value must be between 0 (inclusive) and 1 (exclusive).');
  }
  // A shared decimal scale keeps boundary comparisons exact, including scientific notation.
  const parts = [...segments.map((segment) => segment.probability), randomValue].map(decimalParts);
  const places = Math.max(...parts.map((part) => part.places));
  const scale = 10n ** BigInt(places);
  const weights = parts.map((part) => part.digits * 10n ** BigInt(places - part.places));
  const sample = weights.pop()!;
  const target = sample * weights.reduce((total, weight) => total + weight, 0n);
  let cumulative = 0n;
  return weights.findIndex((weight) => {
    cumulative += weight;
    return target < cumulative * scale;
  });
}
