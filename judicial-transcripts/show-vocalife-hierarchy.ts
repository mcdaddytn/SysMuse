import { PrismaClient, MarkerSectionType } from '@prisma/client';

const prisma = new PrismaClient();

async function showVocalifeHierarchy() {
  console.log('\n' + '='.repeat(80));
  console.log('VOCALIFE v. AMAZON - TRIAL HIERARCHY');
  console.log('='.repeat(80) + '\n');
  
  // Get root TRIAL section
  const trialSection = await prisma.markerSection.findFirst({
    where: {
      trialId: 49,
      markerSectionType: MarkerSectionType.TRIAL
    }
  });
  
  if (!trialSection) {
    console.log('No hierarchy found for trial 49');
    await prisma.$disconnect();
    return;
  }
  
  // Get all sections
  const sections = await prisma.markerSection.findMany({
    where: { trialId: 49 },
    orderBy: { startEventId: 'asc' }
  });
  
  // Build hierarchy
  const sectionMap = new Map();
  sections.forEach(s => {
    sectionMap.set(s.id, {...s, children: []});
  });
  
  sections.forEach(s => {
    if (s.parentSectionId) {
      const parent = sectionMap.get(s.parentSectionId);
      if (parent) {
        parent.children.push(sectionMap.get(s.id));
      }
    }
  });
  
  // Print hierarchy
  function printSection(section: any, indent = '') {
    const eventRange = section.startEventId && section.endEventId 
      ? ` [${section.startEventId}-${section.endEventId}]`
      : '';
    console.log(`${indent}${section.markerSectionType}: ${section.name}${eventRange}`);
    
    // Only show major sections and first level children
    if (indent === '' || indent === '  ') {
      section.children.forEach((child: any) => {
        if (child.markerSectionType !== 'WITNESS_EXAMINATION') {
          printSection(child, indent + '  ');
        }
      });
      
      // Count witness examinations
      const examCount = section.children.filter((c: any) => 
        c.markerSectionType === 'WITNESS_EXAMINATION'
      ).length;
      if (examCount > 0) {
        console.log(`${indent}  [${examCount} witness examinations]`);
      }
    }
  }
  
  printSection(sectionMap.get(trialSection.id));
  
  // Show statistics
  console.log('\n' + '='.repeat(80));
  console.log('STATISTICS');
  console.log('='.repeat(80) + '\n');
  
  const stats = new Map();
  sections.forEach(s => {
    stats.set(s.markerSectionType, (stats.get(s.markerSectionType) || 0) + 1);
  });
  
  console.log('Section counts:');
  stats.forEach((count, type) => {
    console.log(`  ${type}: ${count}`);
  });
  
  await prisma.$disconnect();
}

showVocalifeHierarchy();