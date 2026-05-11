import { test, expect } from "bun:test";
import { $ } from "bun";

test("dbcli query supports --ui flag", async () => {
  const { stdout } = await $`bun run dev query --help`.quiet();
  expect(stdout.toString()).toContain('--ui');
});

test("dbcli q supports --ui flag", async () => {
  const { stdout } = await $`bun run dev q --help`.quiet();
  expect(stdout.toString()).toContain('--ui');
});

test("dbcli export supports html format", async () => {
  const { stdout } = await $`bun run dev export --help`.quiet();
  expect(stdout.toString()).toContain('html');
});
