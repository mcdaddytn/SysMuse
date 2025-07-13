// prisma/seeds/itActivitiesGenerator.ts

import { PrismaClient, ITActivityType } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

interface SeedConfig {
  startDate: string;
  endDate: string;
  frequency: {
    emailsPerDay: number;
    documentsPerDay: number;
    calendarEventsPerWeek: number;
  };
  collections: {
    legalTopics: string[];
    documentTypes: string[];
    emailSubjects: string[];
    relativityQueryTypes: string[];
    claudeSessionTitles: string[];
    cocounselSessionTitles: string[];
  };
  meetings: {
    weeklyMeetings: Array<{
      title: string;
      dayOfWeek: number;
      startTime: string;
      duration: number;
      participants: string[];
    }>;
    clientMeetings: Array<{
      title: string;
      frequency: string;
      duration: number;
      participants: string[];
    }>;
  };
}

function loadConfig(): SeedConfig {
  const configPath = path.join(__dirname, 'itActivitiesConfig.json');
  const configData = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configData);
  return config.seedConfig;
}

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function getRandomElements<T>(array: T[], count: number): T[] {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMinutes(date: Date, minutes: number): Date {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

function createTimeString(hours: number, minutes: number): string {
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function getRandomTimeInWorkingHours(): { hours: number; minutes: number } {
  const hours = Math.floor(Math.random() * 9) + 8; // 8 AM to 5 PM
  const minutes = Math.floor(Math.random() * 4) * 15; // 0, 15, 30, 45
  return { hours, minutes };
}

function generateMetadata(activityType: ITActivityType, config: SeedConfig): any {
  switch (activityType) {
    case 'EMAIL':
      return {
        subject: getRandomElement(config.collections.emailSubjects),
        from: `${getRandomElement(['client', 'opposing.counsel', 'expert', 'colleague'])}@example.com`,
        attachments: Math.random() > 0.7 ? Math.floor(Math.random() * 3) + 1 : 0,
        priority: getRandomElement(['normal', 'high', 'low']),
        hasAttachments: Math.random() > 0.6
      };
    
    case 'DOCUMENT':
      return {
        documentType: getRandomElement(config.collections.documentTypes),
        application: getRandomElement(['Microsoft Word', 'Adobe PDF', 'Excel', 'PowerPoint']),
        fileSize: `${(Math.random() * 10 + 0.5).toFixed(1)}MB`,
        lastModified: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
        version: `v${Math.floor(Math.random() * 5) + 1}.${Math.floor(Math.random() * 10)}`
      };
    
    case 'CALENDAR':
      return {
        meetingType: getRandomElement(['client-meeting', 'internal', 'court', 'deposition', 'conference']),
        location: getRandomElement(['Conference Room A', 'Zoom', 'Client Office', 'Courthouse', 'Law Library']),
        attendees: Math.floor(Math.random() * 5) + 2,
        hasReminder: Math.random() > 0.3,
        isRecurring: Math.random() > 0.8
      };
    
    default:
      return {};
  }
}

async function generateEmailActivities(config: SeedConfig, startDate: Date, endDate: Date): Promise<any[]> {
  const activities = [];
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    // Skip weekends
    if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }
    
    const emailsToday = Math.floor(Math.random() * 5) + config.frequency.emailsPerDay - 2;
    
    for (let i = 0; i < emailsToday; i++) {
      const time = getRandomTimeInWorkingHours();
      const activityTime = new Date(currentDate);
      activityTime.setHours(time.hours, time.minutes);
      
      const teamMembers = await prisma.teamMember.findMany();
      const teamMember = getRandomElement(teamMembers);
      
      activities.push({
        id: `email_${currentDate.toISOString().split('T')[0]}_${i}_${teamMember.id}`,
        teamMemberId: teamMember.id,
        title: getRandomElement(config.collections.emailSubjects),
        description: `Email activity related to ${getRandomElement(config.collections.legalTopics)}`,
        activityType: 'EMAIL' as ITActivityType,
        startDate: activityTime,
        metadata: generateMetadata('EMAIL', config),
        isAssociated: false,
      });
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return activities;
}

async function generateDocumentActivities(config: SeedConfig, startDate: Date, endDate: Date): Promise<any[]> {
  const activities = [];
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    // Skip weekends
    if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }
    
    const documentsToday = Math.floor(Math.random() * 3) + config.frequency.documentsPerDay - 1;
    
    for (let i = 0; i < documentsToday; i++) {
      const time = getRandomTimeInWorkingHours();
      const activityTime = new Date(currentDate);
      activityTime.setHours(time.hours, time.minutes);
      
      const teamMembers = await prisma.teamMember.findMany();
      const teamMember = getRandomElement(teamMembers);
      
      const documentType = getRandomElement(config.collections.documentTypes);
      
      activities.push({
        id: `doc_${currentDate.toISOString().split('T')[0]}_${i}_${teamMember.id}`,
        teamMemberId: teamMember.id,
        title: `${documentType} - ${getRandomElement(config.collections.legalTopics)}`,
        description: `Document creation/modification: ${documentType}`,
        activityType: 'DOCUMENT' as ITActivityType,
        startDate: activityTime,
        metadata: generateMetadata('DOCUMENT', config),
        isAssociated: false,
      });
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return activities;
}

async function generateCalendarActivities(config: SeedConfig, startDate: Date, endDate: Date): Promise<any[]> {
  const activities = [];
  
  // Generate weekly recurring meetings
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    for (const meeting of config.meetings.weeklyMeetings) {
      // Find the correct day of the week
      const dayOfWeek = currentDate.getDay();
      const daysUntilMeeting = (meeting.dayOfWeek - dayOfWeek + 7) % 7;
      const meetingDate = addDays(currentDate, daysUntilMeeting);
      
      if (meetingDate <= endDate) {
        const [hours, minutes] = meeting.startTime.split(':').map(Number);
        meetingDate.setHours(hours, minutes);
        
        for (const participantId of meeting.participants) {
          activities.push({
            id: `cal_${meetingDate.toISOString().split('T')[0]}_${meeting.title.replace(/\s+/g, '_')}_${participantId}`,
            teamMemberId: participantId,
            title: meeting.title,
            description: `Weekly recurring meeting: ${meeting.title}`,
            activityType: 'CALENDAR' as ITActivityType,
            startDate: meetingDate,
            endDate: addMinutes(meetingDate, meeting.duration),
            metadata: generateMetadata('CALENDAR', config),
            isAssociated: false,
          });
        }
      }
    }
    
    currentDate.setDate(currentDate.getDate() + 7); // Move to next week
  }
  
  // Generate client meetings
  const clientMeetingDate = new Date(startDate);
  while (clientMeetingDate <= endDate) {
    for (const clientMeeting of config.meetings.clientMeetings) {
      const time = getRandomTimeInWorkingHours();
      clientMeetingDate.setHours(time.hours, time.minutes);
      
      for (const participantId of clientMeeting.participants) {
        activities.push({
          id: `client_${clientMeetingDate.toISOString().split('T')[0]}_${clientMeeting.title.replace(/\s+/g, '_')}_${participantId}`,
          teamMemberId: participantId,
          title: clientMeeting.title,
          description: `Client meeting: ${clientMeeting.title}`,
          activityType: 'CALENDAR' as ITActivityType,
          startDate: new Date(clientMeetingDate),
          endDate: addMinutes(new Date(clientMeetingDate), clientMeeting.duration),
          metadata: generateMetadata('CALENDAR', config),
          isAssociated: false,
        });
      }
      
      // Move to next occurrence based on frequency
      const daysToAdd = clientMeeting.frequency === 'weekly' ? 7 : 14;
      clientMeetingDate.setDate(clientMeetingDate.getDate() + daysToAdd);
    }
  }
  
  return activities;
}

export async function generateITActivities(): Promise<void> {
  console.log('🚀 Starting IT Activities generation...');
  
  try {
    const config = loadConfig();
    const startDate = new Date(config.startDate);
    const endDate = new Date(config.endDate);
    
    console.log(`📅 Generating activities from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Clear existing IT activities
    await prisma.iTActivity.deleteMany({});
    console.log('🗑️ Cleared existing IT activities');
    
    // Generate activities by type
    console.log('📧 Generating email activities...');
    const emailActivities = await generateEmailActivities(config, startDate, endDate);
    
    console.log('📄 Generating document activities...');
    const documentActivities = await generateDocumentActivities(config, startDate, endDate);
    
    console.log('📅 Generating calendar activities...');
    const calendarActivities = await generateCalendarActivities(config, startDate, endDate);
    
    // Combine all activities
    const allActivities = [...emailActivities, ...documentActivities, ...calendarActivities];
    
    console.log(`📊 Total activities to create: ${allActivities.length}`);
    console.log(`  - Emails: ${emailActivities.length}`);
    console.log(`  - Documents: ${documentActivities.length}`);
    console.log(`  - Calendar: ${calendarActivities.length}`);
    
    // Batch insert activities
    console.log('💾 Inserting activities into database...');
    
    for (const activity of allActivities) {
      await prisma.iTActivity.create({
        data: activity
      });
    }
    
    console.log('✅ IT Activities generation completed successfully!');
    
  } catch (error) {
    console.error('❌ Error generating IT activities:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  generateITActivities()
    .then(() => {
      console.log('🎉 Seed generation complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Seed generation failed:', error);
      process.exit(1);
    });
}