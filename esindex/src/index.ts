// === src/index.ts ===
import { runImporterTask } from './cli/runImporter';
import { loadConfig } from './lib/config';

async function main() {
  const configFiles = process.argv.slice(2);

  if (configFiles.length === 0) {
    console.error("Usage: ts-node src/index.ts <config1.json> <config2.json> ...");
    process.exit(1);
  }

  const taskCount: number = configFiles.length;
  console.log(`Running ${taskCount} tasks, list of files: ${configFiles}`);
  for (const file of configFiles) {
    console.log(`Running task from: ${file}`);
    const config = loadConfig(file);
    try {
      //await runImporterTask(config);
      await runImporterTask(config, file);      
    } catch (err) {
      console.error(`Task failed for ${file}:`, err);
      process.exit(1);
    }
  }
}

main();
