// === src/cli/runImporter.ts ===
import { importTEDTalks, importEnronEmails } from '../import/importTedTalks';
import { loadConfig } from '../lib/config';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Please provide a JSON config file path.");
    process.exit(1);
  }

  const config = loadConfig(configPath);

  const dataset = config.dataset || 'ted';
  const indexName = config.index || (dataset === 'ted' ? 'ted_talks' : 'enron_emails');
  const keywordSearch = config.keywordSearch !== false; // default true
  const numRecords = config.numRecords;
  const outputFileSuffix = config.outputFileSuffix;

  if (dataset === 'ted') {
    await importTEDTalks(indexName, keywordSearch, numRecords, outputFileSuffix);
  } else if (dataset === 'enron') {
    await importEnronEmails(indexName, keywordSearch, numRecords, outputFileSuffix);
  } else {
    console.error(`Unknown dataset: ${dataset}`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error("Import failed:", err);
  process.exit(1);
});
