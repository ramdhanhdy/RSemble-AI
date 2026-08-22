// Compatibility re-export for excluded consumers (studio-engine.ts) that still
// import from the legacy module path. The canonical module is
// `evaluation-rubric-adhoc.ts`; this file exists only so frozen/excluded
// imports resolve during the staged terminology migration.
export * from "./evaluation-rubric-adhoc";
