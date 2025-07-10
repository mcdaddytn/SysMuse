Feature 7 

Add data types to IT Activities and modify seeding process to cover all possible IT Activity types.

On a high level, the current activities are:

Calendar Event - These can be internal meetings, client meetings, scheduled calls, events syncronized from the aderant milana system for court docketing and related scheduling, and also scheduled days off and personal time.  These events will often have a duration (like with a meeting or call) that can be used as a default duration for the IT Activity, but some (like deadlines), may not have a duration in which case we can

Emails - Emails that are sent or received within the firms email system to and from clients and team members within the firm can be indicators of IT activities that might translate to a task with a significant duration to affect the scheduling of the team member.  Assume that in the actual implementation (when we use real data, not the mocked up data generated for testing), that we would filter out emails that do not appear to be related to business matters that would take up the team members professional time.  But the ones that do (incoming will need to be read and considered, outgoing would need to be drafted), will often be associated with a duration.  We should not default the duration, but rather let the team member associate the IT Activity and set a duration if it is deemed to be a significant item.

Document - A document related to client matters saved on the firm's one drive and recorded with the microsoft graph api will show up in the users profile.  These can also be filtered ahead of time (when we implement the actual integration), to filter out documents that are obviously not related to tasks that can be scheduled, but remaining document creations and modifications will be displayed here to trigger the team member to potentially associate with a task and assign a duration (there is no default duration for this type of task).

Let's add two new activities to the IT Activity Page and generate within our seed process.

Relativity Session - The firm's e-discovery system relativity has an api where we can record various events.  Among them are logins and logouts of the system.  The user is auto-logged out after a time, so the amount of time they are actually logged in can be a good indicator of time spent on a matter.  During the session, the user might execute queries for specific matters, so we should be able to create a summary of the relativiy session (time logged in, time logged out, searches executed, and documents coded (where user adds metadata after reviewing a document)).  We can build an integration to put this type of data together, but for now we can simulate within our seed generator and create IT Activity that has a duration we can use as a default.

Claude Session - The LLM chats executed through the firm's LLM chat (for now it is Anthropic Claude) account will be recorded including titles of chats and time and content of prompts and responses.  From there, our integration will be able to provide a chat title and a rough duration of how long the team member was interacting with that particular chat.  We should generate seed data for these types of sessions with default durations that can be associated by team members.

While generating data as part of the seeding process, for calendar events, generate some data representative of what might have been synchronized from the aderant milana system, including dependent events based on court rules.  And for emails and documents, generate varieties of documents based on the descriptions of how our api service might work to filter IT Activities to relevant activities with scheduling implications.  Over time, we may be developing logic to auto-sync or auto-suggest defaults for matter and tasks that would parse information from the IT Activities, so I want to be able to demonstrate that as a future possible enhancement.

Let's generate the additional IT activity types with any code affected including seed data and seed data generation.





