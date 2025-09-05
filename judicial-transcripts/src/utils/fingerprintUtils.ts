/**
 * Fingerprint generation utilities for entity matching and upsert operations
 */

/**
 * Generate fingerprint for person entities (Attorney, Judge, CourtReporter, Witness)
 * Format: lastName_firstName (lowercase, underscore-separated)
 */
export function generatePersonFingerprint(
  lastName: string | null | undefined,
  firstName: string | null | undefined
): string | null {
  if (!lastName || !firstName) {
    return null;
  }
  
  const cleanLast = lastName.toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
    
  const cleanFirst = firstName.toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  if (!cleanLast || !cleanFirst) {
    return null;
  }
  
  return `${cleanLast}_${cleanFirst}`;
}

/**
 * Generate fingerprint for LawFirm entities
 * Format: normalized firm name (lowercase, common suffixes removed)
 */
export function generateLawFirmFingerprint(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }
  
  // Common law firm suffixes to remove
  const suffixes = [
    'llp', 'l.l.p.', 'pllc', 'p.l.l.c.', 'pc', 'p.c.',
    'llc', 'l.l.c.', 'pa', 'p.a.', 'inc', 'incorporated',
    'ltd', 'limited', 'pllp', 'p.l.l.p.', 'lpa', 'l.p.a.',
    'professional corporation', 'professional association',
    'attorneys at law', 'attorneys', 'law firm', 'law offices',
    'law office', 'legal', '& associates', 'and associates'
  ];
  
  let normalized = name.toLowerCase();
  
  // Remove common suffixes
  suffixes.forEach(suffix => {
    const regex = new RegExp(`\\b${suffix.replace(/\./g, '\\.')}\\b`, 'gi');
    normalized = normalized.replace(regex, '');
  });
  
  // Clean and normalize
  normalized = normalized
    .replace(/[&,]/g, 'and')  // Replace & and , with 'and'
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  return normalized || null;
}

/**
 * Generate fingerprint for LawFirmOffice entities
 * Format: firmFingerprint_city (lowercase, underscore-separated)
 */
export function generateLawFirmOfficeFingerprint(
  firmFingerprint: string | null | undefined,
  city: string | null | undefined
): string | null {
  if (!firmFingerprint || !city) {
    return null;
  }
  
  const cleanCity = city.toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  if (!cleanCity) {
    return null;
  }
  
  return `${firmFingerprint}_${cleanCity}`;
}

/**
 * Generate fingerprint from full name (for entities without separate first/last)
 * Attempts to parse first and last name from full name
 */
export function generatePersonFingerprintFromName(fullName: string | null | undefined): string | null {
  if (!fullName) {
    return null;
  }
  
  // Remove common titles and honorifics
  const titles = [
    'mr\\.?', 'ms\\.?', 'mrs\\.?', 'dr\\.?', 'prof\\.?',
    'judge', 'justice', 'the honorable', 'honorable',
    'attorney', 'counselor', 'esquire', 'esq\\.?'
  ];
  
  let cleanName = fullName.toLowerCase();
  titles.forEach(title => {
    const regex = new RegExp(`\\b${title}\\b`, 'gi');
    cleanName = cleanName.replace(regex, '');
  });
  
  // Remove suffixes (Jr., III, etc.)
  cleanName = cleanName.replace(/\b(jr\.?|sr\.?|i{1,3}|iv|v|vi{0,3})\b/gi, '');
  
  // Split into parts
  const parts = cleanName.trim().split(/\s+/);
  
  if (parts.length < 2) {
    // Can't generate fingerprint without at least first and last name
    return null;
  }
  
  // Assume first part is first name, last part is last name
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  
  return generatePersonFingerprint(lastName, firstName);
}

/**
 * Generate fingerprints for all applicable fields in an entity
 */
export function generateEntityFingerprints(entityType: string, entity: any): any {
  const result = { ...entity };
  
  switch (entityType) {
    case 'Attorney':
    case 'Judge':
    case 'CourtReporter':
    case 'Witness':
      const fingerprintField = `${entityType.toLowerCase()}Fingerprint`;
      if (entity.lastName && entity.firstName) {
        result[fingerprintField] = generatePersonFingerprint(entity.lastName, entity.firstName);
      } else if (entity.name) {
        result[fingerprintField] = generatePersonFingerprintFromName(entity.name);
      }
      break;
      
    case 'LawFirm':
      if (entity.name) {
        result.lawFirmFingerprint = generateLawFirmFingerprint(entity.name);
      }
      break;
      
    case 'LawFirmOffice':
      // Need to get the firm fingerprint from the related LawFirm
      // This would be handled in the importer with access to the full data
      break;
  }
  
  return result;
}

/**
 * Extract first and last name from a full name string
 */
export function extractNameParts(fullName: string): {
  firstName: string | null;
  lastName: string | null;
  middleInitial: string | null;
} {
  if (!fullName) {
    return { firstName: null, lastName: null, middleInitial: null };
  }
  
  // Remove titles and honorifics
  let cleanName = fullName.replace(/^(MR\.|MS\.|MRS\.|DR\.|JUDGE|THE HONORABLE)\s+/i, '');
  
  // Remove suffixes
  cleanName = cleanName.replace(/\s+(JR\.?|SR\.?|III|II|IV|V)$/i, '');
  
  const parts = cleanName.trim().split(/\s+/);
  
  if (parts.length === 0) {
    return { firstName: null, lastName: null, middleInitial: null };
  }
  
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null, middleInitial: null };
  }
  
  if (parts.length === 2) {
    return { firstName: parts[0], lastName: parts[1], middleInitial: null };
  }
  
  // 3 or more parts - assume first, middle initial(s), last
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  
  // Check if middle part looks like an initial
  const middlePart = parts[1];
  const middleInitial = middlePart.length <= 2 ? middlePart.replace(/\./g, '') : null;
  
  return { firstName, lastName, middleInitial };
}