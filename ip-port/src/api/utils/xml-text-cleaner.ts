/**
 * XML Text Cleaner Utility
 *
 * Decodes XML entities and cleans text extracted from XML files.
 * Used for CPC codes, patent full text, and other XML sources.
 */

/**
 * Common XML entities and their decoded values
 */
const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#160;': ' ',    // Non-breaking space (decimal)
  '&#xA0;': ' ',    // Non-breaking space (hex)
  '&#32;': ' ',     // Space
  '&#39;': "'",     // Apostrophe
  '&#34;': '"',     // Quote
  '&#8211;': '–',   // En dash
  '&#8212;': '—',   // Em dash
  '&#8216;': "'",   // Left single quote
  '&#8217;': "'",   // Right single quote
  '&#8220;': '"',   // Left double quote
  '&#8221;': '"',   // Right double quote
  '&#8230;': '...',   // Ellipsis
  '&#174;': '®',    // Registered trademark
  '&#169;': '©',    // Copyright
  '&#8482;': '™',   // Trademark
};

/**
 * Decode numeric XML entities (both decimal and hexadecimal)
 */
function decodeNumericEntity(entity: string): string {
  const match = entity.match(/^&#(x?)([0-9a-fA-F]+);$/);
  if (!match) return entity;

  const isHex = match[1] === 'x';
  const codePoint = parseInt(match[2], isHex ? 16 : 10);

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    // Invalid code point, return original
    return entity;
  }
}

/**
 * Decode all XML entities in a string
 */
export function decodeXmlEntities(text: string): string {
  if (!text) return '';

  // First replace known named entities
  let result = text;
  for (const [entity, replacement] of Object.entries(XML_ENTITIES)) {
    result = result.split(entity).join(replacement);
  }

  // Then decode any remaining numeric entities (&#NNN; or &#xHHH;)
  result = result.replace(/&#x?[0-9a-fA-F]+;/g, (match) => {
    return decodeNumericEntity(match);
  });

  return result;
}

/**
 * Clean text extracted from XML:
 * - Decode XML entities
 * - Remove HTML/XML tags
 * - Normalize whitespace
 * - Trim
 */
export function cleanXmlText(text: string): string {
  if (!text) return '';

  return decodeXmlEntities(text)
    .replace(/<[^>]+>/g, '')   // Remove HTML/XML tags
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
}

/**
 * Clean text but preserve some structure (paragraphs)
 * Useful for longer text like definitions
 */
export function cleanXmlTextPreserveStructure(text: string): string {
  if (!text) return '';

  return decodeXmlEntities(text)
    .replace(/<br\s*\/?>/gi, '\n')           // Convert <br> to newline
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')   // Convert </p><p> to double newline
    .replace(/<[^>]+>/g, '')                  // Remove remaining tags
    .replace(/[ \t]+/g, ' ')                  // Normalize horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')              // Max 2 newlines
    .trim();
}
