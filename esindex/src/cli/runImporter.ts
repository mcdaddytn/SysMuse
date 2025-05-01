// === src/cli/runImporter.ts — Updated to support new CorpusSetOperation tasks ===
import { importCorpus } from './importCorpus';
import { importStopwords } from '../setup/importStopwords';
import { setupIndex } from '../setup/setupIndices';
import { summarizeCorpus } from './summarize';
import { convertTedTalks } from '../convert/convertTed';
import { convertEnronEmails } from '../convert/convertEnron';
import { loadConfig } from '../lib/config';
import { executeCorpusOperation } from '../operations/executeCorpusOperation';
import { setupCorpusType } from '../setup/setupCorpusType';
import { setupDocumentTypes } from '../setup/setupDocumentTypes';

export async function runImporterTask(config: any, configPath: string) {
  const task = config.task;

  if (task === 'importStopwords') {
    const { category, fileName, delimiter, convertCsv, corpusName } = config;
    console.log(`Importing stopwords from file ${fileName}`);
    await importStopwords(category, fileName, delimiter, convertCsv, corpusName);

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
  
  } else if (task === 'setupCorpusType') {
    const { name, description, defaultMetadata } = config;
    if (!name) {
      throw new Error(`Missing 'name' in config: ${configPath}`);
    }
    await setupCorpusType(name, description, defaultMetadata);
  
  } else if (task === 'setupDocumentTypes') {
    const { corpusType, documentTypes } = config;
    if (!corpusType || !documentTypes) {
      throw new Error(`Missing 'corpusType' or 'documentTypes' in config: ${configPath}`);
    }
    await setupDocumentTypes(corpusType, documentTypes);
  
  } else if (task === 'corpusOperation') {
    const { 
      corpus, 
      operation, 
      name, 
      operationText, 
      delimiter, 
      batchSize, 
      startIndex,
      // New parameters for exhaustive search
      documentSetName,
      nextTermSelectMode,
      nextTermEvalMode,
      evalTermCount,
      exhaustivenessThreshold
    } = config;
    if (!corpus || !operation) {
      throw new Error(`Missing 'corpus' or 'operation' in config: ${configPath}`);
    }
    await executeCorpusOperation(
      corpus, 
      operation, 
      name, 
      operationText, 
      delimiter, 
      batchSize, 
      startIndex,
      // New parameters for exhaustive search
      documentSetName,
      nextTermSelectMode,
      nextTermEvalMode,
      evalTermCount,
      exhaustivenessThreshold
    );
  } else {
    throw new Error(`Unknown task '${task}' in config: ${configPath}`);
  }
}
