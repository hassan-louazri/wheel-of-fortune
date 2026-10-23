function normalize(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

export function segmentAngles(index: number, count: number) {
  if (!Number.isInteger(count) || count < 2 || !Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error('Wheel geometry needs at least two segments and a valid segment index.');
  }
  const size = 360 / count;
  return { start: index * size - 90, end: (index + 1) * size - 90, center: (index + 0.5) * size - 90 };
}

export function rotationForSegment(index: number, count: number, currentRotation: number, turns: number): number {
  const { center } = segmentAngles(index, count);
  if (!Number.isFinite(currentRotation) || currentRotation < 0 || !Number.isInteger(turns) || turns < 1) {
    throw new Error('Rotation needs a finite non-negative starting angle and at least one full turn.');
  }
  const target = normalize(-90 - center);
  return currentRotation + turns * 360 + normalize(target - normalize(currentRotation));
}
