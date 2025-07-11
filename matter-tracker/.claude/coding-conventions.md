Tech Stack and Conventions

The tech stack we are using is:

TypeScript
Prisma ORM
PostgreSQL
Express.js
Vue.js
Quasar

Generate code with explicit typing wherever possible.  Generate the whole code file when there are substantial changes involving detailed merging, but can generate code snippets otherwise. But when generating code snippets provide clear instructions on where to merge and preserve indentation as would be expected from original code files.

We do not need to generate deltas for database as I will recreate the database during initial phase where schema changes are occuring regularly.


