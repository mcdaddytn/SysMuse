import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const trials = await prisma.trial.findMany({
    include: {
      sessions: {
        include: {
          sessionSections: {
            where: {
              sectionType: 'SUMMARY'
            }
          }
        }
      }
    }
  });
  
  console.log('Batch 2: Trial Results Summary');
  console.log('==============================');
  
  for (const trial of trials) {
    console.log('');
    console.log('Trial: ' + trial.name);
    console.log('Sessions: ' + trial.sessions.length);
    console.log('Plaintiff: ' + (trial.plaintiff || 'N/A'));
    console.log('Defendant: ' + (trial.defendant || 'N/A'));
    
    const totalSections = trial.sessions.reduce((sum: number, s: any) => sum + s.sessionSections.length, 0);
    console.log('Summary Sections: ' + totalSections);
    
    const issues: string[] = [];
    if (trial.plaintiff && trial.plaintiff.includes('*')) issues.push('asterisk in plaintiff');
    if (trial.plaintiff && trial.plaintiff.includes('VS.')) issues.push('VS. in plaintiff');
    if (trial.plaintiff && trial.plaintiff.includes('()')) issues.push('parentheses artifacts');
    if (!trial.defendant || trial.defendant === '') issues.push('missing defendant');
    
    if (issues.length > 0) {
      console.log('Issues: ' + issues.join(', '));
    }
  }
  
  console.log('');
  console.log('Overall Statistics:');
  const totalTrials = trials.length;
  const totalSessions = trials.reduce((sum: number, t: any) => sum + t.sessions.length, 0);
  const cleanTrials = trials.filter((t: any) => {
    const hasIssue = (t.plaintiff && (t.plaintiff.includes('*') || t.plaintiff.includes('VS.') || t.plaintiff.includes('()'))) || 
                      !t.defendant || t.defendant === '';
    return !hasIssue;
  }).length;
  
  console.log('Total Trials: ' + totalTrials);
  console.log('Total Sessions: ' + totalSessions);
  const percentage = Math.round(cleanTrials * 100 / totalTrials);
  console.log('Clean Extraction: ' + cleanTrials + '/' + totalTrials + ' (' + percentage + '%)');
}

main().catch(console.error).finally(() => prisma.$disconnect());