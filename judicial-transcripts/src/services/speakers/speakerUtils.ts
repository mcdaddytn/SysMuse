/**
 * Utility functions for consistent speaker handle generation
 * These ensure that speakers created during parsing can be matched
 * to reference data in Attorney and Judge tables
 */

export function generateSpeakerHandle(name: string): string {
  // Generate consistent handle from name
  // e.g., "MR. JOHN SMITH" -> "MR_JOHN_SMITH"
  return name.replace(/[^A-Z0-9\s]/g, '')  // Remove special chars except spaces
    .trim()
    .replace(/\s+/g, '_')  // Replace spaces with underscores
    .toUpperCase();
}

export function generateSpeakerPrefix(name: string, speakerPrefix?: string): string {
  if (speakerPrefix) {
    return speakerPrefix;
  }
  
  // Extract the prefix from the name (e.g., "MR. SMITH" from "MR. JOHN SMITH")
  const parts = name.split(' ');
  if (parts.length >= 2) {
    // Check if first part is a title
    const titles = ['MR.', 'MS.', 'MRS.', 'DR.', 'JUDGE', 'THE', 'HON.'];
    if (titles.includes(parts[0].toUpperCase())) {
      // Return title + last name
      const lastName = parts[parts.length - 1];
      return `${parts[0]} ${lastName}`.toUpperCase();
    }
  }
  
  // Default to the full name
  return name.toUpperCase();
}

export function matchAttorneyToSpeaker(
  attorneyName: string,
  speakerHandle: string
): boolean {
  // Check if an attorney matches a speaker handle
  const attorneyHandle = generateSpeakerHandle(attorneyName);
  return attorneyHandle === speakerHandle;
}