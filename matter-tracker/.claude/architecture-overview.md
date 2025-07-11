architecture-overview.md

The tech stack we are using is:

TypeScript
Prisma ORM
PostgreSQL
Express.js
Vue.js
Quasar


The system has a REST api serving a front end using Vue.js/Quasar.  The system is initialized with seed data and we can delete the database everytime we make any major changes, so there is no need at this point to do any database migration.  When we change the schema we delete the database and start over again.  Seed data is captured in json in the directory:

matter-tracker/backend/prisma/seeds

We generally execute the following sequence to reinitialize the database:

npm run prisma:generate
npx prisma migrate reset
npm run prisma:push
npm run prisma:seed



The GUI represents a timesheet application for a law firm and has an associated IT Activity page which is used to accumulate activity that can be gleaned from APIs like Microsoft Graph API, Outlook calendars, etc. to provide information that might be associated with timesheet tasks to fill in actual hours spent by attorneys.  Attorneys will generally project their hours using the timesheet interface, and then we will update with actual hours by associating real activity through the IT activities page.


