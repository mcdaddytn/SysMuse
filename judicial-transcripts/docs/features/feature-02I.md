# Feature 02I: Fix Page Parsing Page Header Text with Summary and Transcript Metadata

## Overview
Tweak the SessionSection and Summary parsing in relation to Page parsing, making sure we have awareness ot Transcript metadata vs. the actual text data as entered by court reporter

## Background
Feature 02H successfully improved SessionSection and Summary parsing but has remaining issues:

1. Page.parsedTrialLine has been mistakenly named, it should be Page.parsedTrialPage as we are actually capturing within the pageHeader, the page within the trial.  

2. Parsing precedence and page headerText - We are currently parsing the summary section pretty well and capturing page headers on just about every page in the correct manner, except that during the summary parsing, we are capturing the pageHeader as a different documentSection of the summary instead of just as a page.headerText, and we seem to be losing the second page's page header and capturing the first page twice (once in Page.headerText, once in SessionSection.sectionText on a record with sectionType=HEADER  

3. Pages numbered incorrectly because of this missing page header.  We have the second page parsed with Page.pageNumber=2 while Page.trialPageNumber=3 and Page.parsedTrialLine=3.  For the initial transcript, these values should all be the same (if there is no page header corruption which there should not be with 2 line page headers).


Also, we are not correctly counting the pages in the summary as a result.  We should be parsing out the pageHeader in an outer loop as it is transcript metadata rather than the transcript text itself (which would have been entered by court reporter).  The pageHeader like the linePrefix data, needs to be extracted before we start putting together the summary.  By the way, if we need to do multiple parsing passes to do this correctly that would be OK.  We could go through transcripts to identify and find all lines with linePrefix and all pageHeader instances and record the file lines for an additional parsing pass.  Hopefully this is not necessary but it is an option.  What we really want it to properly store the Page.pageHeader for page break that occurs within the summary, we seem to be losing that one and it ends up as a section within SessionSection.



## Requirements

### 1. Fix Page.parsedTrialLine field name
- **Problem**: Fix Page.parsedTrialLine is incorrectly named should be Page.parsedTrialPage
- **Solution**: 
  - Do a schema change to update the name and update the understanding that this should represent the page number within the entire trial across session transcripts and is usually parsed correctly and can be used to verify our calculated trialPageNumber (the only time it should be inaccurate is when we have 1 line page headers and we are on a page number within transcript > 99, where the three digit page number bleeds into the page Id corrupting both fields), besides that situation it is usually accurate
  - So for the second transcript of a trial, the parsed value should align with the number of pages from the first transcript plus one.  We cannot completely rely on this value as it can be corrupted during pdf to text translation in some cases (generally when pageHeader is all on one line), so we calculate our own and put in Page.trialPageNumber which is mostly working correctly (more on that below).  But it should be captured and named appropriately as it is an excellent reference to verify our parsing is correct
  

### 2. Parsing precedence and page headerText
- **Problem**: We are not capturing the Page.headerText and consequently not saving the Page record for the second page which is generally contains the continuation of the summary information from the first page.  We are also capturing the first page headerText but also saving it within SessionSection while we are losing the second page pageHeader
- **Solution**: 
  - We can look at the transcript as having two types of data, transcript metadata (describing what document we are in, which page we are on, what time it was recorded, etc.) and transcript data (text recorded by court reporter describing the trial and proceedings).
  - The metadata data should be stripped first before parsing data for SUMMARY, CERTIFICATION, and PROCEEDINGS and sometimes it seems this is getting mixed in with the data althrough it seems to be mostly correct now.
  - The current problem is we are losing the second page's header (or I would imagine any page that would be part of the continuation of the summary data).  We should make sure we capture the page header for all pages including the second and capture in Page.headerText (and make sure we are saving Page data for page 2 and associating lines correctly).  Currently we are associating lines across pages in the transcript into the first page (with id=1) instead of identifying subsequent pages and associating lines.  We should only have a max of 25 lines a page (although sometimes we have line continuations without line numbers), but a parsed line number should be 25 or less and we should not have more lines stored per page except perhaps a few for line continuations).  Make sure we are capturing all page headers before parsing for summary, and then also we do not need to also store the page header as a SessionSection (see any records with sectionType=HEADER), they do not need to be in SessionSectoin as they should have already been stripped and saved in a Page record (with new Page records created when appropriate - when a page header is identified).
  

### 3. Incorrect page numbers
- **Problem**: Since we are missing page headers on page 2, we are misnumbering pages (i.e., setting Page.pageNumber incorrectly), and also associating too many lines with the first page of the transcript, since we are not saving subsequent Page records.  We have something like 78 iines - all of the SUMMARY lines associated with one page (the first), when in actuality they occur on two pages and could in some transcript be on more pages depending on how long the summary information is for a particular trial transcript
- **Solution**: 
  - When we have fixed the capture of all page headers, we can fix the numbering problem and properly associate lines within the Summary to the correct page.  The fields Page.pageNumber, Page.trialPageNumber, and Page.parsedTrialPage (renamed from parsedTrialLine), should all be equal for the first transcript for a trial.  The only exception would be if we have a single line page header (which we do not for our initial test), and we get into 3 digit page numbers where corruption of the Page.parsedTrialPage number occurs - but apart from that, in the first transcript we should see these fields be equal.
  


