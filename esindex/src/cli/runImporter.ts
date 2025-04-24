// === src/cli/runImporter.ts — up to date with full task support ===
import { importCorpus } from './importCorpus';
import { importStopwords } from '../setup/importStopwords';
import { setupIndex } from '../setup/setupIndices';
import { summarizeCorpus } from './summarize';
import { convertTedTalks } from '../convert/convertTed';
import { convertEnronEmails } from '../convert/convertEnron';
import { loadConfig } from '../lib/config';

export async function runImporterTask(config: any, configPath: string) {
  const task = config.task;

  if (task === 'importStopwords') {
    const { category, fileName, delimiter, convertCsv } = config;
    console.log(`Importing stopwords from file ${fileName}`);
    await importStopwords(category, fileName, delimiter, convertCsv);

  } else if (task === 'importIndex') {
    const { index, dataset } = config;
    if (!index || !dataset) {
      throw new Error(`Missing 'index' or 'dataset' in config: ${configPath}`);
    }
    await setupIndex(index, dataset);

  } else if (task === 'importCorpus') {
    await importCorpus(configPath);

  } else if (task === 'summary') {
    await summarizeCorpus(configPath);

  } else if (task === 'convert') {
    const { dataset } = config;
    if (dataset === 'ted_talks') {
      await convertTedTalks(config);
    } else if (dataset === 'enron_emails') {
      await convertEnronEmails(config);
    } else {
      throw new Error(`Unknown dataset for conversion '${dataset}'`);
    }

  } else {
    throw new Error(`Unknown task '${task}' in config: ${configPath}`);
  }
}
