/**
 * Contract: ViewEngine
 * Fulfilled by: any server-side template engine (EJS, Pug, Handlebars...).
 * The core mounts whichever implementation the project picked at `forja new` time
 * behind this same shape — no view-engine-specific code ever lives in the core.
 */
export interface ViewEngine {
  extension: string;
  render(templatePath: string, locals: Record<string, unknown>): Promise<string>;
}

export const VIEW_ENGINE_METHODS: (keyof ViewEngine)[] = ["render"];
