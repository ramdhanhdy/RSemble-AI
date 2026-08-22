export const HONESTY_COPY = {
  configurationOnly: "Loads configuration only — no outputs, no execution, no lineage.",
  referenceMeaning:
    "This is the reference record. Judged results, rationale, and evidence live in the owning context.",
  unresolvedOwner:
    "This record's historical owner is unknown. RSemble never guesses an owner — exact evidence below remains fully inspectable.",
  ledgerScope:
    "Records preserve exact execution provenance. Meaningful results live in Compare, Evaluations, Lab, and Models.",
  deviceLocalUnknown:
    "Records are device-local. A link copied from another device will not resolve here.",
} as const;
