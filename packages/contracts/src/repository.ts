/**
 * Contract: Repository
 * Fulfilled by: any persistence implementation (the in-house ORM, a plain in-memory
 * store, a third-party ORM...). Engines depend on this shape, never on a concrete
 * database driver.
 */
export interface Repository<T = Record<string, unknown>> {
  findById(id: string | number): Promise<T | null>;
  findOne(criteria: Partial<T>): Promise<T | null>;
  create(data: Partial<T>): Promise<T>;
  update(id: string | number, data: Partial<T>): Promise<T>;
  delete(id: string | number): Promise<void>;
}

export const REPOSITORY_METHODS: (keyof Repository)[] = [
  "findById",
  "findOne",
  "create",
  "update",
  "delete",
];
