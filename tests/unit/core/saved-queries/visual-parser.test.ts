import { test, expect } from "bun:test";
import { parseSavedQuery } from "../../../../src/core/saved-queries/parser";
import { type ParseInput } from "../../../../src/core/saved-queries/parser";

test("parseSavedQuery extracts visual metadata correctly", () => {
  const input: ParseInput = {
    key: "@test",
    file: "test.sql",
    source: "local",
    text: `-- ---
-- name: Test Visual
-- visual:
--   title: "Monthly Revenue"
--   kpis:
--     - label: "Total"
--       value_column: "revenue"
--       format: "currency"
--   charts:
--     - type: "line"
--       title: "Revenue Over Time"
--       x: "month"
--       y: ["revenue"]
-- ---
SELECT * FROM revenue`
  };

  const { query } = parseSavedQuery(input);
  const visual = query.meta.visual;

  expect(visual).toBeDefined();
  expect(visual?.title).toBe("Monthly Revenue");
  expect(visual?.kpis).toHaveLength(1);
  expect(visual?.kpis?.[0]?.label).toBe("Total");
  expect(visual?.kpis?.[0]?.value_column).toBe("revenue");
  expect(visual?.kpis?.[0]?.format).toBe("currency");
  
  expect(visual?.charts).toHaveLength(1);
  expect(visual?.charts?.[0]?.type).toBe("line");
  expect(visual?.charts?.[0]?.title).toBe("Revenue Over Time");
  expect(visual?.charts?.[0]?.x).toBe("month");
  expect(visual?.charts?.[0]?.y).toEqual(["revenue"]);
});

test("parseSavedQuery handles missing visual metadata gracefully", () => {
  const input: ParseInput = {
    key: "@test-no-visual",
    file: "test.sql",
    source: "local",
    text: `-- ---
-- name: No Visual
-- ---
SELECT 1`
  };

  const { query } = parseSavedQuery(input);
  expect(query.meta.visual).toBeUndefined();
});

test("parseSavedQuery handles partial visual metadata", () => {
  const input: ParseInput = {
    key: "@test-partial",
    file: "test.sql",
    source: "local",
    text: `-- ---
-- visual:
--   title: "Just Title"
-- ---
SELECT 1`
  };

  const { query } = parseSavedQuery(input);
  expect(query.meta.visual?.title).toBe("Just Title");
  expect(query.meta.visual?.kpis).toBeUndefined();
  expect(query.meta.visual?.charts).toBeUndefined();
});
