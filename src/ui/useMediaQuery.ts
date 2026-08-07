import { useEffect, useState } from "react";

/**
 * Guarded `window.matchMedia` hook. Returns false when `matchMedia` is
 * unavailable (e.g. server-side rendering or a host that omits the API), then
 * tracks live changes once it exists. Extracted from rsemble.tsx (Plan 007
 * Workstream D); the resizer/geometry consumers that call it must stay mounted
 * at/above the route boundary so split geometry and focus-mode survive
 * navigation.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
