import { test, expect } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { tmpdir } from "os";

test("dbcli query supports --ui flag", async () => {
  const { stdout, stderr } = await $`bun run dev query --help`.quiet();
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
