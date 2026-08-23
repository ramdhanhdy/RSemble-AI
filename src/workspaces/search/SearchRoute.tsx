// =============================================================================
// RSemble AI — Search Route Component (spec §2)
//
// Mounts the SearchWorkspace under the canonical /search route, resolving the
// SearchIndexRepository from the database context.
// =============================================================================

import { useContext, useMemo } from "react";
import { RepositoryContext } from "../../lib/persistence/repository-context";
import { createSearchIndexRepository } from "../../lib/persistence/search-index-repository";
import { SearchWorkspace } from "./SearchWorkspace";

export function SearchRoute() {
  const { db } = useContext(RepositoryContext);

  const searchRepo = useMemo(() => {
    return db ? createSearchIndexRepository(db) : null;
  }, [db]);

  return <SearchWorkspace searchRepo={searchRepo} />;
}
