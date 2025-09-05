/**
 * Utility functions for consistent speaker handle generation
 * These ensure that speakers created during parsing can be matched
 * to reference data in Attorney and Judge tables
 */

export function generateSpeakerHandle(name: string): string {
  // Generate consistent handle from name
  // e.g., "MR. JOHN SMITH" -> "MR_JOHN_SMITH"
  // First uppercase the name to ensure consistency
  const upperName = name.toUpperCase();
  
  return upperName
    .replace(/[^A-Z0-9\s]/g, '')  // Remove special chars except spaces
    .trim()
    .replace(/\s+/g, '_');  // Replace spaces with underscores
}

export function generateSpeakerPrefix(name: string, speakerPrefix?: string): string {
  if (speakerPrefix) {
    // Ensure speaker prefix is uppercase
    return speakerPrefix.toUpperCase();
  }
  
  // Normalize the name - uppercase it first
  const upperName = name.toUpperCase();
  
  // Extract the prefix from the name (e.g., "MR. SMITH" from "MR. JOHN SMITH")
  const parts = upperName.split(' ');
  if (parts.length >= 2) {
    // Check if first part is a title
    const titles = ['MR.', 'MS.', 'MRS.', 'DR.', 'JUDGE', 'THE', 'HON.'];
    const firstPart = parts[0].replace(/\./g, '') + '.'; // Normalize title with period
    
    if (titles.includes(firstPart) || titles.includes(parts[0])) {
      // Return title + last name
      const lastName = parts[parts.length - 1];
      // Ensure title has proper format (with period)
      let title = parts[0];
      if (!title.endsWith('.') && ['MR', 'MS', 'MRS', 'DR'].includes(title)) {
        title += '.';
      }
      return `${title} ${lastName}`;
    }
  }
  
  // Default to the full name in uppercase
  return upperName;
}

export function matchAttorneyToSpeaker(
  attorneyName: string,
  speakerHandle: string
): boolean {
  // Check if an attorney matches a speaker handle
  const attorneyHandle = generateSpeakerHandle(attorneyName);
  return attorneyHandle === speakerHandle;
}