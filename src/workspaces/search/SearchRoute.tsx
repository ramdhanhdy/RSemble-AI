// =============================================================================
// RSemble AI — Search Route Component (spec §2)
//
// Mounts the SearchWorkspace under the canonical /search route, resolving the
// SearchIndexRepository from the database context.
// =============================================================================

import { useContext, useEffect, useMemo } from "react";
import { RepositoryContext } from "../../lib/persistence/repository-context";
import { createSearchIndexRepository } from "../../lib/persistence/search-index-repository";
import {
  createDexieSearchSourceResolver,
  createDexieSearchReindexMetaStore,
  rebuildSearchIndexWithLease,
} from "../../lib/search/search-reindex";
import { SearchWorkspace } from "./SearchWorkspace";

export function SearchRoute() {
  const { db } = useContext(RepositoryContext);

  const searchRepo = useMemo(() => {
    return db ? createSearchIndexRepository(db) : null;
  }, [db]);

  const resolver = useMemo(() => {
    return db ? createDexieSearchSourceResolver(db) : null;
  }, [db]);

  useEffect(() => {
    if (db && searchRepo && resolver) {
      searchRepo
        .countDocuments()
        .then((count) => {
          if (count === 0) {
            rebuildSearchIndexWithLease({
              searchRepo,
              resolver,
              meta: createDexieSearchReindexMetaStore(db),
            }).catch(() => {
              // Non-blocking background rebuild
            });
          }
        })
        .catch(() => {});
    }
  }, [db, searchRepo, resolver]);

  return <SearchWorkspace searchRepo={searchRepo} resolver={resolver} />;
}
