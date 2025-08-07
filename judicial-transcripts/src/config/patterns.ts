// src/config/patterns.ts
import { LinePattern, CourtDirectivePattern, ObjectionPattern, SpeakerPattern } from '../types/patterns.types';

// Regular expressions for parsing transcript lines
export const LINE_PATTERNS: LinePattern[] = [
  {
    // Matches lines with timestamp, line number, and content
    // e.g., "10:21:00   25               MR. HADDEN:   Pass the witness."
    pattern: /^(\d{2}:\d{2}:\d{2})\s+(\d+)\s+(.*?)$/,
    type: 'timestamp',
    extract: (match) => ({
      timestamp: match[1],
      lineNumber: parseInt(match[2]),
      text: match[3].trim()
    })
  },
  {
    // Matches Q. and A. prefixes for witness testimony
    pattern: /^\s*(Q\.|A\.)\s+(.*)$/,
    type: 'speaker',
    extract: (match) => ({
      prefix: match[1],
      text: match[2]
    })
  },
  {
    // Matches speaker identifications
    // e.g., "THE COURT:", "MR. FABRICANT:", "MS. DOAN:"
    pattern: /^\s*(THE COURT|MR\.|MS\.|MRS\.|DR\.)\s+([A-Z][A-Z\s]+?):\s*(.*)$/,
    type: 'speaker',
    extract: (match) => ({
      title: match[1],
      name: match[2].trim(),
      text: match[3]
    })
  },
  {
    // Matches court directives in parentheses
    pattern: /^\s*\((.*?)\)\s*$/,
    type: 'directive',
    extract: (match) => ({
      directive: match[1]
    })
  },
  {
    // Matches witness examination headers
    pattern: /^\s*(DIRECT|CROSS|REDIRECT|RECROSS)\s+EXAMINATION\s*(CONTINUED)?$/i,
    type: 'examination_type',
    extract: (match) => ({
      type: match[1].toUpperCase(),
      continued: !!match[2]
    })
  }
];

// Standard court directives
export const COURT_DIRECTIVES: CourtDirectivePattern[] = [
  // Paired directives
  { id: 'jury_in', name: 'Jury in.', patterns: ['Jury in.', 'Jury in'], isPaired: true, pairMateId: 'jury_out', isStart: true },
  { id: 'jury_out', name: 'Jury out.', patterns: ['Jury out.', 'Jury out'], isPaired: true, pairMateId: 'jury_in', isStart: false },
  { id: 'video_start', name: 'Videoclip played.', patterns: ['Videoclip played.', 'Videoclip starts.'], isPaired: true, pairMateId: 'video_end', isStart: true },
  { id: 'video_end', name: 'Videoclip ends.', patterns: ['Videoclip ends.', 'Videoclip stops.'], isPaired: true, pairMateId: 'video_start', isStart: false },
  { id: 'sealed_start', name: 'Courtroom sealed.', patterns: ['Courtroom sealed.'], isPaired: true, pairMateId: 'sealed_end', isStart: true },
  { id: 'sealed_end', name: 'Courtroom unsealed.', patterns: ['Courtroom unsealed.'], isPaired: true, pairMateId: 'sealed_start', isStart: false },
  
  // Unpaired directives
  { id: 'recess', name: 'Recess.', patterns: ['Recess.', 'Recess'], isPaired: false },
  { id: 'witness_sworn', name: 'Witness sworn.', patterns: ['Witness sworn.'], isPaired: false },
  { id: 'court_bench', name: 'The Court on the Bench - Open Court.', patterns: ['The Court on the Bench - Open Court.'], isPaired: false },
  { id: 'conference_concluded', name: 'Conference concluded in jury room.', patterns: ['Conference concluded in jury room.'], isPaired: false },
  { id: 'venire_in', name: 'Venire panel in.', patterns: ['Venire panel in.'], isPaired: false },
  { id: 'venire_out', name: 'Unselected venire panel members out.', patterns: ['Unselected venire panel members out.'], isPaired: false },
  { id: 'juror_brought', name: 'Juror brought into the jury room.', patterns: ['Juror brought into the jury room.'], isPaired: false },
  { id: 'juror_excused', name: 'Juror excused to return to the courtroom.', patterns: ['Juror excused to return to the courtroom.'], isPaired: false }
];

// Objection patterns for ElasticSearch marking
export const OBJECTION_PATTERNS: ObjectionPattern[] = [
  // Start patterns
  { type: 'start', patterns: ['Objection', 'I object', 'object'] },
  
  // End patterns with results
  { type: 'end', patterns: ['Overruled'], result: 'overruled' },
  { type: 'end', patterns: ['Sustained'], result: 'sustained' },
  { type: 'end', patterns: ["I'll allow it", 'Allowed'], result: 'allowed' }
];

// Speaker identification patterns
export const SPEAKER_PATTERNS: SpeakerPattern[] = [
  {
    pattern: /THE COURT/,
    type: 'judge',
    extractName: () => 'THE COURT'
  },
  {
    pattern: /COURT SECURITY OFFICER/,
    type: 'court_officer',
    extractName: () => 'COURT SECURITY OFFICER'
  },
  {
    pattern: /(MR\.|MS\.|MRS\.)\s+([A-Z][A-Z\s]+?):/,
    type: 'attorney',
    extractName: (match) => `${match[1]} ${match[2].trim()}`
  },
  {
    pattern: /^(Q\.|A\.)/,
    type: 'witness',
    extractName: (match) => match[1] === 'Q.' ? 'Examining Attorney' : 'Witness'
  }
];