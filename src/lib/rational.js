// Exact rational arithmetic for musical time.
// Fractions never touch persisted JSON directly; callers convert at the boundary.
function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1n;
}

export function fraction(numerator = 0n, denominator = 1n) {
  if (denominator === 0n) throw new Error("分母不能为 0");
  let n = BigInt(numerator);
  let d = BigInt(denominator);
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function fractionFrom(value) {
  if (value && typeof value === "object" && "n" in value && "d" in value) {
    return fraction(value.n, value.d);
  }
  if (typeof value === "string" && value.includes("/")) {
    const [n, d] = value.split("/");
    return fraction(BigInt(n.trim()), BigInt(d.trim()));
  }
  return fractionFromNumber(value);
}

export function fractionFromNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("不是有效数字");
  if (Number.isInteger(number)) return fraction(BigInt(number), 1n);
  const text = String(number);
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) {
    // Extremely small/large values fall back to a bounded denominator.
    return fraction(BigInt(Math.round(number * 1e6)), 1000000n);
  }
  const sign = match[1] ? -1n : 1n;
  const integer = BigInt(match[2] || "0");
  const decimals = match[3] || "";
  let numerator = integer * 10n ** BigInt(decimals.length) + BigInt(decimals || "0");
  let denominator = 10n ** BigInt(decimals.length);
  const exponent = Number(match[4] || 0);
  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  else if (exponent < 0) denominator *= 10n ** BigInt(-exponent);
  return fraction(sign * numerator, denominator);
}

export function add(a, b) {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function subtract(a, b) {
  return fraction(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function multiply(a, b) {
  return fraction(a.n * b.n, a.d * b.d);
}

export function divide(a, b) {
  if (b.n === 0n) throw new Error("除数不能为 0");
  return fraction(a.n * b.d, a.d * b.n);
}

export function negate(a) {
  return fraction(-a.n, a.d);
}

export function compare(a, b) {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function isZero(a) {
  return a.n === 0n;
}

export function isInteger(a) {
  return a.d === 1n;
}

export function toNumber(a) {
  return Number(a.n) / Number(a.d);
}

export function toString(a) {
  return a.d === 1n ? String(a.n) : `${a.n}/${a.d}`;
}

export function min(a, b) {
  return compare(a, b) <= 0 ? a : b;
}

export function max(a, b) {
  return compare(a, b) >= 0 ? a : b;
}

export const ZERO = fraction(0n, 1n);
export const ONE = fraction(1n, 1n);
