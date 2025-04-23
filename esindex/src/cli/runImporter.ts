// === src/cli/runImporter.ts ===
import { importTEDTalks } from '../import/importTedTalks';
import { importEnronEmails } from '../import/importEnron';
import { importStopwords } from '../setup/importStopwords';
import { importCorpus } from './importCorpus';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../lib/config';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

export async function runImporterTask(config: any, configPath: string) {
  const dataset = config.dataset || 'ted';
  const task = config.task;
  const indexName = config.index || (dataset === 'ted' ? 'ted_talks' : 'enron_emails');
  const keywordSearch = config.keywordSearch !== false; // default true
  const numRecords = config.numRecords;
  const outputFileSuffix = config.outputFileSuffix;

  if (task === 'importIndex') {
    if (dataset === 'ted') {
      await importTEDTalks(indexName, keywordSearch, numRecords, outputFileSuffix);
    } else if (dataset === 'enron') {
      await importEnronEmails(indexName, keywordSearch, numRecords, outputFileSuffix);
    } else {
      console.error(`Unknown dataset: ${dataset}`);
      process.exit(1);
    }
  } else if (task === 'importStopwords') {
    const { category, fileName, delimiter, convertCsv } = config;
    if (!category || !fileName || !delimiter) {
      console.error(`Missing required field(s) in stopword import config: ${configPath}`);
      process.exit(1);
    }
    console.log(`Importing stopwords from file ${fileName}`);
    await importStopwords(category, fileName, delimiter, convertCsv);
  } else if (task === 'importCorpus') {
    await importCorpus(configPath);
  } else if (task === 'summary') {
    const corpus = await prisma.corpus.findUnique({
      where: { name: dataset },
      include: { documents: { include: { terms: true } } }
    });

    if (!corpus) {
      console.error(`No corpus found for: ${dataset}`);
      process.exit(1);
    }

    const totalDocs = corpus.documents.length;
    const allTerms = corpus.documents.flatMap(doc => doc.terms);
    const avgTermsPerDoc = totalDocs > 0 ? (allTerms.length / totalDocs).toFixed(2) : 0;

    console.log(`Summary for dataset: ${dataset}`);
    console.log(`  Total documents: ${totalDocs}`);
    console.log(`  Total terms extracted: ${allTerms.length}`);
    console.log(`  Avg terms per doc: ${avgTermsPerDoc}`);

    const docLengths = corpus.documents.map(d => d.docLength);
    const avgLength = docLengths.length ? (docLengths.reduce((a, b) => a + b, 0) / docLengths.length).toFixed(2) : 0;
    console.log(`  Avg document length: ${avgLength} characters`);
  } else {
    console.error(`Unknown task: ${task}`);
    process.exit(1);
  }
}

// gm: changed name from run, old code here
async function run() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Please provide a JSON config file path.");
    process.exit(1);
  }

  console.error("runImporter.run configPath: ${configPath}");
  const config = loadConfig(configPath);
  runImporterTask(config, configPath);
}

// gm: this is run from index.ts directly now
//run().catch(err => {
//  console.error("Import failed:", err);
//  process.exit(1);
//});
