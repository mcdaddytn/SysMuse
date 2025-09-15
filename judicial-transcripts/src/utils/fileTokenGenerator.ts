/**
 * Generate a filesystem-safe token from any input string
 * Replaces characters that are not allowed in filenames on major operating systems
 */
export function generateFileToken(input: string): string {
  if (!input) {
    return '';
  }

  // Replace common problematic characters for filesystems
  // Windows: < > : " | ? * \ /
  // Unix/Linux: mainly / and null
  // macOS: : and /
  
  return input
    .replace(/\./g, '_')     // Period -> underscore (for filesystem safety)
    .replace(/:/g, '_')      // Colon -> underscore
    .replace(/\//g, '_')     // Forward slash -> underscore
    .replace(/\\/g, '_')     // Backslash -> underscore
    .replace(/\|/g, '_')     // Pipe -> underscore
    .replace(/\?/g, '_')     // Question mark -> underscore
    .replace(/\*/g, '_')     // Asterisk -> underscore
    .replace(/"/g, '')       // Remove quotes
    .replace(/</g, '_')      // Less than -> underscore
    .replace(/>/g, '_')      // Greater than -> underscore
    .replace(/\s+/g, '_')    // Spaces -> underscore
    .replace(/[^\w\-_]/g, '') // Remove any other non-word chars except dash, underscore
    .replace(/_+/g, '_')     // Collapse multiple underscores
    .replace(/^_|_$/g, '');  // Trim underscores from start/end
}

/**
 * Validate that a token is filesystem-safe
 */
export function isValidFileToken(token: string): boolean {
  // Check for any remaining problematic characters
  const invalidChars = /[<>:"|?*\\/\x00-\x1f]/;
  return !invalidChars.test(token) && token.length > 0 && token.length <= 255;
}

/**
 * Generate a case handle specifically for case numbers
 * (Wrapper for backwards compatibility and semantic clarity)
 */
export function generateCaseHandle(caseNumber: string): string {
  return generateFileToken(caseNumber);
}