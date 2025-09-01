import { FileConventionDetector } from './src/parsers/FileConventionDetector';
import * as fs from 'fs';

async function test() {
  const detector = new FileConventionDetector();
  const dir = './output/multi-trial/01 Genband';
  const files = fs.readdirSync(dir);
  
  console.log('Testing FileConventionDetector with new fields...');
  console.log('Directory:', dir);
  console.log('Files found:', files.length);
  
  const config = await detector.generateTrialStyleConfig(dir, files);
  
  console.log('\nGenerated config:');
  console.log('- folderName:', config.folderName);
  console.log('- extractedCaseNumber:', config.extractedCaseNumber);
  console.log('- metadata.caseNumber:', config.metadata?.caseNumber);
  console.log('- metadata.extractedCaseNumber:', config.metadata?.extractedCaseNumber);
}

test().catch(console.error);