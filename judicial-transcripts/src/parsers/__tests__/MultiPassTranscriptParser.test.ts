import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { Logger } from '../../utils/logger';
import { MultiPassTranscriptParser } from '../MultiPassTranscriptParser';
import { MetadataExtractor } from '../MultiPassMetadataExtractor';
import { StructureAnalyzer } from '../MultiPassStructureAnalyzer';
import { ContentParser } from '../MultiPassContentParser';
import { DocumentSection } from '../MultiPassTypes';
import * as fs from 'fs';

jest.mock('fs');
jest.mock('@prisma/client');

describe('MultiPassTranscriptParser', () => {
  let parser: MultiPassTranscriptParser;
  let prisma: jest.Mocked<PrismaClient>;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    prisma = {
      page: {
        createMany: jest.fn(),
        findMany: jest.fn()
      },
      line: {
        createMany: jest.fn()
      },
      sessionSection: {
        create: jest.fn()
      }
    } as any;

    logger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as any;

    parser = new MultiPassTranscriptParser(prisma, logger, {
      loadInMemory: true,
      validatePasses: true,
      debugOutput: false
    });
  });

  describe('parseTranscript', () => {
    it('should successfully parse a transcript through all three passes', async () => {
      const mockFileContent = [
        '1                    UNITED STATES DISTRICT COURT                    1',
        '',
        'APPEARANCES:',
        'FOR THE PLAINTIFF:',
        '   MR. JOHN DOE',
        '   Attorney at Law',
        '',
        'FOR THE DEFENDANT:',
        '   MS. JANE SMITH',
        '   Attorney at Law',
        '',
        'PROCEEDINGS',
        '09:00:00  1  THE COURT: Good morning, everyone.',
        '09:00:05  2  MR. DOE: Good morning, Your Honor.',
        '09:00:10  3  MS. SMITH: Good morning, Your Honor.',
        '',
        'CERTIFICATION',
        'I certify that this is a true and correct transcript.'
      ];

      (fs.promises.readFile as jest.Mock).mockResolvedValue(mockFileContent.join('\n'));

      const result = await parser.parseTranscript('/test/file.txt', 1, 1);

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('Starting multi-pass parsing for: /test/file.txt');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Multi-pass parsing completed'));
    });

    it('should handle Pass 1 failure gracefully', async () => {
      (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));

      const result = await parser.parseTranscript('/test/nonexistent.txt', 1, 1);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Multi-pass parsing failed', expect.any(Error));
    });
  });
});

describe('MetadataExtractor', () => {
  let extractor: MetadataExtractor;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as any;

    extractor = new MetadataExtractor(logger);
  });

  describe('extractMetadata', () => {
    it('should extract page headers correctly', async () => {
      const fileContent = [
        '1                    UNITED STATES DISTRICT COURT                    1',
        'Line 1 content',
        'Line 2 content',
        '2                    UNITED STATES DISTRICT COURT                    2',
        'Line 3 content'
      ];

      const result = await extractor.extractMetadata(fileContent, '/test/file.txt');

      expect(result.pages.size).toBe(2);
      expect(result.pages.get(1)).toMatchObject({
        pageNumber: 1,
        trialPageNumber: 1,
        parsedTrialPage: 1
      });
      expect(result.pages.get(2)).toMatchObject({
        pageNumber: 2,
        trialPageNumber: 2,
        parsedTrialPage: 2
      });
    });

    it('should extract line metadata with timestamps', async () => {
      const fileContent = [
        '09:00:00  1  THE COURT: Good morning.',
        '09:00:05  2  MR. DOE: Good morning, Your Honor.'
      ];

      const result = await extractor.extractMetadata(fileContent, '/test/file.txt');

      expect(result.lines.size).toBe(2);
      
      const firstLine = result.lines.get(0);
      expect(firstLine).toMatchObject({
        timestamp: '09:00:00',
        prefix: '09:00:00 1',
        cleanText: 'THE COURT: Good morning.'
      });
    });

    it('should extract line metadata without timestamps', async () => {
      const fileContent = [
        '1    APPEARANCES:',
        '2    FOR THE PLAINTIFF:'
      ];

      const result = await extractor.extractMetadata(fileContent, '/test/file.txt');

      expect(result.lines.size).toBe(2);
      
      const firstLine = result.lines.get(0);
      expect(firstLine).toMatchObject({
        prefix: '1',
        cleanText: 'APPEARANCES:'
      });
    });

    it('should handle multi-line page headers', async () => {
      const fileContent = [
        '1',
        'UNITED STATES DISTRICT COURT',
        '1',
        'Line content here'
      ];

      const result = await extractor.extractMetadata(fileContent, '/test/file.txt');

      expect(result.pages.size).toBe(1);
      expect(result.pages.get(1)).toMatchObject({
        pageNumber: 1,
        trialPageNumber: 1,
        headerText: '1 UNITED STATES DISTRICT COURT 1'
      });
    });
  });
});

describe('StructureAnalyzer', () => {
  let analyzer: StructureAnalyzer;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as any;

    analyzer = new StructureAnalyzer(logger);
  });

  describe('analyzeStructure', () => {
    it('should identify SUMMARY section', async () => {
      const metadata = {
        pages: new Map([[1, { pageNumber: 1 }]]),
        lines: new Map([
          [0, { cleanText: 'APPEARANCES:', fileLineNumber: 0 }],
          [1, { cleanText: 'FOR THE PLAINTIFF:', fileLineNumber: 1 }],
          [2, { cleanText: 'MR. JOHN DOE', fileLineNumber: 2 }],
          [3, { cleanText: 'Attorney at Law', fileLineNumber: 3 }],
          [4, { cleanText: 'PROCEEDINGS', fileLineNumber: 4 }]
        ]),
        fileLineMapping: new Map([
          [0, { pageNumber: 1, lineNumber: 0 }],
          [1, { pageNumber: 1, lineNumber: 1 }],
          [2, { pageNumber: 1, lineNumber: 2 }],
          [3, { pageNumber: 1, lineNumber: 3 }],
          [4, { pageNumber: 1, lineNumber: 4 }]
        ]),
        rawContent: []
      };

      const result = await analyzer.analyzeStructure(metadata);

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]).toMatchObject({
        section: DocumentSection.SUMMARY,
        startLine: 0,
        endLine: 3
      });
    });

    it('should identify PROCEEDINGS section', async () => {
      const metadata = {
        pages: new Map([[1, { pageNumber: 1 }]]),
        lines: new Map([
          [0, { cleanText: 'PROCEEDINGS', fileLineNumber: 0 }],
          [1, { cleanText: '09:00:00  1  THE COURT: Good morning.', fileLineNumber: 1 }],
          [2, { cleanText: '09:00:05  2  MR. DOE: Good morning.', fileLineNumber: 2 }]
        ]),
        fileLineMapping: new Map([
          [0, { pageNumber: 1, lineNumber: 0 }],
          [1, { pageNumber: 1, lineNumber: 1 }],
          [2, { pageNumber: 1, lineNumber: 2 }]
        ]),
        rawContent: []
      };

      const result = await analyzer.analyzeStructure(metadata);

      const proceedingsSection = result.sections.find(s => s.section === DocumentSection.PROCEEDINGS);
      expect(proceedingsSection).toBeDefined();
      expect(proceedingsSection).toMatchObject({
        section: DocumentSection.PROCEEDINGS,
        startLine: 0
      });
    });

    it('should identify CERTIFICATION section', async () => {
      const metadata = {
        pages: new Map([[1, { pageNumber: 1 }]]),
        lines: new Map([
          [0, { cleanText: 'CERTIFICATION', fileLineNumber: 0 }],
          [1, { cleanText: 'I certify that this is true and correct.', fileLineNumber: 1 }],
          [2, { cleanText: 'COURT REPORTER: Jane Doe', fileLineNumber: 2 }]
        ]),
        fileLineMapping: new Map([
          [0, { pageNumber: 1, lineNumber: 0 }],
          [1, { pageNumber: 1, lineNumber: 1 }],
          [2, { pageNumber: 1, lineNumber: 2 }]
        ]),
        rawContent: []
      };

      const result = await analyzer.analyzeStructure(metadata);

      const certSection = result.sections.find(s => s.section === DocumentSection.CERTIFICATION);
      expect(certSection).toBeDefined();
      expect(certSection).toMatchObject({
        section: DocumentSection.CERTIFICATION,
        startLine: 0,
        endLine: 2
      });
    });

    it('should handle missing sections gracefully', async () => {
      const metadata = {
        pages: new Map([[1, { pageNumber: 1 }]]),
        lines: new Map([
          [0, { cleanText: 'Random text', fileLineNumber: 0 }],
          [1, { cleanText: 'More random text', fileLineNumber: 1 }]
        ]),
        fileLineMapping: new Map([
          [0, { pageNumber: 1, lineNumber: 0 }],
          [1, { pageNumber: 1, lineNumber: 1 }]
        ]),
        rawContent: []
      };

      const result = await analyzer.analyzeStructure(metadata);

      expect(result.sections).toHaveLength(0);
      expect(result.sectionMapping.get(0)).toBe(DocumentSection.UNKNOWN);
      expect(result.sectionMapping.get(1)).toBe(DocumentSection.UNKNOWN);
    });
  });
});

describe('ContentParser', () => {
  let parser: ContentParser;
  let prisma: jest.Mocked<PrismaClient>;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    prisma = {
      page: {
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { id: 1, pageNumber: 1 }
        ])
      },
      line: {
        createMany: jest.fn()
      },
      sessionSection: {
        create: jest.fn()
      }
    } as any;

    logger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as any;

    parser = new ContentParser(prisma, logger);
  });

  describe('parseContent', () => {
    it('should create pages and lines', async () => {
      const metadata = {
        pages: new Map([[1, {
          pageNumber: 1,
          trialPageNumber: 1,
          parsedTrialPage: 1,
          headerText: 'Page 1'
        }]]),
        lines: new Map([[0, {
          fileLineNumber: 0,
          pageLineNumber: 0,
          prefix: '1',
          cleanText: 'THE COURT: Good morning.',
          rawText: '1  THE COURT: Good morning.'
        }]]),
        fileLineMapping: new Map([[0, { pageNumber: 1, lineNumber: 0 }]]),
        rawContent: []
      };

      const structure = {
        sections: [{
          section: DocumentSection.PROCEEDINGS,
          startLine: 0,
          endLine: 0,
          startPage: 1,
          endPage: 1
        }],
        sectionMapping: new Map([[0, DocumentSection.PROCEEDINGS]])
      };

      await parser.parseContent(metadata, structure, 1, 1, 100);

      expect(prisma.page.createMany).toHaveBeenCalled();
      expect(prisma.line.createMany).toHaveBeenCalled();
    });

    it('should extract speaker information', async () => {
      const metadata = {
        pages: new Map([[1, { pageNumber: 1 }]]),
        lines: new Map([
          [0, { cleanText: 'THE COURT: Good morning.', rawText: 'THE COURT: Good morning.', fileLineNumber: 0 }],
          [1, { cleanText: 'MR. DOE: Good morning.', rawText: 'MR. DOE: Good morning.', fileLineNumber: 1 }],
          [2, { cleanText: 'MS. SMITH: Good morning.', rawText: 'MS. SMITH: Good morning.', fileLineNumber: 2 }]
        ]),
        fileLineMapping: new Map([
          [0, { pageNumber: 1, lineNumber: 0 }],
          [1, { pageNumber: 1, lineNumber: 1 }],
          [2, { pageNumber: 1, lineNumber: 2 }]
        ]),
        rawContent: []
      };

      const structure = {
        sections: [],
        sectionMapping: new Map()
      };

      await parser.parseContent(metadata, structure, 1, 1, 100);

      const createManyCalls = (prisma.line.createMany as jest.Mock).mock.calls[0][0].data;
      
      expect(createManyCalls[0]).toMatchObject({
        speakerPrefix: 'THE COURT',
        speakerType: 'COURT'
      });
      
      expect(createManyCalls[1]).toMatchObject({
        speakerPrefix: 'MR. DOE',
        speakerType: 'ATTORNEY'
      });
      
      expect(createManyCalls[2]).toMatchObject({
        speakerPrefix: 'MS. SMITH',
        speakerType: 'ATTORNEY'
      });
    });
  });
});