/** Multiply plain exchange decimal strings without first rounding either operand. */
export function multiplyDecimalText(left: string, right: string): string {
  const parts = (value: string) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return { coefficient: BigInt(`${whole || '0'}${fraction}`), scale: fraction.length };
  };
  const a = parts(left), b = parts(right), coefficient = a.coefficient * b.coefficient, scale = a.scale + b.scale;
  if (!scale) return coefficient.toString();
  const digits = coefficient.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, -scale), fraction = digits.slice(-scale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Compare bounded, nonnegative, plain decimal strings without Number rounding. */
export function compareDecimalText(left: string, right: string): number {
  const [aw = '0', af = ''] = left.split('.'), [bw = '0', bf = ''] = right.split('.');
  const scale = Math.max(af.length, bf.length);
  const a = BigInt(aw + af.padEnd(scale, '0')), b = BigInt(bw + bf.padEnd(scale, '0'));
  return a < b ? -1 : a > b ? 1 : 0;
}
