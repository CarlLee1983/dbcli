const mappings = [
  ["assets/SKILL.md", "plugins/dbcli-agent/skills/dbcli/SKILL.md"],
  ["assets/reference.md", "plugins/dbcli-agent/skills/dbcli/reference.md"],
] as const;

const write = process.argv.includes("--write");
let drift = false;

for (const [source, target] of mappings) {
  const sourceText = await Bun.file(source).text();
  const targetFile = Bun.file(target);
  const targetExists = await targetFile.exists();
  const targetText = targetExists ? await targetFile.text() : "";

  if (sourceText === targetText) {
    console.log(`ok ${target}`);
    continue;
  }

  if (write) {
    await Bun.write(target, sourceText);
    console.log(`synced ${target}`);
    continue;
  }

  drift = true;
  console.error(`drift ${target} differs from ${source}`);
}

if (drift) {
  console.error("Run `bun run plugin:sync` to refresh plugin skill assets.");
  process.exit(1);
}
