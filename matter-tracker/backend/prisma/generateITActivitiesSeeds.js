// Generate comprehensive IT Activities seed data for June 1, 2025 - July 5, 2025
const fs = require('fs');

const teamMembers = [
  { id: "tm1", name: "Sarah Johnson", email: "sarah.johnson@firm.com" },
  { id: "tm2", name: "Michael Chen", email: "michael.chen@firm.com" },
  { id: "tm3", name: "Emily Rodriguez", email: "emily.rodriguez@firm.com" },
  { id: "tm4", name: "David Thompson", email: "david.thompson@firm.com" },
  { id: "tm5", name: "Jessica Williams", email: "jessica.williams@firm.com" }
];

const clients = [
  { name: "Acme Corporation", domain: "acmecorp.com" },
  { name: "Green Energy Solutions", domain: "greenenergy.com" },
  { name: "Johnson Family Trust", domain: "johnsonfamily.com" },
  { name: "TechStart Ventures", domain: "techstart.com" }
];

const legalTopics = [
  "Contract Review", "Compliance Review", "Patent Strategy", "Litigation Update",
  "Due Diligence", "Estate Planning", "Investment Agreement", "Regulatory Filing",
  "Settlement Negotiation", "Merger Analysis", "IP Protection", "Corporate Governance"
];

const documentTypes = [
  "Agreement", "Brief", "Motion", "Contract", "Policy", "Report", "Analysis", 
  "Filing", "Amendment", "Review", "Memo", "Letter"
];

const emailSubjects = [
  "RE: Contract Terms", "Compliance Update", "Patent Filing Status", "Meeting Follow-up",
  "Document Review", "Legal Opinion", "Settlement Proposal", "Regulatory Question",
  "Client Update", "Case Strategy", "Filing Deadline", "Discovery Request"
];

function generateId(type, index) {
  return `${type}_${String(index).padStart(4, '0')}`;
}

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getRandomTime(hour = null) {
  const h = hour || Math.floor(Math.random() * 8) + 9; // 9 AM to 5 PM
  const m = Math.floor(Math.random() * 4) * 15; // 0, 15, 30, or 45 minutes
  return { hour: h, minute: m };
}

function generateMondayMeetings(startDate, endDate) {
  const meetings = [];
  let idCounter = 1;
  
  // Find first Monday in range
  let current = new Date(startDate);
  while (current.getDay() !== 1) {
    current = addDays(current, 1);
  }
  
  while (current <= endDate) {
    teamMembers.forEach(member => {
      const meetingDate = new Date(current);
      meetingDate.setUTCHours(11, 0, 0, 0); // 11 AM UTC
      const endTime = new Date(meetingDate);
      endTime.setUTCHours(13, 0, 0, 0); // 1 PM UTC (2 hours)
      
      meetings.push({
        id: generateId('it_cal_strategy', idCounter++),
        teamMemberId: member.id,
        activityType: "CALENDAR",
        title: "Attorneys Strategy Meeting",
        description: "Weekly strategy meeting for all attorneys",
        startDate: meetingDate.toISOString(),
        endDate: endTime.toISOString(),
        metadata: {
          meetingType: "meeting",
          location: "Conference Room A",
          attendees: teamMembers.map(tm => tm.email),
          isAllDay: false
        },
        isAssociated: false
      });
    });
    
    current = addDays(current, 7); // Next Monday
  }
  
  return meetings;
}

function generateThursdayMeetings(startDate, endDate) {
  const meetings = [];
  let idCounter = 1;
  
  // Find first Thursday in range
  let current = new Date(startDate);
  while (current.getDay() !== 4) {
    current = addDays(current, 1);
  }
  
  while (current <= endDate) {
    teamMembers.forEach(member => {
      const meetingDate = new Date(current);
      meetingDate.setUTCHours(13, 0, 0, 0); // 1 PM UTC
      const endTime = new Date(meetingDate);
      endTime.setUTCHours(14, 0, 0, 0); // 2 PM UTC (1 hour)
      
      meetings.push({
        id: generateId('it_cal_firm', idCounter++),
        teamMemberId: member.id,
        activityType: "CALENDAR",
        title: "Firm Strategy Meeting",
        description: "Weekly firm strategy and business development meeting",
        startDate: meetingDate.toISOString(),
        endDate: endTime.toISOString(),
        metadata: {
          meetingType: "meeting",
          location: "Conference Room B",
          attendees: teamMembers.map(tm => tm.email),
          isAllDay: false
        },
        isAssociated: false
      });
    });
    
    current = addDays(current, 7); // Next Thursday
  }
  
  return meetings;
}

function generateClientMeetings(startDate, endDate) {
  const meetings = [];
  let idCounter = 1;
  
  let current = new Date(startDate);
  
  while (current <= endDate) {
    // Generate 2 client meetings per week per team member
    teamMembers.forEach(member => {
      // Two meetings per week
      for (let i = 0; i < 2; i++) {
        const client = getRandomElement(clients);
        const topic = getRandomElement(legalTopics);
        const time = getRandomTime();
        
        // Random day of the week (excluding weekends)
        const dayOffset = Math.floor(Math.random() * 5); // 0-4 for Mon-Fri
        const meetingDate = addDays(current, dayOffset);
        
        if (meetingDate <= endDate) {
          meetingDate.setUTCHours(time.hour, time.minute, 0, 0);
          const endTime = new Date(meetingDate);
          endTime.setUTCHours(time.hour + 1, time.minute, 0, 0); // 1 hour meeting
          
          meetings.push({
            id: generateId('it_cal_client', idCounter++),
            teamMemberId: member.id,
            activityType: "CALENDAR",
            title: `Client Meeting - ${client.name} ${topic}`,
            description: `${topic} meeting with ${client.name}`,
            startDate: meetingDate.toISOString(),
            endDate: endTime.toISOString(),
            metadata: {
              meetingType: "meeting",
              location: Math.random() > 0.5 ? "Client Office" : "Law Firm Conference Room",
              attendees: [`legal@${client.domain}`, member.email],
              isAllDay: false
            },
            isAssociated: false
          });
        }
      }
    });
    
    current = addDays(current, 7); // Next week
  }
  
  return meetings;
}

function generateDocuments(startDate, endDate) {
  const documents = [];
  let idCounter = 1;
  
  let current = new Date(startDate);
  
  while (current <= endDate) {
    teamMembers.forEach(member => {
      // Average 1 document per day, vary randomly around that
      const docsThisDay = Math.random() < 0.8 ? 1 : (Math.random() < 0.5 ? 0 : 2);
      
      for (let i = 0; i < docsThisDay; i++) {
        const client = getRandomElement(clients);
        const docType = getRandomElement(documentTypes);
        const topic = getRandomElement(legalTopics);
        const time = getRandomTime();
        
        const docDate = new Date(current);
        docDate.setUTCHours(time.hour, time.minute, 0, 0);
        
        if (docDate <= endDate) {
          const fileExt = Math.random() > 0.3 ? 'docx' : (Math.random() > 0.5 ? 'pdf' : 'xlsx');
          const fileName = `${docType} - ${client.name} ${topic}.${fileExt}`;
          
          documents.push({
            id: generateId('it_doc', idCounter++),
            teamMemberId: member.id,
            activityType: "DOCUMENT",
            title: fileName,
            description: `Document ${Math.random() > 0.5 ? 'created' : 'modified'}: ${fileName}`,
            startDate: docDate.toISOString(),
            metadata: {
              fileName: fileName,
              fileType: fileExt,
              fileSize: Math.floor(Math.random() * 2000000) + 100000, // 100KB to 2MB
              filePath: `Clients/${client.name}/${topic}`,
              shareStatus: Math.random() > 0.6 ? "shared" : "private",
              parentFolder: `Clients/${client.name}`
            },
            isAssociated: false
          });
        }
      }
    });
    
    current = addDays(current, 1); // Next day
  }
  
  return documents;
}

function generateEmails(startDate, endDate) {
  const emails = [];
  let idCounter = 1;
  
  let current = new Date(startDate);
  
  while (current <= endDate) {
    teamMembers.forEach(member => {
      // Average 2 emails per day
      const emailsThisDay = Math.random() < 0.7 ? 2 : (Math.random() < 0.5 ? 1 : 3);
      
      for (let i = 0; i < emailsThisDay; i++) {
        const client = getRandomElement(clients);
        const subject = getRandomElement(emailSubjects);
        const time = getRandomTime();
        
        const emailDate = new Date(current);
        emailDate.setUTCHours(time.hour, time.minute, 0, 0);
        
        if (emailDate <= endDate) {
          emails.push({
            id: generateId('it_email', idCounter++),
            teamMemberId: member.id,
            activityType: "EMAIL",
            title: `${subject} - ${client.name}`,
            description: `Email ${Math.random() > 0.5 ? 'sent' : 'received'} regarding ${subject.toLowerCase()}`,
            startDate: emailDate.toISOString(),
            metadata: {
              recipients: [`legal@${client.domain}`],
              ccRecipients: Math.random() > 0.5 ? [`cc@${client.domain}`] : [],
              hasAttachments: Math.random() > 0.4,
              priority: Math.random() > 0.7 ? "high" : "normal",
              messageId: `msg-${client.name.toLowerCase().replace(' ', '-')}-${idCounter}`
            },
            isAssociated: false
          });
        }
      }
    });
    
    current = addDays(current, 1); // Next day
  }
  
  return emails;
}

function generateITActivitiesSeeds() {
  const startDate = new Date('2025-06-01');
  const endDate = new Date('2025-07-05');
  
  console.log(`Generating IT Activities from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  const activities = [
    ...generateMondayMeetings(startDate, endDate),
    ...generateThursdayMeetings(startDate, endDate),
    ...generateClientMeetings(startDate, endDate),
    ...generateDocuments(startDate, endDate),
    ...generateEmails(startDate, endDate)
  ];
  
  // Sort by date
  activities.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  
  console.log(`Generated ${activities.length} IT activities`);
  console.log(`- ${activities.filter(a => a.activityType === 'CALENDAR').length} calendar events`);
  console.log(`- ${activities.filter(a => a.activityType === 'DOCUMENT').length} document activities`);
  console.log(`- ${activities.filter(a => a.activityType === 'EMAIL').length} email activities`);
  
  const seedData = {
    itActivities: activities
  };
  
  return seedData;
}

// Generate and save the seed data
const seedData = generateITActivitiesSeeds();
fs.writeFileSync('./seeds/itActivities.json', JSON.stringify(seedData, null, 2));
console.log('IT Activities seed data generated and saved to ./seeds/itActivities.json');