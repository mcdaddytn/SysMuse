// src/__tests__/parsers/LineParser.test.ts
// src/tests/LineParser.test.ts
import { LineParser } from '../parsers/LineParser';

describe('LineParser', () => {
  let parser: LineParser;
  
  beforeEach(() => {
    parser = new LineParser();
  });
  
  describe('parse', () => {
    it('should parse timestamp lines correctly', () => {
      const line = '10:21:00   25               MR. HADDEN:   Pass the witness.';
      const result = parser.parse(line);
      
      expect(result).not.toBeNull();
      expect(result?.timestamp).toBe('10:21:00');
      expect(result?.lineNumber).toBe(25);
      expect(result?.speakerPrefix).toBe('MR. HADDEN:');
      expect(result?.text).toContain('Pass the witness');
      expect(result?.isBlank).toBe(false);
    });
    
    it('should parse Q/A lines correctly', () => {
      const lineQ = 'Q.   Did you review the patent?';
      const resultQ = parser.parse(lineQ);
      
      expect(resultQ?.speakerPrefix).toBe('Q.');
      expect(resultQ?.text).toBe('Did you review the patent?');
      
      const lineA = 'A.   Yes, I did.';
      const resultA = parser.parse(lineA);
      
      expect(resultA?.speakerPrefix).toBe('A.');
      expect(resultA?.text).toBe('Yes, I did.');
    });
    
    it('should identify blank lines', () => {
      const result = parser.parse('');
      
      expect(result).not.toBeNull();
      expect(result?.isBlank).toBe(true);
    });
    
    it('should detect court directives', () => {
      const line = '(Jury out.)';
      
      expect(parser.isCourtDirective(line)).toBe(true);
      expect(parser.extractDirective(line)).toBe('Jury out.');
    });
    
    it('should identify speaker lines', () => {
      expect(parser.isSpeakerLine('THE COURT: Please proceed.')).toBe(true);
      expect(parser.isSpeakerLine('MR. FABRICANT: Thank you.')).toBe(true);
      expect(parser.isSpeakerLine('Q. Your name?')).toBe(true);
      expect(parser.isSpeakerLine('Just regular text')).toBe(false);
    });
  });
});

