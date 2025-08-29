# Feature 2f: Phase 1 Parsing Multiple Transcript Formats

*** NOT READY TO IMPLEMENT = RETURN A WARNING IF SUBMITTED ***


*** put code and json in feature assets here ***
**
In the event that our configuration has input files that are pdf and that require conversion, we should modify any existing parsing code to use the code supplied in:

docs\feature-assets\feature-02\codesamples
convert-pdfs.ts
XXX.ts

Note there are a few different methods for doing pdf conversion in that file, the one that works (and is configured with config.json) is the apawn to pdftotext passing the parameters configured in config.json as command line switches.


We should have parameters that are passed to the conversions utility and should default as specified in 
config.json

XXX.json

**




[speaker identification]


Speaker aliases configuration.  There are various speaker aliases used throughout transcripts and they should be configurable.  This will allow us to minimize parsing errors where we might otherwise interpret text as a speaker alias.  We can default (in our main trialstyle.json) to have all possibilities and when we generate a specific trialstyle.json for each transcript text directory, we can include all but allow the user to prune them.

Witness Examinations
When witness are examined, the speaker aliases change to a convention using a question and answer syntax (where the questions are asked by an attorney and answered by the witness).  So in the transcript the speaker prefixes may take the following forms:
Q.
A.
Question:
Answer:
QUESTION:
ANSWER:
Q
A

Other variations used (usually during video depositions).  In this case, "THE WITNESS:" should refer to the witness on stand, as does "A:" and variations (e.g., ANSWER: ), but when we see "THE ATTORNEY:" it refers to the opposing attorney as QUESTION: (and variants).  The variants for QUESTION would refer to the attorney that called the witness and "THE ATTORNEY:" would refer to opposing counsel.  We might not know exactly which attorney, possibly we should assign this to the attorney on the opposing side that has most recently spoken by default or have a generic unidentified attorney for each side that can be used when we cannot identify the precise speaker.
THE ATTORNEY:
THE WITNESS:


The above are the variations found, the last one (only Q and A with no period), is perhaps the most risky for being confused during parsing, and we may want to only specify that one for certain transcripts that use it.  For now, let's configure all 3 pairs of prefixes above to be available to be matched during parsing as speaker prefixes.  Similarly, for "THE COURT", etc. we should specify available prefixes that we will attempt to match during parsing.


Note variations Q. and A., Question: and Answer: and Q and A 
Also AM, PM, AM and PM, Morning, Evening, PM1
*Verdict* (at beginning)
*Jury* (at end)

Perhaps we should generate configuration if not present and include parse order of files when we convert from pdf to text, or if we read text and no parsing config is available in that directory.

In this case we can remove isPaired and pairMateId, and have that functionality related to enum values


[speaker identification]



[sorting/ordering issues]
*****
Guarantee order of one field, maybe trialLineNumber or another field.  Is we select within trial and for PROCEEDINGS, sort trialLineNumber ascending, we should get a correct sequence.  Not sure if we should do a unique index on that if we might have duplicate lines in summary.


Could have a field be physical line number on page, that will hook up with text editor


Perhaps leave line number blank when cannot be parsed (in summary)
Just max at 25 lines per page across transcript
Have session line number and trial line number reflect up to 25 lines per page across page numbers of trial


Calc line numbers, put parsed ones in another field

Parse every line in transcript into Line table

Do not assume clean break of pages on transcript summary, certification

[sorting/ordering issues]



[Parsing Examples]

****

Also add intermediate summaries, broken down into parts

Can do auto-mode sort of input docs, do regex to see which type of files, then pick a strategy

First 3 chars on the left for line number, sometimes right justified:
  1 APPEARANCES CONTINUED:  Mr. David T. Pritikin
  2 FOR THE DEFENDANT:      Mr. Nathaniel C. Love


When we are parsing summary, break into sections we recognize for different reasons:
1) presence of middle delimiters (e.g., *, (), )()
2) keywords in caps, like TRANSCRIPT, APPEARANCES, etc., let's get a comprehensive list of these
3) 

Look for the plaintiff, defendants stuff, when we find it, can ignore the rest (except putting it into sections), so that we have everything covered

Another way of saying for the plaintiffs:
FOR CONTENTGUARD HOLDINGS, INC.:



****

[Parsing Examples]




TrialSection 

PROCEEDINGS
SUMMARY
CERTIFICATION
PAGEHEADER

SUMMARY_ORIGINAL
SUMMARY_ALLLINES
SUMMARY_CASELEFT
SUMMARY_CASERIGHT




******

** can move below to 2F, focus on getting existing transcripts working again **

For speaker identification, there are a few new variants for witness examinations and jury selection.  First within jury selection, we will sometimes see:
JUROR LEFLETT: 
or 
JUROR SUE GREEN: 

So it could be the juror's first name or first and last name.

For witness examination, sometimes (especially when the court intervenes), we will see: "THE WITNESS:" speaker prefix referring to the witness while the judge is interacting, and then often it will go back to Q. and A. (between attorney and witness).  We also need to handle just "Q" and "A" as speaker prefixes in some cases no trailing period is included.

******





Also make sure full cascade delete throughout for trials is available or at least designed in


Session.sessionType
currently 
MORNING
AFTERNOON
JURY_VERDICT

let's change to
MORNING
AFTERNOON
ALLDAY
EVENING

Suffixes for above:
PM1
AM and PM

Bench Trial_Jury Verdict
Trial Transcript - Morning 


US_DIS_TXED_2_16cv230_d74990699e16592_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed

District
US_DIS_TXED
Case Number
2_16cv230
Transcript Session (sort asc)
d74990699e16592

*** needs work ***


The following parameters should be included as well as a collection of files ordered automatically according to the best guess, and a collection of files that do not meet input patterns.

Include modes to check file date times of output txt files and also config file referenced, if nothing changed, do not reconvert the files (in other words if txt files more recent than both pdf and config input).

When we drop in a default TrialStyle.json, we can set a flag whether its been human reviewed and whether ready to go (maybe make an enum with states)

Our system should be able to do phase1 on all approved cases, or pick a specific one from main config (or from command line)

*** needs work ***



****
We can have a mode in trialstyle.json for the two different linePrefix types and and AUTO mode to figure this out during a test parsing phase of the first few pages of a few transcripts.  But this is not really necessary as it is simple enough to parse this and separate it from the text part of the Line.


****


**** this is incorrect simplify line prefixes ****
Line prefixes - these refer to the first few characters of every non-blank line in the transcript that typically contain a line number, a timestamp, or both.  We should configure the system to handle the variations and parse them directly (no need for regex) within the fixed amount of space required by the prefix.  In some transcripts there is a different line prefix within the summary and certifcation sections than there are in the proceedings sections.  In those cases, we can use summaryLinePrefix (for both summary and certification sections), and proceedingsLinePrefix for the main proceedings sections of the transcript.

We can use an enum value for this setting with possible values LINENUMBER or TSLINENUMBER

Parameters:
(either 2 digit number, or 2 digit number + timestamp)
summaryLinePrefix
proceedingsLinePrefix
*** do not need this anymore ***

**** Better version ?



***
Maybe have multiple modes to determine behavior of witnesses, vs. jurors, vs. attorneys
speakerPrefixMode - we can have a few variations of how strict we want to be with variations of Q., Question, etc.

We may need to have witnessSpeakerPrefixMode, jurorSpeakerPrefixMode, attorneySpeakerPrefixMode as there are nuances to each.  For example, the way we match names per case as we want.  The styles of the court reporters may differ per trial.




***


****
We should also have a parameter maxNumberedLines (default to 25) as this is what is typical of judicial transcripts.  That parameter dictates that we will typically have 25 lines per page or less, after which we expect another page header.

We may or may not have a page break character for each page, and we should have an enum describing the type or absence of a page break character parameter for each page. Let's default that one to no page break character, and have values for typical page break characters as well.  We can change parameters within the pdf to text parsing to affect the presence of this character (more on that below).  But in the abscense of this character we should be able to determine a new page by recognizing the pattern of the page header which occurs on absolutely every page of each transcript file.

Or just have fixed amount to remove from line prefix (see Intellectual Ventures, it is 6 spaces throughout).  The only place not present, is in page headers there is no padding

Parsing instructions perhaps should be dropped in directory with pdf files instead of in win vs. mac config files

Let's have parsing-parameters.json in the directory with the data files.  That will override defaults in main json which can override defaults hard-coded.


****



****
First phase, move params to config file

Model line prefixes

Parameters:
(either 2 digit number, or 2 digit number + timestamp)
summaryLinePrefix
proceedingsLinePrefix

pageHeaderLines (default 2, but can be 1 or 3, if its 1, need to parse page number from right, after page id)

statementAppendString = the character or string used to append statements back together.  I think currently using newline

summaryCenterDelims = ")(", "()", "*"


fileSortingMode - dateAndSession (find date, then morning afternoon, or AM, PM either one, either case, anything else goes last), let's just do modes for the three methods below



otherwise parse this or should be alpha file sort:
US_DIS_TXED_2_16cv230_d74990699e16592_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed

NOTICE OF FILING OF OFFICIAL TRANSCRIPT of Proceedings held on 10_1_20 (Trial Transcript - Afternoon

Genband_January 11, 2016 AM.txt
Contentguard_ NOVEMBER 12, 2015 AM.txt



Update schema
- line prefix
- plaintiff/defendant
- parsed trial line number
- calc trial line number
- move sectionType to Line (from Page)
- calc overall trial line numbers
- page sections, put back together summary and certification sections
- also have facility to parse into smaller subgroups




Perhaps leave line number blank when cannot be parsed (in summary)
Just max at 25 lines per page across transcript
Have session line number and trial line number reflect up to 25 lines per page across page numbers of trial




**
Note variations Q. and A., Question: and Answer: and Q and A 
Also AM, PM, AM and PM, Morning, Evening, PM1
*Verdict* (at beginning)
*Jury* (at end)

Perhaps we should generate configuration if not present and include parse order of files when we convert from pdf to text, or if we read text and no parsing config is available in that directory.


**


****
Note when parsing, there may be whitespace on the left of any headers, find the first non-whitespace chars, and try to figure if header is in place.  This may be tricky within summary.

We may want to configure max-whitespace chars at the left of any line prefixes.

In some cases, we have whitespace characters at the beginning of each line (except page header), based on the way that the pdf to text conversion places the text.  So we want a parsing parameter, linePrefixWhitespace as an integer with the number of characters expected before we get to the line prefix.  Note the page header does not have the same whitespace and should be parsed separately.

We should also have a parameter maxNumberedLines (default to 25) as this is what is typical of judicial transcripts.  That parameter dictates that we will typically have 25 lines per page or less, after which we expect another page header.

We may or may not have a page break character for each page, and we should have an enum describing the type or absence of a page break character parameter for each page. Let's default that one to no page break character, and have values for typical page break characters as well.  We can change parameters within the pdf to text parsing to affect the presence of this character (more on that below).  But in the abscense of this character we should be able to determine a new page by recognizing the pattern of the page header which occurs on absolutely every page of each transcript file.

Or just have fixed amount to remove from line prefix (see Intellectual Ventures, it is 6 spaces throughout).  The only place not present, is in page headers there is no padding

Parsing instructions perhaps should be dropped in directory with pdf files instead of in win vs. mac config files

Let's have parsing-parameters.json in the directory with the data files.  That will override defaults in main json which can override defaults hard-coded.


****





center delims (on summary page), can be:
)(
()
*






Calc line numbers, put parsed ones in another field

Parse every line in transcript into Line table

Do not assume clean break of pages on transcript summary, certification



****




## Overview

We have the system working reasonably well through phase1, phase2, and phase3 with the following basic responsibilities of each phase:

Phase 1 - gets pdf and/or text files for a trial transcripts imported into our relational database, handling any text format variations, pdf converter artifacts, etc.  Once a transcript directory has been imported we expect the information in our relational database to be in a consistent predictable form.  We will enhance phase 1 in this feature requirement to handle some additional variations in transcript formatting.

Phase 2 - Using phase 1 data in the relational database, gleans meaning from the lines of the transcript and fills out additional tables with statements attributed to speakders and all of the court participants parsed and related.

Phase 3 - Allows additional analysis with accumulators and markers to do more custom and case, court, attorney, or judge specific analysis, looking for patterns of speech to identify important exchanges and moments in the trial.


## Requirements
We want the current main test transcript for caseNumber 2:19-CV-00123-JRG to still work as it currently does when we apply downstream phases 2 and 3 to create derived data, reports, and searches.  After we update the parsing of phase 1 to handle additional variations in transcript formats, we can use the output of our current tests to ensure that we have not broken any existing functionality.  For example we know that we should have 57 WitnessCalledEvent records in phase 2, and that our reporting should create summary output to match versions we have captured from previous tests.

The variations in the transcripts are relatively minor and fall into a few categories:
1) File naming conventions and sorting - the trial transcripts are not named consistently, and we will define several variations
2) Line prefixes through transcript - the left most portion of each substantive (non whitespace) line, may have a line number, a timestamp with a line number, some different whitespace patterns, and spacing in between lines with text
3) There are some variations in court directives, speaker conventions, etc. which will mostly affect phase 2, but we need to capture everything correctly

In addition, some schema changes and parsing will need to be modified to better handle multiple trials in one database.  This may come in to play more in phase 2 and phase 3, but let's remain aware that multiple trial transcripts will be in our database at one time, and we will need to partition and select data by Trial.id or equivalent key to isolate the correct data.


We should add a section to the input configuration json for phase1 parsing parameters to configure our system.


***
Schema changes
- add caseHandle (used for file output)
- add line prefix
- capture trial total lines any other data we need for each line
- add an actual day/time timestamp to each line (only will help with vocallife so far)
***



## Input Sources




## Expected Output Format
