import { useEffect, useState } from "react";

/**
 * SSR-guarded `window.matchMedia` hook. Returns false on the server and in
 * jsdom tests without a matching media list, then tracks live changes.
 * Extracted from rsemble.tsx (Plan 007 Workstream D); the resizer/geometry
 * consumers that call it must stay mounted at/above the route boundary so
 * split geometry and focus-mode survive navigation.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
