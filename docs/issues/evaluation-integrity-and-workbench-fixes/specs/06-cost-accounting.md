# Fix spec 06: provider-aware pricing and persisted cost provenance

## Outcome

RSemble reports an auditable cost for every paid stage when the provider exposes
usage/cost, a clearly labeled catalog estimate when only pricing is known, and
`Unknown` otherwise. It never presents a substring guess as actual cost.

## Data contract

Introduce shared optional types with backward-compatible validators:

```ts
interface UsageBreakdown {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

interface CostRecord {
  usd: number | null;
  source: "provider-reported" | "catalog-estimate" | "unknown";
  pricingSnapshot?: ModelPricingSnapshot;
}
```

Persist usage and cost on candidate, Judge, and Fusion attempt records. A reused
candidate has zero incremental cost in the repaired run and retains a source-run
link; do not double-count its historical spend.

## Required behavior

1. Extend `CatalogModel` with exact provider-scoped pricing, supported
   parameters, and fetch timestamp where upstream data exists.
2. Replace `pricingFor(slug)` substring matching with exact
   `(providerId, modelId)` lookup. Static prices may remain only as explicitly
   labeled, exact-key forecast fallbacks; they are never historical truth.
3. Widen provider completion/stream results to carry native usage and cost.
   Ensure the final OpenRouter SSE usage event is consumed rather than discarded.
4. Capture native usage for candidates, Judge, and Fusion. If a provider omits
   native usage, estimate tokens using the existing heuristic but label both
   tokens and cost as estimates.
5. Snapshot the price used at request time so later catalog changes cannot
   rewrite historical totals.
6. Include fixed request, reasoning, cache, image, and other known components
   when the provider exposes them. Never silently reduce the formula to input +
   output if a known component is nonzero.
7. Run forecast includes candidates + one Judge and, in Fuse mode, one Fusion
   call. Missing price components produce a partial/unknown label, not a false
   complete total.
8. Run detail shows stage breakdown, incremental total, source badges
   (`Reported`, `Estimated`, `Unknown`), and reused-evidence treatment.
9. Evaluation Results may sum incremental run costs, but must not count reused
   source outputs again.

## Provider rollout

- First-class accurate path: OpenRouter catalog pricing plus response usage/cost.
- Direct Gemini, DeepSeek, Codex bridge, Umans, CommandCode, ClinePass, and
  9Router: add native usage/pricing only where their actual response/catalog
  contract exposes it. Otherwise show an honest estimate or Unknown.
- Do not invent cross-provider prices or treat an upstream route’s model name as
  proof of the price charged by a gateway.

## Acceptance criteria

- OpenRouter models from the live catalog show exact input/output pricing.
- A streamed OpenRouter run persists provider-reported candidate and Judge cost.
- Judge/Fusion spend appears in totals.
- A 9Router/Umans response without usage is visibly Estimated or Unknown.
- A roster-extension repair charges only requested models plus fresh Judges.
- Archive export/import round-trips optional usage/cost fields; old v2 records
  remain readable.

## Tests

Add adapter SSE usage fixtures, pricing parser tests, builder/type-guard tests,
repair double-counting tests, RunButton forecast tests, RunDetail breakdown
tests, and archive round-trip tests.

