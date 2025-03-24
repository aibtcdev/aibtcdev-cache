export function stringifyWithBigInt(
  value: unknown, 
  replacer?: (key: string, value: unknown) => unknown, 
  space?: string | number
): string {
  const customReplacer = (key: string, val: unknown): unknown => {
    if (typeof val === 'bigint') {
      return val.toString() + 'n'; // Convert BigInt to string with 'n' suffix
    }
    if (replacer && typeof replacer === 'function') {
      return replacer(key, val);
    }
    return val;
  };

  return JSON.stringify(value, customReplacer, space);
}
