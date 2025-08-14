# Feature 2C: Phase 1 Parsing issue cleanup

## Overview

We have some parsing issues that need to be cleaned up but we are mostly in good shape from previous efforts in Feature 2, and Feature 2B.  The changes here are meant to clean up some nagging issues and also make the code more resilient to future change by refactoring the regular expressions so we can track if we have changes involving parsing, and to have additional options to deal with parsing issues going forward.

## Requirements

Requirement 1 - Abstract regular expressions and initialize from file

Wherever we are using regular expressions to parse anything out of the transcripts, or during phase 2, let's move the regex out to a configuration json file and build a class to load them and save into our prisma DB.  Let's also abstract the regular expression, so we can replace it with another block of code that can find text patterns we need, show the position and length of the text matching, and extract variables.  We can persist details of those as well into the database and load from json.  This way we can configure and switch parsers for different parsing functionality as the situation requires.  We can implement a loader that can the named parser from the database and provide an implementation to the code that can call either type of parser (regex or custom).

We will do addition generic parser implementations (that will parse with an expression like regex) but for now, just abstract the functionality in an interface that we can have multiple implementations of, create an enum to switch between REGEX and CUSTOM.  If CUSTOM, we would need a custom implementation implementing the interface to parse a particular block.  Let's generate a few of those as well to demonstrate the feature for known parsing issues in our system.  One takeaway from this is that anytime an expression that we use for parse changes, it will be in a data file and separate from code changes so it is easier to spot, and also easier to replace with a custom parser (within which we can create debug output to see what's going on when we have problems).


Requirement 2 - Attorney parsing

Attorney parsing vs. attorney firm parsing.  We are mistakenly parsing this block and creating an attorney named "FABRICANT LLP".  Here is the block in the summary (with the left leader line numbers already stripped out):

MR. ALFRED R. FABRICANT
MR. PETER LAMBRIANAKOS
MR. VINCENT J. RUBINO, III
MS. AMY PARK
MR. ENRIQUE ITURRALDE
FABRICANT LLP
230 Park Avenue, 3rd Floor W.
New York, NY 10169

Let's expand our detection of law firms to look for "LLP" as an indentifer of a law firm in the summary section that includes the attorneys and law firms.  You might include the following variants:

LLP — Limited Liability Partnership (also L.L.P.)
LLLP — Limited Liability Limited Partnership (L.L.L.P.)
LLC — Limited Liability Company (L.L.C.)
PLLC — Professional Limited Liability Company (P.L.L.C.)
PLLP — Professional Limited Liability Partnership (P.L.L.P.)


Also, we should be able to handle attorneys that are parsed at the beginning in summary and do not have a title associated.  If we encounter during the transcript a MR. XYZ or MS. XYZ and we have only saved the attorney as "JOHN XYZ" without a title - as long as there is only one attorney matching the last name in the database, we can safely associate the attorney.  And in this case, we should update the attorney record with the newly discovered title and the expected speakerPrefix, so upon first encounter of the attorney, we can resolve the title, and match speakerPrefix more easily going forward (without a scan of the attorney table for last name as we need to do when we do not have a title match).


Requirement 3 - Address parsing

Add a field to the address table called fullAddress.  Append all address lines into one printable address.  Also index on that field so that we can upsert with addresses.  We keep creating new versions and associating different addresses, this way we can see if the address has already been created before re-inserting (and we have a bonus field to display address all in one shot).


Requirement 4 - Resolution of speakerPrefix with Q. and A.

We seem to be resolving the "Q." prefix in witness examinations to be the attorney and associating those in StatementEvent with Speaker records.  But we are not doing the same for the witness and are persisting records with "A." as speakerPrefix.  It should be an upper case rendition of the witness's name prefixed by WITNESS, e.g. "WITNESS SCOTT HAYDEN", do not save the speakerPrefix in the Speaker table as "A."  This will make it consistent with the way we store juror and other court speakers.  We will sometimes want to use this version when exporting data so it should be a nice format to read so the user knows who is speaking without needing to figure out context.

Let's also add a field called speakerAlias to the StatementEvent table.  It should contain whatever speaker prefix we parsed to determine the speaker (despite whether we changed it or filled it in based on context).  So if we have

MR. ATTORNEY:		Your honor, may I approach.

The speakerAlias would be: "MR. ATTORNEY"

but if we had started questioning a witness, and MR. ATTORNEY was questioning "JOE WITNESS" as follows:

Q.	Mr. Witness were you an employee of XYZ corporation, and in what capacity.

A.  Yes, I was a staff engineer for XYZ corporation starting in 2012.

In above case, we have speakerAlias of "Q." and "A." respectively in StatementEvent but in the associated Speaker record, we resolve the speakerPrefix to "MR. ATTORNEY" and "JOE WITNESS" respectively


Requirement 5 - Make sure we are not getting the following warning for any witnesses
"Missing witness or examination type for witness called event"

We would sometimes see this in previous runs and I was not sure whether we are missing some associations.  Let's look out for this as we test this feature and resolve if it occurs.


## Input Sources
Same as feature-02.md and feature-02B.md, the various forms of the input data for transcripts.

## Expected Output Format
Data in our relational database should be verified after running phase 1 only


