# Feature 4B: Elastic Search Integration - Test Tweaks

## Overview

We want to modify our tests to be more in sync with the primary data set used for testing.

## Input Sources
- Sample of trial, first transcript is ./samples/transcripts/case2/TRANSCRIPT 219-CV-123-JRG 10_1_20 AM
- Excerpts are also from this trial and contain data throughout the trial transcript with much text in the middle removed, meant to show samples of various types of interactions but cut out a lot of long speech, excerpts are in ./samples/transcripts directory with "Excerpt" prefix, 
- After running test from config "example-trial-config.mac", you will have all the data (from entire sample trial) in the database to query
- You can also do text searches against the 73 Excerpts as they will contain a lot of the interesting interactions between judge and counsel


## Requirements
1. Let's tweak the .json test files in config/queries to use real participants.  Making sure the database is in a state with data (has ~ 35841 Line records)
2. Select out of the database real data and update the tests, specifcally change speakerPrefix and trialName to match the single case in our database.
3. Select the top few attorneys and witnesses that have the most statements, and use those where appropriate in the tests.
4. Select your objection and other language and tweak it to get some hits based on what was actually said by judge, attorneys, and witnesses.
5. We are definitely interested in objection language, some examples below
6. We are definitely interested in keywords below especially from judges, attorneys, but might give too many results to be meaningful, test them.
7. Use proximity searches for keywords producing too many hits by querying for examples and than producing proximity searches or keyword searches for more intersting subsets
8. There is a problem with trial parsing that used to work, so this was broken along the way.  Here is the data from Trial table:

"id","name","caseNumber","court","courtDivision","courtDistrict","totalPages","createdAt","updatedAt"
1,"7 VS. MARSHALL, TEXAS","2:19-CV-00123-",UNITED STATES DISTRICT COURT,"3                             MARSHALL DIVISION","2                   FOR THE EASTERN DISTRICT OF TEXAS",,2025-08-10 22:08:05.383,2025-08-10 22:08:25.236

It should be:
"caseNumber": "2:19-cv-00123-JRG"
"court": "UNITED STATES DISTRICT COURT"
"courtDivision": "MARSHALL DIVISION"
"courtDistrict": "EASTERN DISTRICT OF TEXAS"
"name": "VOCALIFE LLC, PLAINTIFF, VS. AMAZON.COM, INC. and AMAZON.COM LLC, DEFENDANTS."


Here are some phrases that might be interesting, find variants that work (my comments in parentheses)

move to strike
can we strike
I will strike
record will reflect
move to strike
motion to strike
non-responsive
the record (non case sensitive from judge only - and variants)
you may approach
objection is sustained
That objection is overruled.
is there objection
No objection from

Objection, form.
Objection to form
It's overruled.

Some phrases that are interesting for objections

"Is there objection" (from judge)
"No objection" (from attorney)

Objection, Your Honor
State your objection
Any objections

Querying for objections initiated by judge
"Is there objection" (from judge)
"No objection" (from attorney)
is there objection
No objection from


Here are some keywords that probably will produce too many results, test these and reduce output with more relevant responses (especially interesting from judge - hits from judge more important than from attorneys on these),  (my comments in parentheses):

rephrase (from attorneys or judge)
disregard (from attorneys or judge)
strike
motion
approach
scope
claims
sustained
overruled



## Expected Output Format
Json files of result in the output folder