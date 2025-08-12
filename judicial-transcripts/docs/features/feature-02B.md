# Feature 2B: Phase 1 Parsing issues bugs

## Overview

We have some parsing issues that need to be fixed and are precluding our further testing.  We have implemented a search and export feature that is pretty powerful, but bugs are occuring that are due to parsing issues that have resurfaced.  In our last session, things got a little confused and we recorded observations in STATUS-FEATURE-05.md.  I suspect part of that was due to some confusion in how we were testing, and we may have regressed and reintroduced some bugs previously fixed.  We will be refactoring in the future, but for now, we want minium alterations to the code to get the current test working in phase 1 and phase 2, so we can validate and test search and export that we have recently completed and put out a release for integration testing with the team.  That means we might sacrifice some design principles for expediency and just get the test case we are currently using working.

## Input Sources

The test case we are concerned with is expressed and available in a number of ways in terms of source data:
1) samples/transcripts/case2/TRANSCRIPT 219-CV-123-JRG 10_1_20 AM.txt - the real first full transcript (1 of 12 of the full set)
2) samples/transcripts/case2/Excerpt* - all the files that are prefixed with Excerpt (and we can order 1 through 73) are excerpts from the entire trial.  I pruned out a lot of dialogue in the middle and left interesting testing scenarios like court and attorney interactions.  These can be used for reference on various parsing variations.
3) config/example-trial-config-mac.json - this is the configuration run that references the full trial transcript (12 large files, ~ 2.65 MB of text) that is too big for the LLM context.  We can run this test configuration and then reference the data in the database once parsed.

## Requirements

After doing parsing on phase 1, we will take a database image so that we can always refer back to that image or restore it to verify phase 1 parsing, or to test phase 2 from a clean copy of the databae established in phase 1.  For the purposes of this requirement, we should only run phase 1 and then stop, using flag --phase1 when running.

Test sequence for this feature:
#test for phase 1
#first reset database
npx prisma db push --force-reset
#next seed database
npm run seed
#now run phase1 only on our test set
npx ts-node src/cli/parse.ts parse --config "./config/example-trial-config-mac.json" --phase1

# stop and do review of data in database



So let's methodically break this down and follow the following procedure

1) Resolve parsing issues and test by running phase 1 only
2) I will confirm data in database before running phase 2
3) Run phase 2 after resolving phase 1 issues
4) I will do manual confirumation of phase 2


Phase 1 parsing issues

In our last run, we parsed the trial information and got the following record in Trial Entity

1	VOCALIFE LLC, PLAINTIFF, VS. AMAZON.COM, INC. and AMAZON.COM LLC, DEFENDANTS.	2:19-CV-00123-	UNITED STATES DISTRICT COURT	3                             MARSHALL DIVISION	2                   FOR THE EASTERN DISTRICT OF TEXAS		2025-08-11 21:38:40.219	2025-08-11 21:38:50.950

Everything looks OK, except:
caseNumber should be "2:19-CV-00123-JRG" instead of "2:19-CV-00123-"
courtDivision should be "MARSHALL DIVISION" instead of "3                             MARSHALL DIVISION"
courtDistrict should be "EASTERN DISTRICT OF TEXAS" instead of  "2                   FOR THE EASTERN DISTRICT OF TEXAS"


The Session entity information is incomplete, here is a sample record:
1	1	2020-10-01 05:00:00.000	AFTERNOON		NOTICE OF FILING OF OFFICIAL TRANSCRIPT of Proceedings held on 10_1_20 (Trial Transcript - Afternoon.txt			2025-08-11 21:38:40.465	2025-08-11 21:38:40.465

We are missing documentNumber, totalPages, transcriptStartPage

The documentNumber can be parsed from the page header line 1:
Case 2:19-cv-00123-JRG Document 328 Filed 10/09/20 Page 1 of 125 PageID #: 18337
                                                                                   1
In this case documentNumber should be 328
The totalPages (for the session) is at the right side of the 1 of 125, so in this case 125
The transcriptStartPage should be what page this session starts on within the entire trial.  So for the first session, it is 1, and for subsequent sessions, it is 1 + the totalPages of previous session

For page, trialPageNumber and pageId is null for a few pages (perhaps first of each transcript).  We had been leaving out the first two pages and the last page of every input text file transcript from the Page entity in the database.  The first two pages contain the SUMMARY information and the last page contains the CERTIFICATION information.  All pages in between contain the PROCEEDINGS information which we do want to capture in the database.  The other (SUMMARY and CERTIFICATION) pages can be parsed, but left out of the Page and Line tables for now.




## Expected Output Format
Data in our relational database should be verified after running phase 1 only


