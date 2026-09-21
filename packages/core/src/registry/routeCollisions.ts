import type { Router } from "express";

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

interface RouterWithStack {
  stack: RouteLayer[];
}

export interface RouteFileEntry {
  file: string;
  router: Router;
}

/**
 * Walks each router's own registered routes (method + literal path) and
 * throws if two different files declare the exact same one. Express never
 * detects this itself: whichever router mounts first silently wins the
 * request, and the other file's handler for that route never runs at all —
 * no error, no warning, just a route that quietly does the wrong thing.
 *
 * Only exact method+path matches are flagged. Two routes that merely overlap
 * by design (e.g. "/users/:id" and "/users/new") are not collisions — that's
 * ordinary REST routing, resolved by mount order like Express always has.
 *
 * Pure function, no Express app or I/O involved — RouteRegistry.load() is the
 * only caller, and it owns scanning/requiring/mounting; this owns only the
 * collision check.
 */
export function assertNoRouteCollisions(entries: RouteFileEntry[]): void {
  const seenBy = new Map<string, string>(); // "METHOD /path" -> file that declared it first

  for (const { file, router } of entries) {
    const stack = (router as unknown as RouterWithStack).stack ?? [];

    for (const layer of stack) {
      if (!layer.route) continue; // a router-level middleware, not a route

      const methods = Object.keys(layer.route.methods).filter((m) => layer.route!.methods[m]);

      for (const method of methods) {
        const key = `${method.toUpperCase()} ${layer.route.path}`;
        const existingFile = seenBy.get(key);

        if (existingFile && existingFile !== file) {
          throw new Error(
            `Route collision: "${key}" is declared in both "${existingFile}" and "${file}" — ` +
              `only one can ever handle it (Express silently prefers whichever mounts first).`,
          );
        }

        seenBy.set(key, file);
      }
    }
  }
}
