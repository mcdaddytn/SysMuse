# Feature 6: Mustache Template Engine Integration

## Overview

We want to integrate the Mustache template engine and offer it as an alternative and be the primary way of creating text output from queries.


## Input Sources
- Data in the relational database from various tables joined

## Expected Output Format
Json files of query results to created subdirectories of the output folder
Text files of rendered template results to created subdirectories of the output folder


## Requirements
- Add a parameter to query json configuration called templateType with two possible values, Native and Mustache.  The default should be Native and when selected it works as currently with simple single delimeter pair templates.  Also add nativeStartDelimiter and nativeEndDelimeter with default values "{" and "}" respectively.  Omitting templateType, nativeStartDelimiter, and nativeEndDelimeter and use of defaults should have the system behave as current.

- Change the query parameter names outputFileNameTemplate and outputFileTemplate to fileNameTemplate and fileTemplate respectively

- Add a parameter called templateBody which can be used interchangeably with fileTemplate.  If templateBody is used, the templated is embedded directly in the query json, otherwise with fileTemplate, it is pulled from a file in the templates subdirectory of the project as is current functionality

- Add a parameter called templateQuery to the config which defaults to "StatementEvent" to function as currently using the query already embedded and driving templates

- Using a Query Registry Pattern in TypeScript, implement multiple queries that can be selected by name to run templates.  The existing query is called the "StatementEvent" query, and we should add "TrialEvent" query, and a "TrialEventHierarchy" query.  The TrialEvent query should leverage the MTI pattern and have all fields from the TrialEvent table and do joins to StatementEvent, WitnessCalledEvent, and CourtDirectiveEvent so those fields are available.  This can be used to output excerpts of Transcripts with customized formatting.  The QueryRegistry will register all of the necessary templates for the implementations described here to be selected by name .

- The TrialEventHierarchy should have hierarchcy levels and be selected all the way from the top starting with a Trial, then have collection for Session, then a collection for TrialEvent with all of the joins of above.  This query can be used to drive a hierarchical Mustache template that shows Trial information on top, Session information within, and then at the bottom level individual events

- Separate the sql/prisma query variables (those used for where clauses of prisma query), by putting them in a sub-node of query input json called queryParams

- Implement the ability to pass in direct template variables in a sub-node of input query json called templateParams that will be directly accessible to the mustache templates.  An example of this would be "context" and can be used to pass in LLM context description that will be in the same file as generated template output from sql querying.

- Some of the existing test queries and test templates should be converted to use Mustache and alternative queries.  Let's have a mix of existing queries that should have the same output but now using Mustache templates (just alter the configuration and the template, but implement the same output) while others can continue to run with native templates.  Let's alter a few to use different queries and produce a bit different output.

- The surroundingStatements parameter should be renamed surroundingEvents and we wlll expand functionality in a number of ways.  For one, add a parameter surroundingEventUnit that will default to "EventCount" but can also be "WordCount" or "CharCount".  So when the surroundingEvents parameter is supplied, its current functionality with EventCount will allow us to select how many events before and after the ones that match filters are output, but we can also specify this by the number of words or number of characters we expect to see with the surroundingEvents.

- Supporting the above, let's create fields in the TrialEvent called wordCount and characterCount that count the number of words and characters respectively that are stored in rawText or text fields of the StatementEvent, WitnessCalledEvent, and CourtDirectiveEvent entities.

- The surroundingEvents parameter functionality should also be expanded with an alternative to specify precedingEvents, and followingEvents instead of surroundingEvents.  Where surroundingEvents will distribute the additional events displayed evenly before and after (favoring events before by 1 if an odd number), the precedingEvents and followingEvents parameters will explicitly set how many before and after should be output.

- let's alter current tests rather than create new ones for now (there are a lot of tests currently), just make some logical changes to add or change output fields in templates to display above features.  Make a few hierarchical where we can see trial information, session information, and then TrialEvent information nested.  Also include conditionals that will have different template displays for Event level data depending on type (whether StatementEvent, CourtDirectiveEvent, or WitnessCalledEvent).

- Implement a single new output template and query that will output a court transcript, but use our speaker handles for each speaker, show court directives and witness called events similar to how they are displayed from the originals.  This query should take a caseNumber as input parameter and a date/time range to select all events within.  So we should be able to select partial transcripts based on the timestamps - if omitted the entire trial is output, but otherwise we limit to start and end date/times.


