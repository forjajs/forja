import type { Application } from "express";

/**
 * Contract: Addon
 * Fulfilled by: every official or third-party Forja addon (auth, orm, realtime,
 * i18n, validator...). `forja add <addon>` and the core's addon loader only ever
 * talk to this shape, regardless of what the addon actually does internally.
 */
export interface Addon {
  name: string;
  register(app: Application, config: Record<string, unknown>): void | Promise<void>;
}

export const ADDON_METHODS: (keyof Addon)[] = ["register"];
