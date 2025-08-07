// src/tests/TranscriptParser.test.ts 
import { TranscriptParser } from '../parsers/TranscriptParser';
import { TranscriptConfig } from '../types/config.types';
import * as fs from 'fs';

jest.mock('fs');

describe('TranscriptParser', () => {
  let parser: TranscriptParser;
  let mockConfig: TranscriptConfig;
  
  beforeEach(() => {
    mockConfig = {
      transcriptPath: './test-transcripts',
      format: 'txt',
      phases: {
        phase1: true,
        phase2: false,
        phase3: false
      },
      parsingOptions: {
        ignoreBlankLines: true,
        trimWhitespace: true
      },
      elasticsearchOptions: {
        url: 'http://localhost:9200',
        index: 'test_index'
      }
    };
    
    parser = new TranscriptParser(mockConfig);
  });
  
  describe('parseDirectory', () => {
    it('should process all transcript files in directory', async () => {
      // Mock fs.readdirSync to return test files
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'test1.txt',
        'test2.txt'
      ]);
      
      // Test implementation would continue...
    });
  });
  
  describe('sortFilesByDateAndSession', () => {
    it('should sort morning sessions before afternoon', () => {
      // Test the private method through public interface
    });
  });
});
