import { PrismaClient } from '@prisma/client';

async function updateWindowSize() {
  const prisma = new PrismaClient();
  
  try {
    const result = await prisma.accumulatorExpression.update({
      where: { name: 'judge_attorney_interaction' },
      data: { windowSize: 5 }
    });
    
    console.log(`Updated ${result.name}: window size changed to ${result.windowSize}`);
  } catch (error) {
    console.error('Error updating window size:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateWindowSize();