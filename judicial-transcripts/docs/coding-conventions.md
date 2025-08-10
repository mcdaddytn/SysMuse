Judicial Transcripts
Tech Stack and Coding Conventions

The following is the tech stack to use:

Node.js
Express.js
TypeScript
JavaScript
Prisma Orm (define all database entities here and persist in postgresql database)
PostgreSQL
ElasticSearch
pdf-text-extract (to parse pdf versions of transcripts)
langchain
Anthropic Claude Opus (preferred LLM model for langchain)
Docker (to host postgres and elasticsearch)


Provide full code files when substantial changes affecting a code file rather snippets (snippets OK for trivial changes).

When generating snippets for code, preserve indentation so code can be cut and paste in place

Break code into smaller files for easier management (do not exceed 10K per code file if can be avoided).  If files get too large refactor or query user as to how best to refactor into smaller classes.

Add console logging statement for debugging with a framework including levels for info, warn, error, etc.

Manage all database entities in prisma ORM

Use MTI pattern in prisma where appropriate for inheritance like behavior on entities.  An example is when we have a collection of closely related entities, the base class might be in the collection, but different related instances have richer attributes for more specific cases.

Do not provide database migrations !

We will be deleting database and recreating during initial development phase until schema is mature so no data migrations are required.  If we get to a more mature point in the project, I can change this directive.

Have cascading delete functionality available (either through ORM/relational database, but OK if manually coded).  We will need to often delete data before rerunning code that will repopulate the database, so we want to be able to cleanly remove data to avoid referential integrity errors.

For database where appropriate, let's seed the database from json data files.  Generate seed data files for system metadata where possible.  We will parameterize much of the system using metadata rather than hard-coded strings, constants, etc.  Where possible let's create parameters affecting the functioning of the system and store in system metdata seeded from json.

Use integer auto generated id for entities.

Use a client interface for tests and pass in data via a json configuration file.

If there are open questions about requested features, prompt the user to guide the design and implementation process.



