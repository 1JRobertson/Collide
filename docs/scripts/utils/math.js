import { SIZES } from "../constants.js";

const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);
const SQRT_TWO = Math.sqrt(2);

function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const poly = (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t);
  const expTerm = Math.exp(-absX * absX);
  return sign * (1 - poly * expTerm);
}

function normalPdf(z) {
  return Math.exp(-0.5 * z * z) / SQRT_TWO_PI;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / SQRT_TWO));
}

function skewNormalPdf(x, mean, sigma, alpha) {
  const z = (x - mean) / sigma;
  const base = (2 / sigma) * normalPdf(z);
  return base * normalCdf(alpha * z);
}

export function probabilityForBin(index, mean, sigma, alpha) {
  const lower = index - 0.5;
  const upper = index + 0.5;
  const steps = 200;
  const h = (upper - lower) / steps;
  let sum = 0.5 * (skewNormalPdf(lower, mean, sigma, alpha) + skewNormalPdf(upper, mean, sigma, alpha));
  for (let i = 1; i < steps; i += 1) {
    const x = lower + i * h;
    sum += skewNormalPdf(x, mean, sigma, alpha);
  }
  return sum * h;
}

export function computeDistribution(mean, sigma, skew) {
  const probabilities = SIZES.map((_, index) => probabilityForBin(index, mean, sigma, skew));
  const total = probabilities.reduce((acc, value) => acc + value, 0);
  return probabilities.map((value) => (total > 0 ? value / total : 0));
}

export function allocateCounts(probabilities, totalUnits) {
  if (totalUnits <= 0) {
    return probabilities.map(() => 0);
  }
  const targetTotal = Math.round(totalUnits);
  const rawCounts = probabilities.map((p) => p * totalUnits);
  const counts = rawCounts.map((value) => Math.floor(value));
  const fractionalParts = rawCounts.map((value, index) => ({
    index,
    fraction: value - Math.floor(value)
  }));

  let remainder = targetTotal - counts.reduce((acc, value) => acc + value, 0);

  if (remainder > 0) {
    const sorted = fractionalParts.slice().sort((a, b) => b.fraction - a.fraction);
    let idx = 0;
    while (remainder > 0 && sorted.length > 0) {
      const target = sorted[idx % sorted.length];
      counts[target.index] += 1;
      remainder -= 1;
      idx += 1;
    }
  } else if (remainder < 0) {
    const sorted = fractionalParts.slice().sort((a, b) => a.fraction - b.fraction);
    let idx = 0;
    while (remainder < 0 && sorted.length > 0) {
      const target = sorted[idx % sorted.length];
      if (counts[target.index] > 0) {
        counts[target.index] -= 1;
        remainder += 1;
      }
      idx += 1;
    }
  }

  return counts;
}
