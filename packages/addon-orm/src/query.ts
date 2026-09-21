/**
 * Query operators, one level beyond plain equality — `{ age: { gt: 18 } }`
 * instead of only `{ age: 18 }`. Deliberately small (no $and/$or nesting, no
 * regex): every driver has to be able to honor these identically, and this is
 * the set every driver's query engine (SQL WHERE, Mongo's own operators, or
 * plain in-process filtering) can express without surprises.
 */
export interface QueryOperators<V = unknown> {
  eq?: V;
  ne?: V;
  gt?: V;
  gte?: V;
  lt?: V;
  lte?: V;
  in?: V[];
  nin?: V[];
}

const OPERATOR_KEYS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin"] as const;

export type QueryValue<V> = V | QueryOperators<V>;

export type QueryCriteria<T> = { [K in keyof T]?: QueryValue<T[K]> };

export function isQueryOperators(value: unknown): value is QueryOperators {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((k) => (OPERATOR_KEYS as readonly string[]).includes(k))
  );
}

function matchesOperators(actual: unknown, ops: QueryOperators): boolean {
  if ("eq" in ops && !(actual === ops.eq)) return false;
  if ("ne" in ops && actual === ops.ne) return false;
  if ("gt" in ops && !((actual as never) > (ops.gt as never))) return false;
  if ("gte" in ops && !((actual as never) >= (ops.gte as never))) return false;
  if ("lt" in ops && !((actual as never) < (ops.lt as never))) return false;
  if ("lte" in ops && !((actual as never) <= (ops.lte as never))) return false;
  if ("in" in ops && !ops.in!.includes(actual as never)) return false;
  if ("nin" in ops && ops.nin!.includes(actual as never)) return false;
  return true;
}

/** In-process matcher — the universal fallback every driver can fall back to. */
export function matchesCriteria<T extends Record<string, unknown>>(
  doc: T,
  criteria: QueryCriteria<T>,
): boolean {
  return Object.entries(criteria).every(([key, condition]) => {
    const actual = doc[key];
    if (isQueryOperators(condition)) return matchesOperators(actual, condition);
    return actual === condition;
  });
}
