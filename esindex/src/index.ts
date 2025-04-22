// === src/index.ts ===
import { execSync } from 'child_process';
import * as path from 'path';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: ts-node src/index.ts <config1.json> <config2.json> ...");
    process.exit(1);
  }

  for (const configPath of args) {
    const absPath = path.resolve(configPath);
    console.log(`Running task for config: ${absPath}`);
    try {
      execSync(`ts-node src/cli/runImporter.ts ${absPath}`, { stdio: 'inherit' });
    } catch (err) {
      console.error(`Failed to run task for ${absPath}`);
      process.exit(1);
    }
  }
}

main();
