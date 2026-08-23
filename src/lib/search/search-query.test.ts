import { describe, expect, it } from "vitest";
import type { SearchDocument } from "./search-types";
import { createSearchIndex } from "./search-index";
import { querySearchIndex } from "./search-query";

function doc(
  id: string,
  extras: Partial<SearchDocument> & Pick<SearchDocument, "type" | "title">,
): SearchDocument {
  return {
    id,
    revision: 1,
    subtitle: extras.subtitle ?? extras.type,
    ownerHref: extras.ownerHref ?? `/${extras.type}/${id}`,
    tokens: extras.tokens ?? extras.title.toLowerCase().split(/\s+/),
    updatedAt: extras.updatedAt ?? 1000,
    indexSchemaVersion: 1,
    ...extras,
  };
}

function ids(result: ReturnType<typeof querySearchIndex>): string[] {
  return result.items.map((hit) => hit.document.id);
}

const CORPUS = [
  doc("task-alpha", { type: "task", title: "Draft a brief", updatedAt: 10 }),
  doc("task-beta", { type: "task", title: "Review the brief", updatedAt: 20 }),
  doc("set-1", { type: "task_set", title: "Briefing suite", updatedAt: 30 }),
  doc("eval-1", { type: "evaluation", title: "Briefing run", updatedAt: 40 }),
  doc("cmp-1", {
    type: "comparison",
    title: "Ad hoc compare",
    tokens: ["adhoc", "compare"],
    updatedAt: 50,
  }),
];

describe("querySearchIndex ranking", () => {
  const index = createSearchIndex(CORPUS);

  it("ranks exact ID above title prefix above token match", () => {
    const extra = [
      doc("brief", { type: "task", title: "Unrelated name", tokens: ["other"], updatedAt: 1 }),
      doc("x-prefix", { type: "task", title: "Briefing notes", updatedAt: 2 }),
      doc("x-token", { type: "task", title: "Something else", tokens: ["brief"], updatedAt: 3 }),
    ];
    const result = querySearchIndex(createSearchIndex(extra), { text: "brief" });
    expect(ids(result)).toEqual(["brief", "x-prefix", "x-token"]);
    expect(result.items[0]?.rank).toBe("exact_id");
    expect(result.items[1]?.rank).toBe("title_prefix");
    expect(result.items[2]?.rank).toBe("token");
  });

  it("keeps type groups and never coerces one type into another", () => {
    const result = querySearchIndex(index, { text: "brief", type: "task" });
    expect(result.items.every((hit) => hit.document.type === "task")).toBe(true);
    expect(result.groups.map((g) => g.type)).toEqual(["task"]);
    expect(ids(querySearchIndex(index, { text: "brief", type: "evaluation" }))).toEqual(["eval-1"]);
  });

  it("orders ties by newest then id and paginates the ranked list", () => {
    const twins = [
      doc("aa", { type: "task", title: "Same title", updatedAt: 5 }),
      doc("bb", { type: "task", title: "Same title", updatedAt: 5 }),
      doc("cc", { type: "task", title: "Same title", updatedAt: 9 }),
    ];
    const page = querySearchIndex(createSearchIndex(twins), { text: "same", limit: 2, offset: 0 });
    expect(ids(page)).toEqual(["cc", "aa"]);
    expect(page.total).toBe(3);
    expect(
      ids(querySearchIndex(createSearchIndex(twins), { text: "same", limit: 2, offset: 2 })),
    ).toEqual(["bb"]);
  });

  it("treats empty, huge, and unicode queries as safe local text", () => {
    expect(querySearchIndex(index, { text: "   " }).items).toEqual([]);
    expect(querySearchIndex(index, { text: "x".repeat(4000) }).items).toEqual([]);
    const cafe = createSearchIndex([
      doc("cafe-1", { type: "task", title: "Café notes", tokens: ["cafe", "notes"] }),
    ]);
    expect(ids(querySearchIndex(cafe, { text: "cafe" }))).toEqual(["cafe-1"]);
    expect(ids(querySearchIndex(cafe, { text: "CAFÉ" }))).toEqual(["cafe-1"]);
  });

  it("queries 10_000 documents without remote calls", () => {
    const docs: SearchDocument[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      const type = (["task", "evaluation", "comparison"] as const)[i % 3];
      docs.push(
        doc(`id-${i}`, {
          type,
          title: i === 4242 ? "Needle title" : `Item ${i}`,
          tokens: i === 4242 ? ["needle"] : [`item${i}`],
          updatedAt: i,
        }),
      );
    }
    const started = performance.now();
    const result = querySearchIndex(createSearchIndex(docs), { text: "needle" });
    const elapsed = performance.now() - started;
    expect(ids(result)).toEqual(["id-4242"]);
    expect(elapsed).toBeLessThan(250);
  });
});
