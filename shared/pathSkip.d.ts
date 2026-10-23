export class PathSkipList {
  size: number;
  clear(): void;
  insert(key: string, value: unknown): void;
  remove(key: string): boolean;
  lowerBound(key: string): { key: string; value: unknown } | null;
  byPathPrefix(prefix: string, limit?: number): Generator<{ key: string; value: any }>;
  convergeSegments(segments: string[], limit?: number): { key: string; value: any }[];
}
