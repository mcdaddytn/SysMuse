Project Synopsis

The Elastic Search Query Generator (ESIndex for short, used for root directory name) project intends to generate interesting queries from a corpus to help a user navigate the documents.  It will initially generate searches that will provide subqueries that can be combined in interesting ways to navigate the corpus.  It employs stopwords, bm25 and similar calculations, elasticsearch and relational database storage of document information and will drive a data visualization for search.  It will measure orthogonality of search terms with respect to the corpus to find interesing relationships among documents.  We will develop hierarchical categories to assign to search terms to assist in establishing document clusters.


Project Knowledge

The tech stack is Node.js/Prisma Orm/MySql/TypeScript and is all client driven, running from the command line.  In the future it will be integrated into a larger framework including Express.js. using langchain for llm, winston for logging, axios on client side, jwt for authentication, and vue or quasar for GUI.

In terms of the TypeScript language, explicly type variables when possible as it facilitates development and debugging in an IDE.  Whenever coding changes are complex and involve multiple changes in a code file, just generate the entire code file.  If just doing an incremental enhancement, describe clearly where it should be merged and provide proper identation, so it can be cut and pasted easily in place.

If providing curl commands to test something that requires posting json, separate the json into a separate file (do not embed in the command line).

