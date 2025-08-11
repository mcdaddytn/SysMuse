function parseFullName(fullName: string): {
  firstName?: string;
  middleInitial?: string;
  lastName: string;
  suffix?: string;
} {
  // First check for comma-separated suffix (e.g., "RUBINO, III")
  let mainName = fullName.trim();
  let suffix: string | undefined;
  
  const commaMatch = fullName.match(/^(.+?),\s*([IVX]+|Jr\.?|Sr\.?|ESQ\.?|Ph\.?D\.?|M\.?D\.?)$/i);
  if (commaMatch) {
    mainName = commaMatch[1].trim();
    suffix = commaMatch[2].trim();
  }
  
  // Clean up and split the main name
  const cleanName = mainName.replace(/\s+/g, ' ');
  const parts = cleanName.split(/\s+/);
  
  // Check for suffixes at the end of the name (if not already found via comma)
  if (!suffix) {
    const suffixes = ['III', 'II', 'IV', 'JR', 'JR.', 'SR', 'SR.', 'ESQ', 'ESQ.', 'PHD', 'PH.D.', 'MD', 'M.D.'];
    const lastPart = parts[parts.length - 1].toUpperCase().replace(/\./g, '');
    if (suffixes.includes(lastPart)) {
      suffix = parts[parts.length - 1];
      parts.pop(); // Remove suffix from parts
    }
  }
  
  let nameParts = [...parts];
  
  // Now parse the remaining name parts
  if (nameParts.length === 0) {
    return { lastName: fullName }; // Fallback
  } else if (nameParts.length === 1) {
    return { lastName: nameParts[0], suffix };
  } else if (nameParts.length === 2) {
    return { 
      firstName: nameParts[0], 
      lastName: nameParts[1], 
      suffix 
    };
  } else {
    // 3 or more parts - assume middle initial(s)
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    const middleInitial = nameParts.slice(1, -1).join(' ');
    return { firstName, middleInitial, lastName, suffix };
  }
}

// Test cases
const testNames = [
  "VINCENT J. RUBINO, III",
  "JOSEPH C. MCALEXANDER, III",
  "KENDALL M. LOEBBAKA",
  "ALAN G. LAQUER"
];

testNames.forEach(name => {
  const parsed = parseFullName(name);
  console.log(`\nInput: "${name}"`);
  console.log(`  firstName: ${parsed.firstName}`);
  console.log(`  middleInitial: ${parsed.middleInitial}`);
  console.log(`  lastName: ${parsed.lastName}`);
  console.log(`  suffix: ${parsed.suffix}`);
});