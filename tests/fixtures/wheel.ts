// Independent decimal expectations for the current bundled configuration.
export const wheelCases = [
  { id: 'loss-1', sample: 0.125, lower: 0, upper: 0.25, rotation: 2497.5 },
  { id: 'dessert', sample: 0.3, lower: 0.25, upper: 0.35, rotation: 2452.5 },
  { id: 'loss-2', sample: 0.45, lower: 0.35, upper: 0.55, rotation: 2407.5 },
  { id: 'coffee', sample: 0.59, lower: 0.55, upper: 0.63, rotation: 2362.5 },
  { id: 'loss-3', sample: 0.705, lower: 0.63, upper: 0.78, rotation: 2317.5 },
  { id: 'fries', sample: 0.815, lower: 0.78, upper: 0.85, rotation: 2272.5 },
  { id: 'loss-4', sample: 0.9, lower: 0.85, upper: 0.95, rotation: 2227.5 },
  { id: 'discount', sample: 0.975, lower: 0.95, upper: 1, rotation: 2182.5 },
] as const;
