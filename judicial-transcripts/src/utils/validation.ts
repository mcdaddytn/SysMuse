// src/utils/validation.ts
export class Validators {
  /**
   * Validate case number format
   */
  static isValidCaseNumber(caseNumber: string): boolean {
    // Format: 2:19-CV-123-JRG
    const pattern = /^\d+:\d{2}-[A-Z]{2}-\d+-[A-Z]+$/;
    return pattern.test(caseNumber);
  }
  
  /**
   * Validate timestamp format
   */
  static isValidTimestamp(timestamp: string): boolean {
    // Format: HH:MM:SS
    const pattern = /^\d{2}:\d{2}:\d{2}$/;
    if (!pattern.test(timestamp)) return false;
    
    const [hours, minutes, seconds] = timestamp.split(':').map(Number);
    return hours < 24 && minutes < 60 && seconds < 60;
  }
  
  /**
   * Validate attorney name format
   */
  static isValidAttorneyName(name: string): boolean {
    // Format: MR./MS./MRS./DR. FIRSTNAME LASTNAME
    const pattern = /^(MR\.|MS\.|MRS\.|DR\.)\s+[A-Z][A-Z\s\.]+$/;
    return pattern.test(name);
  }
  
  /**
   * Validate session type
   */
  static isValidSessionType(type: string): boolean {
    const validTypes = ['MORNING', 'AFTERNOON', 'SPECIAL', 'BENCH_TRIAL', 'JURY_VERDICT', 'OTHER'];
    return validTypes.includes(type);
  }
}
