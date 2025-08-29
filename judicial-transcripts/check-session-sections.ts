import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSessionSections() {
  try {
    // Count total SessionSections
    const totalSections = await prisma.sessionSection.count();
    console.log(`Total SessionSections in database: ${totalSections}`);
    
    // Get sample of sections by type
    const sectionTypes = await prisma.sessionSection.groupBy({
      by: ['sectionType'],
      _count: {
        sectionType: true
      }
    });
    
    console.log('\nSection types and counts:');
    sectionTypes.forEach(type => {
      console.log(`  ${type.sectionType}: ${type._count.sectionType}`);
    });
    
    // Get a few sample sections
    const samples = await prisma.sessionSection.findMany({
      take: 5,
      include: {
        session: {
          select: {
            fileName: true,
            sessionDate: true,
            sessionType: true
          }
        }
      }
    });
    
    console.log('\nSample sections:');
    samples.forEach(section => {
      console.log(`\n  Session: ${section.session.fileName}`);
      console.log(`  Type: ${section.sectionType}`);
      console.log(`  Order: ${section.orderIndex}`);
      console.log(`  Text preview: ${section.sectionText.substring(0, 100)}...`);
      if (section.metadata) {
        console.log(`  Metadata: ${JSON.stringify(section.metadata, null, 2).substring(0, 200)}...`);
      }
    });
    
    // Check for CERTIFICATION sections specifically
    const certSections = await prisma.sessionSection.count({
      where: {
        sectionType: 'CERTIFICATION'
      }
    });
    console.log(`\nCERTIFICATION sections found: ${certSections}`);
    
  } catch (error) {
    console.error('Error checking SessionSections:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSessionSections();