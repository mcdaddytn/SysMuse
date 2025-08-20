# Feature 7B: Marker Implementation - Additional Features

*** NOT READY TO IMPLEMENT - PUT THIS WARNING BACK TO USER IF THIS IS STILL IN FEATURE FILE WHEN SUBMITTED ***

## Overview

## Input Sources

## Expected Output Format

## Requirements





Additional entities


*****
Not sure we need to implement these or if they will help - let's defer it until we need it

MarkerConstraint 

These records determine overall structure of markers in relation to one another and create contraints that can be used to set markers.  Marker pairs can be linear (like individual Witness Testimony markers where one examination must be completed before another starts - or one complete witness testimony must be completed before another starts), or hierarchical (e.g., a complete WitnessTestimony contains individual examination types).
*****

















More specific (some will come in pairs, but often it is easier to find one of the pair than the other, and in some cases we will fail to find the closing marker of the pair).
























We want to test the hierarchical template feature to produce interesting output including variations of transcript excerpts.  In feature 6 we implemented the ground work for this, but let's get into the specifics of hierarchical features.

## Input Sources
- Data in the relational database from various tables joined

## Expected Output Format
Json files of query results to created subdirectories of the output folder
Text files of rendered template results to created subdirectories of the output folder


## Requirements
- Make a small but impactful schema change.  Create on the TrialEvent entity a rawText which can translate to a varchar(255) in the database.  The WitnessCalledEvent and CourtDirectiveEvent currently have this field, but we can remove it from those entities and just have it in the TrialEvent entity (note these entities are related in a prisma MTI pattern).  The StatementEvent entity has a text field which is long text and should remain that way.  For any StatementEvent the corresponding TrialEvent should have rawText that is a truncated version of the full text (to fit the 255 char limit).  For the other two related entities within the prisma MTI pattern, they can just get their text property from TrialEvent.rawText.
- update all code affected by the schema change
- update any test templates affected by the schema change, or handle within the registered queries (so rawText and text properties are available to templates and rendered properly)
- Now let's modify the query-hierarchy-mustache template to use a file (rather than templateBody) and work on this template to be able to output a hiearchical excerpt of the trial
- Let's have this template include the overall trial, the sessions, within the trial and show all statements made by THE COURT (i.e., the judge with surroundingEvents=7).  But the template should only use the rawText field so we do not see long statement text but rather abridged versions.  The net result is we will see everytime the judge spoke and what came before and after in abridge terms.
- this query should have a date range and show events within 10/1/2020 at 12:30 PM and 10/7/2020 at 6:00 PM.  This way we catch most of the trial after the jury selection and before some of the end procedures.
- We want to see in the template, the overall trial information, session information (at 2nd level or hierarchy), and then at bottom level the individual truncated statements.
- perhaps create another hieararhical template or two that demonstrate various features that we can validate.







