import * as fs from 'fs';
const data = JSON.parse(fs.readFileSync('output/streaming-candidates-2026-01-24.json', 'utf-8'));
const patents = data.candidates;

// Find duplicates and their assignees
const idToPatents = new Map<string, any[]>();
patents.forEach((p: any) => {
  const existing = idToPatents.get(p.patent_id);
  if (existing) {
    existing.push(p);
  } else {
    idToPatents.set(p.patent_id, [p]);
  }
});

// Get patents with multiple entries
const duplicates = [...idToPatents.entries()].filter(([id, list]) => list.length > 1);
console.log('Patents appearing multiple times:', duplicates.length);

// Sample some duplicates
console.log('\nSample duplicates (patent_id -> assignees):');
duplicates.slice(0, 10).forEach(([id, list]) => {
  const assignees = list.map((p: any) => p.assignee);
  console.log('  ' + id + ':');
  assignees.forEach((a: string) => console.log('    - ' + a));
});

// Count duplicate frequency
const dupCounts = new Map<number, number>();
duplicates.forEach(([id, list]) => {
  const count = list.length;
  dupCounts.set(count, (dupCounts.get(count) || 0) + 1);
});
console.log('\nDuplicate frequency:');
[...dupCounts.entries()].sort((a,b) => a[0] - b[0]).forEach(([count, freq]) => {
  console.log('  Patents appearing ' + count + ' times: ' + freq);
});

// Check if duplicates have different assignees
let sameAssignee = 0;
let diffAssignee = 0;
duplicates.forEach(([id, list]) => {
  const assignees = new Set(list.map((p: any) => p.assignee));
  if (assignees.size === 1) {
    sameAssignee++;
  } else {
    diffAssignee++;
  }
});
console.log('\nDuplicates with same assignee:', sameAssignee);
console.log('Duplicates with different assignees:', diffAssignee);
