#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { WitnessMarkerDiscovery } from '../phase3/WitnessMarkerDiscovery';

const prisma = new PrismaClient();

async function runWitnessDiscovery(trialId: number) {
  console.log(`\n🔍 Running Witness Marker Discovery for Trial ${trialId}\n`);
  
  const discovery = new WitnessMarkerDiscovery(prisma);
  
  try {
    // Check initial state
    const witnessesBefore = await prisma.witness.count({ where: { trialId } });
    const markersBefore = await prisma.marker.count({ where: { trialId } });
    const sectionsBefore = await prisma.markerSection.count({ where: { trialId } });
    
    console.log('Before processing:');
    console.log(`  Witnesses: ${witnessesBefore}`);
    console.log(`  Markers: ${markersBefore}`);
    console.log(`  Sections: ${sectionsBefore}\n`);
    
    // Run discovery
    const startTime = Date.now();
    await discovery.discoverWitnessMarkers(trialId);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Check results
    const markersAfter = await prisma.marker.count({ where: { trialId } });
    const sectionsAfter = await prisma.markerSection.count({ where: { trialId } });
    
    console.log('\nAfter processing:');
    console.log(`  Markers created: ${markersAfter - markersBefore}`);
    console.log(`  Sections created: ${sectionsAfter - sectionsBefore}`);
    console.log(`  Time elapsed: ${elapsed} seconds`);
    
    // Show breakdown by type
    if (markersAfter > markersBefore) {
      const markerTypes = await prisma.marker.groupBy({
        by: ['markerType'],
        where: { trialId },
        _count: { markerType: true }
      });
      
      console.log('\nMarker types created:');
      for (const type of markerTypes) {
        console.log(`  ${type.markerType}: ${type._count.markerType}`);
      }
    }
    
    // Show section breakdown
    if (sectionsAfter > sectionsBefore) {
      const sectionTypes = await prisma.markerSection.groupBy({
        by: ['markerSectionType'],
        where: { trialId },
        _count: { markerSectionType: true }
      });
      
      console.log('\nSection types created:');
      for (const type of sectionTypes) {
        console.log(`  ${type.markerSectionType}: ${type._count.markerSectionType}`);
      }
    }
    
    console.log('\n✅ Witness marker discovery completed successfully\n');
  } catch (error) {
    console.error('❌ Error during witness marker discovery:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
const trialId = process.argv[2] ? parseInt(process.argv[2]) : 1;

runWitnessDiscovery(trialId);