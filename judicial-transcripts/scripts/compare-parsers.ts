import * as fs from 'fs';
import * as path from 'path';

function loadJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function compareParsers() {
  const legacyDir = process.argv[2] || 'data-export-legacy-fixed';
  const multipassDir = process.argv[3] || 'data-export-multipass';

  // Compare statistics
  console.log('='.repeat(60));
  console.log('PARSER COMPARISON: Legacy vs Multi-pass');
  console.log('='.repeat(60));
  
  const legacyStats = loadJson(path.join(legacyDir, 'statistics.json'));
  const multiStats = loadJson(path.join(multipassDir, 'statistics.json'));
  
  console.log('\nSTATISTICS COMPARISON:');
  console.log('-'.repeat(60));
  console.log('Metric'.padEnd(25) + 'Legacy'.padStart(10) + 'Multi-pass'.padStart(12) + 'Difference'.padStart(12));
  console.log('-'.repeat(60));
  
  Object.keys(legacyStats).forEach(key => {
    const legacy = legacyStats[key];
    const multi = multiStats[key];
    const diff = multi - legacy;
    const diffStr = diff > 0 ? `+${diff}` : diff.toString();
    console.log(
      key.padEnd(25) +
      legacy.toString().padStart(10) +
      multi.toString().padStart(12) +
      diffStr.padStart(12)
    );
  });

  // Compare pages
  console.log('\n' + '='.repeat(60));
  console.log('PAGE COMPARISON:');
  console.log('-'.repeat(60));
  
  const legacyPages = loadJson(path.join(legacyDir, 'pages.json'));
  const multiPages = loadJson(path.join(multipassDir, 'pages.json'));
  
  // Group pages by session
  const legacyBySession: any = {};
  const multiBySession: any = {};
  
  legacyPages.forEach((p: any) => {
    const key = `${p.sessionDate}_${p.sessionType}`;
    if (!legacyBySession[key]) legacyBySession[key] = [];
    legacyBySession[key].push(p.pageNumber);
  });
  
  multiPages.forEach((p: any) => {
    const key = `${p.sessionDate}_${p.sessionType}`;
    if (!multiBySession[key]) multiBySession[key] = [];
    multiBySession[key].push(p.pageNumber);
  });
  
  console.log('Session'.padEnd(30) + 'Legacy Pages'.padStart(15) + 'Multi Pages'.padStart(15) + 'Missing'.padStart(10));
  console.log('-'.repeat(70));
  
  Object.keys(legacyBySession).forEach(session => {
    const legacyCount = legacyBySession[session].length;
    const multiCount = multiBySession[session]?.length || 0;
    const diff = legacyCount - multiCount;
    
    if (diff !== 0) {
      console.log(
        session.padEnd(30) +
        legacyCount.toString().padStart(15) +
        multiCount.toString().padStart(15) +
        diff.toString().padStart(10)
      );
      
      // Show which pages are missing
      if (diff > 0) {
        const legacySet = new Set(legacyBySession[session]);
        const multiSet = new Set(multiBySession[session] || []);
        const missing = [...legacySet].filter(p => !multiSet.has(p));
        console.log(`  Missing pages: ${missing.join(', ')}`);
      }
    }
  });

  // Compare line samples
  console.log('\n' + '='.repeat(60));
  console.log('LINE COMPARISON (first 100):');
  console.log('-'.repeat(60));
  
  const legacyLines = loadJson(path.join(legacyDir, 'lines-first-1000.json'));
  const multiLines = loadJson(path.join(multipassDir, 'lines-first-1000.json'));
  
  // Find differences in first 100 lines
  let differences = 0;
  for (let i = 0; i < Math.min(100, Math.min(legacyLines.length, multiLines.length)); i++) {
    const legacy = legacyLines[i];
    const multi = multiLines[i];
    
    if (legacy.text !== multi.text || legacy.speakerPrefix !== multi.speakerPrefix) {
      differences++;
      if (differences <= 5) {
        console.log(`\nLine ${legacy.lineNumber}:`);
        console.log(`  Legacy:    "${legacy.text?.substring(0, 60)}..." [${legacy.speakerPrefix || 'no speaker'}]`);
        console.log(`  Multipass: "${multi.text?.substring(0, 60)}..." [${multi.speakerPrefix || 'no speaker'}]`);
      }
    }
  }
  
  console.log(`\nTotal differences in first 100 lines: ${differences}`);

  // Compare statement events
  console.log('\n' + '='.repeat(60));
  console.log('STATEMENT EVENT COMPARISON:');
  console.log('-'.repeat(60));
  
  const legacyStatements = loadJson(path.join(legacyDir, 'statements-sample.json'));
  const multiStatements = loadJson(path.join(multipassDir, 'statements-sample.json'));
  
  // Analyze line counts per statement
  const legacyLineCounts = legacyStatements.map((s: any) => s.lineCount);
  const multiLineCounts = multiStatements.map((s: any) => s.lineCount);
  
  const avgLegacy = legacyLineCounts.reduce((a: number, b: number) => a + b, 0) / legacyLineCounts.length;
  const avgMulti = multiLineCounts.reduce((a: number, b: number) => a + b, 0) / multiLineCounts.length;
  
  console.log(`Average lines per statement:`);
  console.log(`  Legacy:     ${avgLegacy.toFixed(2)}`);
  console.log(`  Multi-pass: ${avgMulti.toFixed(2)}`);
  
  // Show distribution
  const distribution = (counts: number[]) => {
    const dist: any = {};
    counts.forEach(c => {
      const key = c === 0 ? '0' : c === 1 ? '1' : c <= 5 ? '2-5' : c <= 10 ? '6-10' : '11+';
      dist[key] = (dist[key] || 0) + 1;
    });
    return dist;
  };
  
  console.log('\nStatement line count distribution:');
  console.log('Lines'.padEnd(10) + 'Legacy'.padStart(10) + 'Multi-pass'.padStart(12));
  console.log('-'.repeat(32));
  
  const legacyDist = distribution(legacyLineCounts);
  const multiDist = distribution(multiLineCounts);
  
  ['0', '1', '2-5', '6-10', '11+'].forEach(key => {
    console.log(
      key.padEnd(10) +
      (legacyDist[key] || 0).toString().padStart(10) +
      (multiDist[key] || 0).toString().padStart(12)
    );
  });
}

compareParsers();