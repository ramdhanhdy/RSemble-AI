// =============================================================================
// HeterogeneityTable — Fable §9 forward contract.
//
// Members × identity dimensions (provider, requested slug, resolved version,
// reasoning, tools, window). Identical values render normally; values that
// differ across members carry border-b-2 border-warning and a "differs" marker
// word, so heterogeneity is disclosed structurally before any evidence appears.
// =============================================================================

import type { ReactNode } from "react";
import { COPY } from "./copy";

export interface RollupMemberIdentity {
  id: string;
  values: Record<string, string>;
}

interface HeterogeneityTableProps {
  dimensions: readonly string[];
  members: readonly RollupMemberIdentity[];
}

function dimensionDiffers(
  dimension: string,
  members: readonly RollupMemberIdentity[],
): boolean {
  const seen = new Set<string>();
  for (const m of members) {
    seen.add(m.values[dimension] ?? "");
    if (seen.size > 1) return true;
  }
  return false;
}

export function HeterogeneityTable({
  dimensions,
  members,
}: HeterogeneityTableProps): ReactNode {
  return (
    <table data-heterogeneity-table className="w-full border-separate border-spacing-0 text-sm">
      <caption className="sr-only">Member identity heterogeneity</caption>
      <thead>
        <tr>
          <th scope="col" className="text-left text-xs text-text-secondary">
            Dimension
          </th>
          {members.map((m) => (
            <th
              key={m.id}
              scope="col"
              data-member-id={m.id}
              className="text-left text-xs text-text-secondary"
            >
              {m.id}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dimensions.map((dim) => {
          const differs = dimensionDiffers(dim, members);
          return (
            <tr key={dim}>
              <th scope="row" className="text-left text-xs text-text-secondary">
                {dim}
              </th>
              {members.map((m) => {
                const value = m.values[dim] ?? "";
                return (
                  <td
                    key={m.id}
                    data-dimension={dim}
                    data-member-id={m.id}
                    {...(differs ? { "data-differs": "" } : {})}
                    className={`px-2 py-1 font-mono text-xs text-text ${
                      differs ? "border-b-2 border-warning" : ""
                    }`}
                  >
                    {value}
                    {differs ? (
                      <span className="ml-1 text-warning">{COPY.rollup.differsMarker}</span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
