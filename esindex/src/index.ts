// === src/index.ts ===
import { importCorpus } from './cli/importCorpus';
import { setupEnronIndex, setupTedIndex } from './setup/setupIndices';
import { importStopwords } from './setup/importStopwords';

async function run() {
  await setupEnronIndex();
  await setupTedIndex();
  await importStopwords('general', 'general_stopwords.txt', /\n/);

  const configFile = process.argv[2];
  if (!configFile) {
    console.error("Usage: ts-node src/index.ts <config.json>");
    process.exit(1);
  }

  await importCorpus(configFile);
}

run();
