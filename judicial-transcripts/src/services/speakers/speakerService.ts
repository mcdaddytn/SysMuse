import { PrismaClient, SpeakerType } from '@prisma/client';

export interface SpeakerData {
  name: string;
  type: SpeakerType;
  prefix?: string;
  trialId: number;
}

export async function createOrFindSpeaker(
  prisma: PrismaClient | any,
  data: SpeakerData
) {
  // Generate speaker handle from name (e.g., "MR. JOHN SMITH" -> "MR_JOHN_SMITH")
  const handle = data.name.replace(/\s+/g, '_').toUpperCase();
  
  // Check if speaker already exists
  const existing = await prisma.speaker.findFirst({
    where: {
      trialId: data.trialId,
      speakerHandle: handle,
      speakerType: data.type
    }
  });

  if (existing) {
    return existing;
  }

  // Create new speaker
  return await prisma.speaker.create({
    data: {
      trialId: data.trialId,
      speakerPrefix: data.prefix || data.name.split(' ')[0],
      speakerHandle: handle,
      speakerType: data.type,
      isGeneric: false
    }
  });
}