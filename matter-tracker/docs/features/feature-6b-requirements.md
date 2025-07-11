Feature 6b

We are getting an error when attempting to associate IT activities, "IT Activity not found with id: 1".  Directly before that error in the backend console log, we got a message "API: Found activity: null".  It seems we are using hard-coded IT Activity data, and we always have one item with description "Client Meeting - ABC Corp Strategy Review".  But in the database, we have data from the seed data json for IT activities, so naturally this hard-coded activity would not match, perhaps that is the cause of the error.

In any event, let's update the system to use the data in the database for IT activities and make sure they are correlated to users and dates in a way where we can get consistent testing.

Let's generate seed data for each team member between the dates of 6/1/2025 and 7/5/2025.  Here are some patterns to use to generate the seed data:
1) for each team member, generate two calendar events for firm meetings.  The first meeting should be on a monday for 2 hours and be called "Attorneys Strategy Meeting", let's say at 11 AM.  Also generate an hour long meeting on each Thursday at 1 PM called "Firm Strategy Meeting".
2) Generate random client meetings for team members, about 2 one hour meetings per week for each team member with some clients (correlate back to client names used for matters).
3) Generate Document change events for each team member.  Let's generate an average of 1 per day for each team member, but vary it randomly with around that average
4) Emails - generate client emails for each attorney, average 2 a day, some incoming, some outgoing on various topics related to legal activity for various matters and tasks that seem logical.


With this data generated, we can test the IT activities feature more seriously and focus on the period June 1, 2025 - July 5, 2025.  Let's implement the IT Activities such that activities are selected by the filters on the page.  For Activity Type, we should have the option to select all activity types by default, and also each one individually, but we need to make sure we can select All again (either as dropdown option, or with someway to clear specific selected Activity Type).  When we bring up the IT Activity page we should pass through from the timesheet the Team Member and date range of the source timesheet.  With those selected and Activity Type defaulting to allow all activities, we should see data for each team member within the target range of 6/1/2025 through 7/5/2025, and we can test with that date.

So let's wire that IT Activity page with real data and generate new seed data for IT activities that synchronizes with the other seed data.  

