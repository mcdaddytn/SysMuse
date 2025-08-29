# Feature 2E: Phase 1 Parsing Multiple Transcript Formats


## Overview

We have the system working reasonably well through phase1, phase2, and phase3 with the following basic responsibilities of each phase:

Phase 1 - gets pdf and/or text files for a trial transcripts imported into our relational database, handling any text format variations, pdf converter artifacts, etc.  Once a transcript directory has been imported we expect the information in our relational database to be in a consistent predictable form.  We will enhance phase 1 in this feature requirement to handle some additional variations in transcript formatting.

Phase 2 - Using phase 1 data in the relational database, gleans meaning from the lines of the transcript and fills out additional tables with statements attributed to speakders and all of the court participants parsed and related.

Phase 3 - Allows additional analysis with accumulators and markers to do more custom and case, court, attorney, or judge specific analysis, looking for patterns of speech to identify important exchanges and moments in the trial.

Note that Phase 1 is working pretty well as is, so we want to make the schema changes here, incorporate the new configuration, bring in the new code for pdf to text conversion, but then incrementally fix the parsing issues so as not to disrupt what is working.  In the input section we describe how to alter configuration to test for our new enhancments using the same testing dataset as for previous versions where we got all phases working.


## Input Sources

The test case we are concerned with is expressed and available in a number of ways in terms of source data:

1) config/example-trial-config-mac.json - this is the configuration run that references the full trial transcript (12 large files, ~ 2.65 MB of text) that is too big for the LLM context.  We can run this test configuration and then reference the data in the database once parsed.

2) Files under docs\feature-assets\feature-02 are mentioned throughout this document and have specific excerpts from new transcripts from an additional 9 cases.  This feature aims to add flexibility to parse any of those transcripts into the system.  There are minor variations in the transcripts that are described in this document that we must adapt the code to handle.  Note that the vocalife v amazon case also has one sample here that has the latest in terms of whitespace, etc. from the current pdf to text conversion, so we should refer to these files for variations across all cases that we are implemeting parsing options to handle (this case's sample with new conversion is the file :
NOTICE OF FILING OF OFFICIAL TRANSCRIPT of Proceedings held on 10_1_20 (Trial Transcript - Afternoon.txt

3) Configuration - There are several configuration files affecting the system.  At the top level we pass in a configuration json, example (example-trial-config-mac.json) that points to an input directory.  This configuration file should be enhanced to reference two other json config files (which can be in same project config directory:  pdftotext.json and trialstyle.json (these are both new config files).  As a model for pdftotext.json, we can use the example in docs\feature-assets\feature-02\codesample .


So a summary of configuration:
main configuration, example:

example-trial-config-mac.json (or example-trial-config-pc.json)  - refers to the paths on a particular machine, and can link into the environment loglevel, elasticsearch, etc. on that machine to dictate how the system should be run.  We should add to this references to pdftotext.json and trialstyle.json (should have defaults in our project config), that can be changed for variations in how to import and process data.  The trialstyle.json can be dropped into the output directory and be individually edited between the phase where we convert pdf to text and when we import into our relational database to allow the user to modify settings to import data correctly.

pdftotext.json - this is a modified version of docs\feature-assets\feature-02\codesample\pdftotext.json that was used to configure convert-poppler.ts (this code should be moved into our system to replace current pdf to text conversion).  We can move the paths and subdirectory processing to our main configuration which can then be machine specific, where the pdftotext.json will just now set options to run the convert-poppler.ts functionality.

trialstyle.json - new configuration we will establish in this feature reqwuest that will contain all parameters dictating how we will interpret text files being input and parsed to insert into our relational database.  We can have a default version referred to by our main configuration, but it can be copied into output directories (and/or subdirectories if processing multiple trials), and modified.  This will contain parameters for:
- file conventions of input files
- ordering of input files either through patterns or a direct ordered collection showing the order
- parameters dictating specific nuances in the trial transcript that will direct our system on how to parse into the database

So let's start by updating configuration example-trial-config-mac.json to use for our tests.  Let's set 
  "inputDir": "/Users/gmac/GrassLabel Dropbox/Grass Label Home/docs/transcripts/42 Vocalife Amazon",
  "outputDir": "./output/transcripts/42 Vocalife Amazon",

That will create the setup where we can call the pdftotext conversion and have the output similar to our previous test set with converted text files accessible for parsing.


In directory docs\feature-assets\feature-02\codesample

we have convert-poppler.ts which we should integrate into our project to replace the current pdf to text conversion.  These options within the configuration file:
  "processSubDirs": true,
  "inputDir": "C:\\docs\\rj\\transcripts\\pdf",
  "outputDir": "C:\\docs\\rj\\transcripts\\txt",

should be configured in the high level config json (e.g.,  example-trial-config-mac.json, rather than in pdftotext.json, so they should be moved.  The settings described above will get the Vocalife Amazon case which is our current test available for testing in the output subdirectory of the source code project, making it available for searches.

So we want to be able to parse the same case that has worked previously (Vocallife v Amazon) first, make sure we have functionaity as before, and then test the new samples included in docs\feature-assets\feature-02\transcripts that will showcase more variations that our new schema and code changes will facilitate.  Note these samples are incomplete, but just present for reference to see variations in transcripts - when we test them, we will provide a configuration to the full set of pdf files as we describe above for initial test case Vocalife Amazon, so let's not import any of these partial transcripts unless to test a specific feature when we get to testing parsing variations.

We are also adding the ability to process multiple subdirectories and we can drop specific configuration files per trial into the outputDir (or created subdirectorires) that will help us configure the particular trial to be imported into the database (so we can drop trialstyle.json in that directory).  We can configure defaults for trialstyle.json in our main config directory and use that to copy in to the output dirs.  We should have the system capabile of processing many subdirectories by converting the pdfs then running subsequent phases, but for initial test, we will just test the single case (Vocalife Amazon).

We may want a new "phase" although it can be called something different (run before phase1) to convert input files for text and generate trialstyle.json that we can modify before running phase1.  We should be able to run the pdftotext conversion phase from the cli separately and can run it before phase1.  We are adding a step for human intervention between the conversion of pdf to text and running phase 1, so we want to be able to trigger the initial pdf convert from the client interface (referencing our configuration files - we always will need a configuration), so we can run this phase first, then check the results, possibly alter trialstyle.json that is generated within our output directory before proceeding with phase 2.


## Expected Output Format
Data in our relational database should be verified after running phase 1 only



## Requirements
Integrate code from here:
docs\feature-assets\feature-02\codesample
to replace our current pdf to text conversion.  Use the pdftotext.json configuration, except remove the paths since we will be driving that from the main platform specific configuration (e.g. example-trial-config.mac.json).  For now we will just be testing with text files that have already been converted using this code and the supplied configuration settings, but we want this integrated into this system so we can start with a directory, that has subdirectories of each trial transcript in pdf format ultimately, but right now testing from some text files that we will configure one directory at a time.

We want the current main test transcript for caseNumber 2:19-CV-00123-JRG to still work as it currently does when we apply downstream phases 2 and 3 to create derived data, reports, and searches.  After we update the parsing of phase 1 to handle additional variations in transcript formats, we can use the output of our current tests to ensure that we have not broken any existing functionality.  For example we know that we should have 57 WitnessCalledEvent records in phase 2, and that our reporting should create summary output to match versions we have captured from previous tests.

In future enhancements we will provide options and new code for the actual pdf to text conversion, but for this feature we will simply use the sample provided to figure out how to manipulate options to get the provided text samples into our relational database cleanly.


[Configuration]


trialstyle.json

This configuration file should contain the parameters that affect the parsing of individual trial transcripts that might have some different conventions in terms of naming files, spacing, handling of court directives, witnesses, and difference in the way the headers and session transcript summaries are formatted.  We will generate a trialstyle.json during the initial pdf parsing and put a version in each directory with the converted text files that the user can manipulate before running phase 1.  The trialstyle.json can contain a list of transcript text files to parse in order and also a list that did not match the file naming convention that is used to recognize the file patterns and to order files appropriately.  These can also be reordered by the user before running phase 1.  In the system-side trialstyle.json (which is used to copy defaults for each transcript folder version), we also have the ability to set some configuration parameters (like fileConvention) to AUTO so we can automatically apply a few file patterns of known file name conventions to find the correct one and output that in the transcript specific trialstyle.json.



[parameters for trialstyle.json]


Parameter changes

We should add a section to the input configuration json for phase1 parsing parameters to configure our system.  Here are some parameters that we will need to change to handle variations in transcripts:


fileConvention - the mode to select the file convention expected.  Typically this will be set to AUTO in the default configuration, but when we generate a trialstyle.json for each folder of output transcript text files, we can set this to the discovered file convention (discover by applying patterns to determine which pattern we have on a one or more files in the directory - probably best to try at least 3 files, and take at least 2 matching the convention to assert the correct file convention.

We can parse the linePrefix from each line (except pageHeader lines and whitespace lines).  It is generally a one or two digit line number and in some cases it has a timestamp first (hh:mm:ss) and then a one or two digit line number.  After the line number should be at least one space and then the text of the line that should be stored in Line.text (the prefix should be stored in Line.linePrefix).



pageHeaderLines (default 2, but can be 1 or 3) - See below description of pageHeader parsing rules that will use this setting


statementAppendMode = When StatementEvent.text is constructed from multiple lines, we are adding a string between lines to append together.  Let's make that a configurable behavior.  I think we are currently using a newline, but let's have an option for it to be a space, or variations of newline characters.  Let's default to space and have an intelligent way of putting lines back together.  Make sure words are separated by a space when the otherwise would not be, but if a space already exists, we do not need to add more.  For newlines, we can just have variations of newlines for OS - make this an enum that we can set in config and default to space (with intelligence to not have extra spaces).


summaryCenterDelimeter - The deimiters within the summary section that separate the left hand side (with the name of the case, plaintiff and defendant names) and the right hand side (with docket information, etc.).  Some possible values that are encoutered in different transcripts:
")(", "()", "*", "(", ")".  Let's have an enum that will have a value for each of the preceding and also one for AUTO which will search for any of the previous delimiters.  Sometimess it is inconsistent within a case which one is used (for example some sessions may use ")(" while some use ")", so the AUTO mode would be needed to search for each possible delimiter.


pageHeaderLines - number of lines used by the page header, described below.  We should parse all of the lines of the page header into field Page.headerText


fileSortingMode - dateAndSession (find date, then morning afternoon, or AM, PM either one, either case, anything else goes last), let's just do modes for the three methods below.

We can have an "Auto" sorting mode that will find the naming convention among known conventions and then provide a sorting method.  We are either sorting by the date and the suffix (which would indicate a morning, afternoon, or special session), or by a document number within the file name.


These parameters should be added to the configuration json under a parsing section (except statementAppendString, can be added to another section), in the configuration json files for parsing, like for example:
example-trial-config-mac.json


[parameters for trialstyle.json]


[file naming conventions]

We should be able to detect and parse three different naming convention styles of cases, starting from the most typical.  Files that follow the pattern should be parsed to figure out correct order and place in an orderedFiles list, the others in unidentifedFiles list to be sorted out by the user in the trialstyle.json that is generated and kept with the converted txt files.  We should have a parameter within trialstyle.json called fileConvention, an enum type with the following values:

AUTO - figure out what the convention is using patterns.  Typically this is the default in the system default trialstyle.json and when we create a trialstyle.json for each file set to be edited by the user, we can put the actual detected value.

DATEAMPM - to parse files with format described below
DATEMORNAFT - to parse files with format described below
DOCID - to parse files with format described below

DATEAMPM - this format typically has a plaintiff name abridged, or Plaintiff v Defendant abridged names, with the date in format like "January 11, 2016", followed by "AM", "PM" or "AM and PM".  In some cases we see "AM1" or "PM1" - these may be additional sessions during morning or evening respectively, but sometimes they are just duplicate files.  We should just list files with these suffixes (AM1 or PM1 or other unknown), as unidentified files.  These should be sorted by date, then session identifier "AM", "PM", or "AM and PM" last.  So we are sorting morning before afternoon within date.  When "AM AND PM" occurs it is typically the only session transcript for the particular date, so to be safe let's put it last in sorting within date.

Example file names (this is the most prevalent of the patterns, so lots of examples here including exceptions that should not be ordered automatically:

Genband_January 11, 2016 AM.txt
Contentguard_ NOVEMBER 12, 2015 AM.txt
Contentguard_ SEPTEMBER 22, 2015 PM1.txt
Simpleair January 17, 2014 PM.txt
Simpleair January 18, 2014 AM and PM.txt
Dataquill June 18, 2015 PM.txt
Dataquill June 18, 2015 Verdict.txt
SSL V Citrix June 14, 2012 AM1.txt
SSL V Citrix June 14, 2012 PM1.txt
SSL V Citrix June 14, 2012 AM.txt
SSL V Citrix June 14, 2012 PM.txt
Personalized Apple March 15, 2021 Jury Selection.txt
Personalized Apple March 17, 2021 Trial.txt

[typo in this case with Plaintiff name - we should sample a few files in each directory to pattern match in AUTO mode because of inconsistencies such as this]
ALuvNCare V Royal King October 9, 2013 PM.txt
LuvNCare V Royal King October 7, 2013 AM.txt
Intellectual Great West March 13, 2019 AM and PM.txt
Whirlpool V. Tst March 10, 2017 AM and PM.txt
TQP V 1800Flowers November 25, 2013 Notes Verdict.txt

Salazar V. Htc Corporation May 10, 2018 AM and PM.txt
Salazar V. Htc Corporation May 11, 2018 AM and PM.txt
Netlist V Samsung November 21, 2024 TRIAL.txt
Netlist V Samsung November 22, 2024 TRIAL.txt
Netlist V Samsung September 26, 2023 Markman.txt
Mobile Tech V HTC September 19, 2016 Jury Selection.txt
Kaist V. Samsung June 15, 2018 AM and PM.txt
Intellectual Ventures I Llc V. T Mobile February 8, 2019 AM and PM.txt
Flexuspine V. Globus Medical August 15, 2016 Jury Selection.txt
Flexuspine V. Globus Medical August 18, 2016 PM.txt
Flexuspine V. Globus Medical August 19, 2016 AM and PM.txt
Core Wireless V Apple JUly 6, 2015 Motion Hearing.txt
Core Wireless V Apple Pretrial Hearing.txt
Biscotti V Microsoft June 9, 2017 AM and PM.txt
Alfonso V Google February 10, 2017 PM.txt
[in this case within "19 Alfonso Cioffi Et Al V. Google" foder , one file does not have case name]
July 6, 2017 Motion Hearing.txt
WI-Lan HTC October 23, 2013 Verdict.txt
Wi-Lan Apple October 16, 2013 AM1.txt
Gree Supercell September 17, 2020 AM and PM.txt
Dataquill June 18, 2015 Verdict.txt

The above has a lot of exceptions where Verdict or Jury Selection or Motion Trial etc. mentioned and we will not know how to order those within the trial transcript set without parsing out the dates from within the file, so for now just put them in unidentifedFiles list of TrialStyle.json that is output with in the directory with the files and we will use that to order the files when we do phase1.  The user will have an opportunity to edit the file and place the files in order so our "AUTO" mode generation can just get the files ordered that match the pattern.


DATEMORNAFT - this format has a shortened date format (e.g., 10_1_20) and either Afternoon or Morning as session identifier.  These should be sorted by date and by session (Morning followed by Afternoon).

Example file names:
NOTICE OF FILING OF OFFICIAL TRANSCRIPT of Proceedings held on 10_1_20 (Trial Transcript - Afternoon.txt

DOCID - this has abbreviations for court and district and an embedded document id that seems to be sortable in ascending order to correlate with dates and times of sessions.  So if we parse out that document id, just sort the files ascending by that.

Example file names:
US_DIS_TXED_2_16cv230_d74990699e16592_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt
US_DIS_TXED_2_16cv230_d74990699e16620_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt

So for these, break it into:
District
US_DIS_TXED

Case Number (similar to caseNumber parsed within trial, but with "_" instead of ":" and "JRG" cut off)
2_16cv230

Transcript Session (if we parse out this part and sort ascending, we get the files in chronlogical order)
d74990699e16592


With with the above components (and any other potentially relevant components of the file name) extracted, insert into a json field and save with Session record to Session.metadata


[file naming conventions]


[Configuration]



[parsing requirements]

[general parsing changes]

Most of the differences in parsing among the different trial transcripts are in the summary pages, the certifications and the simple variance to the line prefixes within the proceedings section.  There are slight differences in the page headers.

The court directives may be different so we should expect to parse them and then see the results, so we can incorporate standard ones back into the system, and pair them as appropriate.  More examples are provided in this document as well as updates to the pairing functionality.

In the previous version, we only parsed the PROCEEDINGS section into the Line entity, but now we should change that and include lines from the SUMMARY and CERTIFICATION sections.  We will also need to pay mind to page headers to know for sure we are on a new page.  I am not sure whether we were relying on a page break character previously, but we should not and rather just know when we have a page header as it is easy to recognize with a pattern and easy to differentiate from all other lines.  We should also remain cognizant of the 25 (or whatever configured) non-whitespace lines and if we go above that, we should raise a warning that we have not seen a new page header when expected.  In any case, we will be parsing every non-blank line in the transcripts into the Line table before doing additional parsing, and we will be calcuating line numbers within a page, within a session, and within the trial itself.  We will also parse the line numbers from the transcript, but in some cases (like when there is page header pdf conversion corruption), we cannot rely on the parsed values.

We must not rely on the trialPageNumber as parsed out of the pageHeader as it can be corrupted (as can the pageId) when they bleed into each other.  Rather we should calculate trialLineNumber and just parse that number on the last line of pageHeader (or end of the first line for a 1 line pageHeader) into a new field called parsedTrialLine, but we cannot count on it.  Similarly, we will parse the pageId but it is not used for anything besides a reference.  Our calculations of lines within pages and pages within the trial (which we can parse from page header), are sufficient to calcuate line number within the page, within the session, and within the entire trial.  We should also calculate Trial.totalPages at the end of parsing a trial and update the trial record.  See below for more information and samples to parse pageHeader.

We will need to move Page.documentSection to the Line entity as we will no longer have clean page breaks between sections, so we must track it by line.  The sequence is still the same and is relatively easy.  We start out in SUMMARY and then once we have encountered line for start of PROCEEDINGS (contains only whitespace and "P R O C E E D I N G S", we are in PROCEEDINGS, until we find line with only whitespace and "CERTIFICATION", then we are in CERTIFICATION section.

The variations in the transcripts are relatively minor and fall into a few categories:
1) File naming conventions and sorting - the trial transcripts are not named consistently, and we will define several variations
2) Line prefixes through transcript - the left most portion of each substantive (non whitespace) line, may have a line number, a timestamp with a line number, some different whitespace patterns, and spacing in between lines with text
3) There are some variations in court directives, speaker conventions, etc. which will mostly affect phase 2, but we need to capture everything correctly

In addition, some schema changes and parsing will need to be modified to better handle multiple trials in one database.  This may come in to play more in phase 2 and phase 3, but let's remain aware that multiple trial transcripts will be in our database at one time, and we will need to partition and select data by Trial.id or equivalent key to isolate the correct data.  For example, construction of speakerHandler would need to take this into consideration - one strategy would be to append trial id on speaker handle (I think we are already doing this for the judge), but doing it on other speakers would guarantee limiting to within the trial.  Any other similar code changes that need to happen to support multiple trials should be analyzed and suggested.

Fields to calculate for line numbers and ids:

Line.pageId (think this is foreign key to Page)
Line.lineNumber
Line.trialLineNumber
Line.sessionLineNumber

Line.parsedTrialLine (new, this is parsed from page header, before was stored in trialLineNumber but we cannot rely on it and must calculate trialLineNumber).

Page.pageNumber
Page.trialPageNumber
Page.pageId (parsed out of header, usually sequential, but has some parsing issues when page numbers get above 99 (physically in the pdf there is an overlap between pageId and trialLineNumber), so we should calculate both.  The pageId in this case is an increment from the last one - we can just grab the first one in each transcript and calculate the rest.  Use the parsed number to verify and issue a warning if not a match, but if page number over 100 on a 1 line page header, we will expect this).

Note that sometimes non-blank lines have some text but no line number (no linePrefix), but we want to parse the text.  In that case, we can just assign the previous line number to the line (in terms of the parsed line number), but we can choose to increment the calculated line numbers (sessionLineNumber, trialLineNumber).  



[general parsing changes]


[court directive changes]
There are video depositions that are not explicitly started with the text we are picking up to create WitnessCalledEvent, so we will need to use court directives to find these and we need to have more values filled in and pairing working.  

First off, I am not sure that court directives are paired properly.  If there pairMateId meant to refer to the other CourtDirectiveType that is paired, it seems to refer to its own id (the id and pairMateId seems to be the same for any paired directives and I do not see how this is supposed to work with the text in pairMateId within court-directives.json.  
In addition, let's make sure that we have all the following variations for videos covered.  We have some additional ones when the video is paused and continued, with a few variations, let's incorporate those as well. 


(Video playing.)
(Video clip playing.)
(Video clip resumed playing.)

(Videoclip played.)
(Video played.)
(Video clip played.)
(Video clip plays.)

(Videoclip stopped.)
(Videoclip ends.)
(Video clip paused.)
(Video stopped.)
(Videoclip interrupted.)
(Videoclip continued.)

[court directive changes]



[pageHeader parsing requirements]

We will use the pageHeaderLines configuration setting to determine this behavior and we must parse each a bit differently as the data fields can be distributed across the lines.  If it is all in 1 line, we have a situation where some of the fields after being converted from pdf to txt will bleed into each other corrupting the fields for pageId and parsedTrialLine.  We should have an AUTO mode in the default configuration that can attempt to figure this out by parsing the first few pages of a transcript to find page headers and figure out how many lines they are occupying.  When the trialstyle.json is dropped in an individual transcript directory, this value can be filled in from the attempt to parse sample pages.


Here is an example of a 1 line pageHeader without bleed:
<begin>
Case 2:13-cv-01112-JRG Document 1146 Filed 03/08/16 Page 1 of 127 PageID #: 69169 1
<end>
and one with bleed (where the pageId overlaps the parsedTrialLine, so we cannot rely on parsed values and must calculate these values by maintaining sequences)
<begin>
Case 2:13-cv-01112-JRG Document 1146 Filed 03/08/16 Page 10 of 127 PageID #: 6917810
<end>

Here is an example of a two line pageHeader:
<begin>
Case 6:15-cv-00201-JRG-KNM Document 242 Filed 08/25/16 Page 12 of 91 PageID #: 12
                                                                                7766
<end>

and a three line pageHeader:
<begin>
Case 2:12-cv-00068-JRG-RSP Document 257 Filed 11/27/13 Page 1 of 106 PageID #:
                                                         10252
                                                                                                                           1
<end>


Variants of pageHeader

Single line:
Case 2:13-cv-01112-JRG Document 1146 Filed 03/08/16 Page 1 of 127 PageID #: 69169 1

Single line where page number bleeds into PageID
Case 2:13-cv-01112-JRG Document 1146 Filed 03/08/16 Page 10 of 127 PageID #: 6917810

When pageID and page number bleed together, we can just parse the PageID as a five digit number and the rest as the parsed page number, but we cannot use it and must calculate our own page numbers since we cannot rely on this.  Similarly, we can just calculate the pageId as a sequence that continues from the last values that we can rely on (where there was not blead between pageId and parsedTrialLine).


[pageHeader parsing requirements]



[linePrefixes]
There are really only two variations of linePrefixes that we have encountered in the transcripts.  Usually within the summary we only have line numbers but sometimes, we have the first line with a timestamp also.  Generally, the proceedings sessions of one trial vs. another are consistent as to which linePrefix style is used, but in any case we can dynamically figure out and parse the line prefix (and note now we always want to save the parsed line prefix to the Line table).  Because different line prefixes may show at different times, we should just be aware of the major variations, and capture the data when it is available - and most importantly, save the linePrefix separately to leave the remaining text to be saved to Line.text that will be aggregated and analyzed for its content throughout the system.

Here are examples of the two variations of linePrefix:

[line number only - variations of 1 digit and 2 digit line numbers]


14  
                                  P R O C E E D I N G S
15  

16                        (Jury out.)

17                        COURT SECURITY OFFICER:         All rise.

1    Mr. McAteer.

2                         COURT SECURITY OFFICER:         Yes, sir.

3    All rise for the jury.

4                         (Jury in.)

[line number only - variations of 1 digit and 2 digit line numbers]


[timestamp and line number, with variations, note sometimes line number only mixed in]

08:30:35    9              MS. PARK:     Yes, Your Honor.

08:30:36   10              THE COURT:     Please proceed.

1                         P R O C E E D I N G S

01:22:56    2            (Jury out.)

01:22:56    3            COURT SECURITY OFFICER:       All rise.



09:15:45    1                         P R O C E E D I N G S

09:15:45    2            (Venire panel in.)

09:15:52    3            COURT SECURITY OFFICER:       All rise.


[timestamp and line number, with variations]


[linePrefixes]


[whitespace]

Note that there are many all whitespace lines within the transcript, but sometimes we will see text appear in the line without the line number when no text is in the previous line with the line number.  So we can consider text on a line with no line number part of the preceding line with a line number in those cases so that our line records in the database have all the relevant text in the system.  This does not happen very often, but we have the facility to just calculate the line number as whatever latest one is in preserved state of ordered parsing.

[example]
14  
                                  P R O C E E D I N G S
[example]



[whitespace variants]


Additional whitespace characters:
***************************************
_______________________________________
---------------------------------------

The above are examples of additional character strings that we can treat as whitespace when they occur on lines by themselves with whitespace.  In other words, these are characters used by the court reported to delineate a new section just as additional line returns would do, so we can add these characters in to be considered like whitespace only when on lines without any other substantial text characters (*, _ and -).  Note that * is used as one of the summaryCenterDelim choices, so it is not always ignored, just when it is on a line with whitespace only (and other character instances repeated).  These may occur on numbered lines (lines with linePrefix with a line number) and may be capture in Line entity, but we can ignore the text for the purposes of parsing further into relevant trial data.  We can capture these in the Line database when appropriate, but we should not be including this text for purposes of parsing anything in the summary (these text strings should be ignored and are only useful to make the text more human readable).

[whitespace variants]

[whitespace]


[summary parsing requirements]


Summary parsing.  We can parse the summary in several stages and capture SessionSection records along the way.  These records are used to confirm the parsing functionaiity and also potentially to build an agentic GUI that involves the user to confirm parsing and add parsing expressions.

If we look at documents in docs\feature-assets\feature-02 , there are transcript excerpts of various cases.  The original transcripts are in "transcripts" subdirectory and the summaries which were hand-edited to show how transcript summary sections can be parsed, are in summaries subdirectory.

For example we have:
Contentguard_ SEPTEMBER 22, 2015 PM1 - Summary1.txt
which is the summary content parsed out of transcript:

Contentguard_ SEPTEMBER 22, 2015 PM1.txt
where we have stripped the line prefixes (the line numbers in this case), stripped the page headers, and only included the summary section (before PROCEEDINGS begins).

These are further parsed into the sections (which should each be saved in a SessionSection record), see document:
Contentguard_ SEPTEMBER 22, 2015 PM1 - Summary2.txt

Within this document there are begin and end section descriptors within carets, for example: 
<Section - Litigants and Docket>

There is a pair of these section descriptors that surround a section that can be parsed out of the larger summary session.

We can do the parsing of the summary to create these subsections in the following sequence:
1) Parse out all line prefixes (line numbers which may or may not be present).  The line prefixes and full line text are parsed into the Line entity first, but that we can select back the text from the Line record or keep it in memory to keep processing to find sections.  With all the line prefixes stripped out, we can then do a pass and remove all whitespace only lines (include special characters deemed as whitespace described in this document as whitespace only lines if they only contain those characters).  Basically, we are stripping out all lines without content to parse, and we get something like the contents of file:
Contentguard_ SEPTEMBER 22, 2015 PM1 - Summary1.txt

2) Parse each vertical section (just blocks of lines at a time), that fit naturally together to get all of the sections (except those with Left and Right suffixes which are further breakdowns of other sections).  The results of individual section parsing will yield sections as expressed (surrounded by section descriptors), in document:
Contentguard_ SEPTEMBER 22, 2015 PM1 - Summary2.txt

We can parse these sections by including keywords, search strings, or expressions to find the major constructs of each section which will occur in the order presented:
<Section - Court and Division>
<Section - Litigants and Docket>
<Section - Transcript and Judge>
<Section - Appearances and Attorneys>

While there are some lines and strings that may occur sometimes and not others (all should be saved to SessionSection record), we can find strings such as 
"IN THE UNITED STATES DISTRICT COURT" for "Court and Division" section
"TRANSCRIPT OF JURY TRIAL" for "Transcript and Judge" section
"APPEARANCES", "FOR THE PLAINTIFF" for "Appearances and Attorneys" section

Note that we will have some variations in what is included, but we should be able to figure out each section by contained expected strings and patterns and the sequence within the summary.

Now for the section "Litigants and Docket", we can find lines for the section by position after the "Court and Division" section, and by the presence of the delimiter parameter summaryCenterDelim (with possible values ")(", "()", "*").  We can then further use these delimiters to break the "Litigants and Docket" sections into "Litigants and Docket Left" and "Litigants and Docket Right", by finding the text on either side of the summaryCenterDelim and appending the lines together, removing any whitespace lines.

Once we have completed the parsing as outlined here into SessionSection records, we can much more easily parse out the information needed for Trial, Attorney and other supporting entities as we have in previous versions of the system.  We can parse out whitespace and newlines within sections as needed to get down to the substance of the text to be parsed with existing patterns and mechanisms.

Note that in the above example, there are multiple docket descriptions, but we can parse the first one found as this will match the subsequent page headers of the trial and that is what we will use as the case number - this is a more rare occurence where there are multiple docket sections and case numbers.

Similar parsing breakdowns existing for other case transcripts in docs\feature-assets\feature-02:

Contentguard_ NOVEMBER 12, 2015 AM.txt
<full transcript of a session of a case>
Contentguard_ NOVEMBER 12, 2015 AM - Summary1.txt
<the above transcript stripped down to just the summary>
Contentguard_ NOVEMBER 12, 2015 AM - Summary2.txt
<the above transcript with the summary sections broken out>


Similar parsing breakdowns existing for other case transcripts in docs\feature-assets\feature-02:
Simpleair January 13, 2014 AM.txt
<full transcript of a session of a case>
Simpleair January 13, 2014 AM - Summary1.txt
<the above transcript stripped down to just the summary>
Simpleair January 13, 2014 AM - Summary2.txt
<the above transcript with the summary sections broken out>

[summary parsing requirements]


[parsing requirements]



[Schema Changes]

Schema changes
- add Trial.caseHandle (used for file output - remove ":" , characters that cannot exist in file name)
- add Trial.plaintiff and Trial.defendant (the plaintiff and defendant parsed out of the summary, we are already parsing case name which has a "V." or similar in the middle, but we have plaintiff and defendant names there)
- add Line.linePrefix whatever we parse out as linePrefix (whether a line number, line number with timestamp, with or without whitespace, we can put it in a new linePrefix field in Line entity)

- Add to Trial entity plaintiff, defendant text that will be just the plaintiff and defendant names (can be parsed from trial name, without the V. in the middle)

- add Session.metadata - add a metadata field to store json of the extracted fields based on the file pattern used to match file names, extract all potentially relevant file name components

- add Session.startTime, this is the start time of the session that can be parsed out of the summary

- add Line.dateTime - where possible (when timestamps are extracted from parsing indiviudal transcript lines and session contains the date that the trial session occurred), construct a date time field combining both and store here

- add TrialEvent.startDateTime - where Line.dateTime is filled, propagate to startDateTime for line at start of event
- add TrialEvent.endDateTime - where Line.dateTime is filled, propagate to endDateTime for line at end of event

- add Line.parsedTrialLine - the number parsed from the page header that used to be parsed into the trialLineNumber if we could rely on it, we will need to calculate trialLineNumber by keeping track of lines throughout trial

- move Page.sectionType to Line.sectionType as we can no longer assume clean page breaks for these sections
- calc overall Trial.totalPages - this has been left blank in the past, just update the Trial record after all parsing completed

- add Trial.alternateCaseNumber (sometimes there is more than one case, let's have a field to capture the additional one)
- add Trial.alternateDefendant (in these cases, there is sometimes a different defendant specification)


Add entities for intermediate storage of the parsed sections from the summary section as outlined in this document.  We will parse this in a few stages, to remove linePrefixes, then blank lines, then we can pick out sections of the summary.  For one section, we will split the left and right sections by the center delimiter.  And along the way , let's save these parsed sections for debugging and information purposes so we can see the results of the attempts to parse the summary as that will vary quite a bit from case to case.

Also, let's capture the entire multi-line pageHeader in the Page.headerText field, the existing field should be large enough, but it may be a multi-line header parsed out based ont he configuration in trialstyle.json.


Some enum value changes:
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

If "AM and PM" in file name, should set to ALLDAY
If PM1 is parsed from file name, and it is confirmed that the it is not a duplicate of the PM file (sometimes it is, but sometimes an actual evening session), when it is an actual session we can set to EVENING.  One check we can do for now is to see if file size is different, then obviously the PM1 suffix (or AM1) is a unique file from PM or AM suffixes respectively.  We could also diff the first few pages to determine this.  If it is truly a unique file, we can parse PM1 into an evening session (and the time of session start is usually in the summary).

If additional schema and/or enum changes are required, just prompt me as we go through development of this feature.

[Schema Changes]

