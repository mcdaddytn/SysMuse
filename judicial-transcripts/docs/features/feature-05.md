# Feature 5: Search Enhancements and Output

## Overview

We want to be able to output text files to a configured and/or requested directory that are resultant from queries of StatementEvent records on the system.  The query will define which statements, and the output document will contain the text from those statements, formatted according to a provided template.

## Input Sources
- same as previous features (feature-04 and feature-04B)


## Requirements
1. Change our json output to exist in a hierarchy as follows under the sampleResults section (currently called sampleResults, change that to statementResults):
trial
session
statements
speaker

Statements should be sorted in chronological order but be underneath the levels of the above hieararchy.  Since each statement has only one speaker, even though it is below statement in hierarchy, we will expect a single record per statement (this is important for templates feature below).

2. Add a maxResults to the input configuration to max out number of records included in output for terms that are broad with results
3. Add a chronological surrounding group of statements selector called surroundingStatements.  This will default to 0, but if > 0, we want records before and after the statement that is a hit.  Start with records before (if surroundingStatements is 1, just include a single statement before).  But if it is 2, we want a statement before and after, and if more than that, equally distribute before and after statements, favoring before if it is an odd number.
4. The maxResults applies to the number of hits from our query, but we can still add statements as part of our surroundingStatements feature.  So if maxResults=10 and surroundingStatements=3, we would expect ~40 statement records.
5. Add outputFileNameTemplate parameter.  This should be a legitimate fileName template (default to .txt if not extension), but will also contain parameters that can be filled from any fields that are part of the results.  This way, we can generate multiple files, examples below.  The delimiters for the template parameters within the outputFileNameTemplate are braces "{" and "}", an example is "Results{Speaker.speakerType}.txt"
6. Add outputFileTemplate - this is a file name of a text file residing in config/templates that will have a template for the contents of the output file (example below)
7. Make data available to the templates that comes from the json output and use convention of EntityName.FieldName (from prisma/postgres schema), some examples "Trial.caseNumber", "Speaker.speakerPrefix", "StatementEvent.text"
7. Add additional custom template parameters that will be available for outputFileNameTemplate and outputFileTemplate, described below, some examples "caseHandle" and "runTimeStamp", calculations described below
8. Allow trial selected in input by caseNumber in addition to name (could be either)
9. Have a configurable parameter called resultSeparator that will go between multiple records expressed in the output, it can default to a double new line.  Each outputFileTemplate represents a template for a single statement result with all of the hierarchical fields available.  When we have multiple records, they will be output each rendering in this template and then separated by resultSeparator
10. Add configurations to do file templates (and generate logical templates, including the sample one below), for a few of our test queries that are getting good results.  I am especially intereted in the judge's statements


Calculations of custom template parameters:

caseHandle - Take the value Trial.caseNumber (example 2:19-cv-00123-JRG), and remove illegal file characters like ":" (example result "219-cv-00123-JRG"
runTimeStamp - this is the time stamp suffix we are using to append to the output directory names and files

Examples of template parameters with EntityName.FieldName convention
Trial.caseNumber
Speaker.speakerPrefix
StatementEvent.text


Examples of a template (that would be contents of outputFileTemplate) between the quotes
'
Speaker: {Speaker.speakerPrefix}		Date:	{Session.sessionDate}	Time:	{TrialEvent.startTime}	
{StatementEvent.text}
'


## Expected Output Format
Text output from the templates above into the configured directory above



