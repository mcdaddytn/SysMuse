/**
 * Quick portfolio breakdown analysis
 */
import * as fs from 'fs';

// Affiliate mapping - normalize assignee names to parent company
const AFFILIATE_MAP: Record<string, string> = {
  // Broadcom core
  'Broadcom Inc.': 'Broadcom',
  'Broadcom Corporation': 'Broadcom',
  'Broadcom Corp.': 'Broadcom',

  // Avago
  'Avago Technologies International Sales Pte. Limited': 'Avago',
  'Avago Technologies General IP (Singapore) Pte. Ltd.': 'Avago',
  'Avago Technologies Limited': 'Avago',
  'Avago Technologies U.S. Inc.': 'Avago',
  'Avago Technologies': 'Avago',
  'Avago Technologies Fiber IP (Singapore) Pte. Ltd.': 'Avago',

  // LSI
  'LSI Corporation': 'LSI',
  'LSI Logic Corporation': 'LSI',
  'LSI Logic': 'LSI',

  // Brocade
  'Brocade Communications Systems': 'Brocade',
  'Brocade Communications Systems, Inc.': 'Brocade',
  'Brocade': 'Brocade',

  // CA
  'CA': 'CA Technologies',
  'CA, Inc.': 'CA Technologies',
  'CA Technologies': 'CA Technologies',
  'Computer Associates International': 'CA Technologies',
  'Computer Associates': 'CA Technologies',

  // Symantec
  'Symantec Corporation': 'Symantec',
  'Symantec Operating Corporation': 'Symantec',
  'Blue Coat Systems': 'Symantec',
  'Blue Coat Systems, Inc.': 'Symantec',

  // VMware family
  'VMware LLC': 'VMware',
  'VMware': 'VMware',
  'VMware, Inc.': 'VMware',
  'VMware International Limited': 'VMware',

  // VMware acquisitions
  'Nicira': 'Nicira (VMware)',
  'Nicira, Inc.': 'Nicira (VMware)',
  'Nicira Inc.': 'Nicira (VMware)',
  'Avi Networks': 'Avi Networks (VMware)',
  'Lastline': 'Lastline (VMware)',
  'Lastline, Inc.': 'Lastline (VMware)',
  'Pivotal Software': 'Pivotal (VMware)',
  'Pivotal Software, Inc.': 'Pivotal (VMware)',
  'PIVOTAL SOFTWARE, INC.': 'Pivotal (VMware)',
  'Carbon Black': 'Carbon Black (VMware)',
  'Carbon Black, Inc.': 'Carbon Black (VMware)',
  'Nyansa': 'Nyansa (VMware)',
  'NYANSA': 'Nyansa (VMware)',
};

function getAffiliate(assignee: string): string {
  if (AFFILIATE_MAP[assignee]) return AFFILIATE_MAP[assignee];

  // Try partial matches
  for (const [key, value] of Object.entries(AFFILIATE_MAP)) {
    if (assignee.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }

  return assignee.split(',')[0].trim();
}

function getExpirationBucket(remainingYears: number): string {
  if (remainingYears <= 0) return 'Expired';
  if (remainingYears <= 2) return '0-2 years';
  if (remainingYears <= 5) return '2-5 years';
  if (remainingYears <= 10) return '5-10 years';
  if (remainingYears <= 15) return '10-15 years';
  return '15-20 years';
}

const data = JSON.parse(fs.readFileSync('output/streaming-candidates-2026-01-24.json', 'utf-8'));
const candidates = data.candidates;

console.log('═'.repeat(70));
console.log('PORTFOLIO ANALYSIS - Patents by Affiliate and Expiration');
console.log('═'.repeat(70));
console.log('Total patents: ' + candidates.length.toLocaleString());

const affiliateCounts = new Map<string, { total: number; active: number; expired: number }>();
const expirationCounts = new Map<string, number>();

for (const patent of candidates) {
  const affiliate = getAffiliate(patent.assignee);
  const bucket = getExpirationBucket(patent.remaining_years);

  if (!affiliateCounts.has(affiliate)) {
    affiliateCounts.set(affiliate, { total: 0, active: 0, expired: 0 });
  }
  const ac = affiliateCounts.get(affiliate)!;
  ac.total++;
  if (patent.remaining_years > 0) {
    ac.active++;
  } else {
    ac.expired++;
  }

  expirationCounts.set(bucket, (expirationCounts.get(bucket) || 0) + 1);
}

console.log('\n' + '─'.repeat(70));
console.log('BY AFFILIATE (Normalized Company)');
console.log('─'.repeat(70));
console.log('Affiliate'.padEnd(30) + 'Total'.padStart(8) + 'Active'.padStart(8) + 'Expired'.padStart(8));
console.log('─'.repeat(70));

const sortedAffiliates = [...affiliateCounts.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [affiliate, counts] of sortedAffiliates) {
  console.log(affiliate.padEnd(30) + counts.total.toLocaleString().padStart(8) + counts.active.toLocaleString().padStart(8) + counts.expired.toLocaleString().padStart(8));
}

console.log('\n' + '─'.repeat(70));
console.log('BY EXPIRATION PERIOD');
console.log('─'.repeat(70));
const bucketOrder = ['Expired', '0-2 years', '2-5 years', '5-10 years', '10-15 years', '15-20 years'];
let activeTotal = 0;
for (const bucket of bucketOrder) {
  const count = expirationCounts.get(bucket) || 0;
  const pct = ((count / candidates.length) * 100).toFixed(1);
  console.log(bucket.padEnd(15) + count.toLocaleString().padStart(8) + ' (' + pct + '%)');
  if (bucket !== 'Expired') activeTotal += count;
}
console.log('─'.repeat(70));
console.log('ACTIVE TOTAL'.padEnd(15) + activeTotal.toLocaleString().padStart(8) + ' (' + ((activeTotal / candidates.length) * 100).toFixed(1) + '%)');

// VMware family breakdown
console.log('\n' + '─'.repeat(70));
console.log('VMware FAMILY BREAKDOWN (acquired Nov 2023)');
console.log('─'.repeat(70));
const vmwareFamily = ['VMware', 'Nicira (VMware)', 'Pivotal (VMware)', 'Carbon Black (VMware)', 'Avi Networks (VMware)', 'Lastline (VMware)', 'Nyansa (VMware)'];
let vmwareTotal = 0;
for (const name of vmwareFamily) {
  const counts = affiliateCounts.get(name);
  if (counts) {
    console.log(name.padEnd(25) + counts.total.toLocaleString().padStart(8));
    vmwareTotal += counts.total;
  }
}
console.log('─'.repeat(70));
console.log('VMware FAMILY TOTAL'.padEnd(25) + vmwareTotal.toLocaleString().padStart(8));

console.log('\n' + '═'.repeat(70));
console.log('DISCREPANCY ANALYSIS');
console.log('═'.repeat(70));
console.log('Current count:      39,413 patents');
console.log('Previous estimate:  ~27,000 patents');
console.log('Difference:         ~12,400 patents (+46%)');
console.log('\nVMware family adds: ' + vmwareTotal.toLocaleString() + ' patents');
console.log('  → This likely explains the discrepancy');
console.log('  → VMware acquisition (Nov 2023) brought large portfolio');
