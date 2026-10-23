export class RbTree {
  constructor(compare?: (a: string, b: string) => number);
  size: number;
  clear(): void;
  insert(key: string, value: unknown): void;
  remove(key: string): boolean;
  get(key: string): unknown;
  rangeByPrefix(prefix: string): Generator<{ key: string; value: any }>;
  contains(substr: string, limit?: number): Generator<{ key: string; value: any }>;
}
