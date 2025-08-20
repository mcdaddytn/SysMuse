# Feature 7: Marker Initial Implementation

## Overview

## Input Sources
Using the data from phase 2, the TrialEvent and related MTI entities WitnessCalledEvent, CourtDirectiveEvent, StatementEvent, etc., we will build out entities Marker, MarkerSection and related entities which will represent meaningful periods within a Trial transcript.

## Expected Output Format
Data into the Marker related entities in the relational database, available to be used for querying and export.

## Requirements
The requirement are described in detail below and fall into the main categories

Schema Changes supporting markers (and some to support accumulator functionality and deeper more efficient Elastic Search integration)

Marker Implementation

Accumulator Implementation (timeline searches spanning multiple events), accumulators are used for Activity marker discovery

Witness Marker Discovery

[Schema Changes]


First, we need schema changes.  The marker schema was designed and never really used, so let's update it.

A MarkerSection is linked to and opening and closing marker and will contain a set or TrialEvent records within.  This can be used to export excerpts of the transcript and to create entries in ElasticSearch for larger sections that can be searched across trials.  So for example, we might do keyword search against all opening arguments in all trials, oncde openings have been marked and synced to Elastic Search.

Note that the MarkerSection entity will encompass an area of the transcript with a start and an end, so it should contain these fields (which should be moved from Marker entity):
  startEventId   Int?
  endEventId     Int?
  startTime      String?
  endTime        String?

The Marker class is a singular point, so should just have a single eventId linked to a TrialEvent.  

Update the marker entity to contain only needed fields and relationships based on the descriptions here, we can scrap what is currently in the schema and rework this area.

A marker is essentially a timestamp within a parsed trial transcript that flags a relevant event in the trial.  So for each marker when found, it will have an associated TrialEvent.   We can find markers in passes through the trial (a pass is a forward scan of all events in the trial with partial rewinds sometimes).  The early passes will create markers that can be used by subsequent passes to set more specific markers.  As we add layers of markers we will have more of an idea of the outline and timeline of the case.  In establishing markers we will have opportunity for users to confirm, modify, delete or add markers.  We will use automation to do as much of the work as possible so human intervention will be efficient and accurate.

Some of the functionality here will overlap with that of the search capability.  I would like to implement some more advanced features here that might be factored back into the search but I do not want to disrupt current search functionality in the process.  We can refactor to use common code patterns later.


Some types of markers/marker sections (the individual markers are just beginning and end parts for paired markers) for initial implementation (described in detail below):
Activity (contains a cluster of activity that we can find with search accumulators - these are single markers and are not paired into sections by default)
WitnessExamination (contains a single type of examination for a single witness)
WitnessTestimony (contains all of the examinations making up the complete testimony for a single witness)
CompleteWitnessTestimony (the aggregation of all witness testimony)


MarkerType can have values
	ActivityStart
	ActivityEnd
	WitnessTestimonyStart
	WitnessTestimonyEnd
	WitnessExaminationStart
	WitnessExaminationEnd


MarkerCategory can be changed to MarkerSectionType and have values for now
	WitnessTestimony
	WitnessExamination
	CompleteWitnessTestimony
	ClosingArgument
	OpeningArgument
	JurySelection
	Verdict
	Activity


We can remove from EventType enum (OBJECTION, RULING, EXHIBIT, OTHER)

We can add a MarkerTemplate entity which should contain fields with patterns to render to name markers and marker sections and to also dictate relationships on the trial timeline between Marker Sections (which will be contained within others or be related serially).  So MarkerTemplate can have a parent template and a sibling template to define some structure that may be helpful to fill out markers but is not essential at this stage.  For now, we need MarkerTemplate to hold the templates that will be used to generate names (and optionally descriptions) of Marker and MarkerSection records (which will be named based on the events with which they are associated).

Also we will want additional entities to handle accumulator expressions, elastic search pre-loaded searches, elastic search results (to be used by accumulator expressiosn).

On elastic search integration, create a table that will then be translated into Elastic Search expressions that will be evaluated against each StatementEvent in the database.  We can then see which ones are present and build useful combinations.  One particular area of interest would be to find objection language between attorney and judge within a few statements and build activitiy marker accumulators accordingly.  We can import elastic search expressions from a seed file and then run in a single pass after indexes have been created during phase 2 to make available for accumulator expressions.

Also build accumulator expression entities and seed data to support the expressions described in this document to find interesting interactive activity between parties.



[Marker Implementation]

Generate names/descriptions of markers and settings with a pattern that are stored in MarkerTemplate entity.

For example, for witness examination, here are patterns for the WitnessSection (result of pairs of markers)
WitnessTestimony
WitnessTestimony_{WitnessCalledEvent.Witness.Speaker.speakerHandle}
WitnessExamination
WitnessExamination_{WitnessCalledEvent.examinationType}_{WitnessCalledEvent.Witness.Speaker.speakerHandle}

The individual marker templates will have appended to the section name Start and End, e.g.:
WitnessTestimony
WitnessTestimony_{WitnessCalledEvent.Witness.Speaker.speakerHandle}_Start
WitnessTestimony_{WitnessCalledEvent.Witness.Speaker.speakerHandle}_End
WitnessExamination
WitnessExamination_{WitnessCalledEvent.examinationType}_{WitnessCalledEvent.Witness.Speaker.speakerHandle}_Start
WitnessExamination_{WitnessCalledEvent.examinationType}_{WitnessCalledEvent.Witness.Speaker.speakerHandle}_End

The MarkerTemplate, in addition to having patterns for name (and optionally description - we can also generate default descriptions), we have fields to dictate the relationship of MarkerSections to one another (whether they are contained within other MarkerSections or are adjacent to them with the same parent).  For that we might have fields:
	parentTemplate - the type of marker bookending the parent section
	siblingTemplate - the type of marker that will be a sibling where the marker endpoints will not overlap
So MarkerTemplate is associated with a Marker with certain characteristics and its corresponding MarkerSection (which is just really a pair of markers where we have a period in between that we can operate on, e.g., generate text for the enclosed time period).	

We want to be able to upsert markers from json file (and generate from a pass).  After generation we can change the TrialEvent associated manually in the json.  We can refer to the marker by name and upsert for this requirement (rather than needing to know the id of the marker and the TrialEvent).  We might want other more convenient ways of specifying the TrialEvent (perhaps with fields of the associated MTI types) since we will be setting these manually often with json to correct the auto-setting of markers and to add markers.  We will need this process early on before developing a GUI to edit markers, so it should be convenient.

[Accumulator Implementation]

A marker is essentially a timestamp within a parsed trial transcript that flags a relevant event in the trial.  So for each marker when found, it will have an associated TrialEvent.   We can find markers in passes through the trial (a pass is a forward scan of all events in the trial with partial rewinds sometimes).  The early passes will create markers that can be used by subsequent passes to set more specific markers.  As we add layers of markers we will have more of an idea of the outline and timeline of the case.  In establishing markers we will have opportunity for users to confirm, modify, delete or add markers.  We will use automation to do as much of the work as possible so human intervention will be efficient and accurate.

Some of the functionality here will overlap with that of the search capability.  I would like to implement some more advanced features here that might be factored back into the search but I do not want to disrupt current search functionality in the process.  We can refactor to use common code patterns later.

Additional detail on types of markers:

Activity (and search accumulators that help find them and generate the records)

One type of marker we will search for early in the process is activity markers which will find clusters of activities that meet certain criteria.  These will in some cases parse dialog and we can do this in a number of ways.  One essential way is through marker accumulators which will create Activity markers that will basically discover activity in the trial that will be useful for the human operator to understand important turning points in the trial.  Some markers (like those related to Witness Testimony) are easy to derive from the phase 2 data, but many markers will be more difficult to set through an algorithm and will require human and/or LLM intervention to interpret language with more nuance.  As a first step though we can detect patterns of interactions within the transcript that will be very helpful to show for example when the judge is intervening, or multiple parties are interacting.

Some example activity patterns we would be interested in:
1) Find all instances where there are at least 3 distinct speakers within 10 statements including the judge as one of those speakers.
2) Find all instances where there are at least 3 distinct speakers within 6 statements including the judge as one of those speakers and the other two are attorneys.
3) Find all instances where there are at least 3 distinct speakers within 8 statements including the judge as one of those speakers and the other two are attorneys, one on the plaintiff side, one on the defense side.

For the above patterns, we can abstract the number of speakers, the number of adjacent statements, and the types of speakers we are looking for into a search accumulator class that we can configure for various purposes.  Once we have found a pattern, we might want to find tune the result to narrow the number of statement to a minimum within which our condition is true.  So for example, we may have an acceptable threshold of 10 statements within which our pattern must be true, but once we find the pattern, we can search for a smaller set of statements for which the condition is true and use that as the concise answer to our search. From this result, we might set 1 or 2 markers and we should be able to configure to set a marker at the beginning, the end, or both.  We will also have configuration how how to set the type and description of the marker.

Here are some additional patterns we would like:
1) Find all instances within 5 statements where an attorney says "I object" or "Objection" and the judge says "sustained", "overruled", "I'll allow it", etc.  We may be looking for a lot of different variations of these types of statement over time and we can combine with boolean logic or a more sophisticated threshold calculation (more on that below).  We may want to use proximity and phrase searches as well as direct keyword searches in Elastic Search for this and return booleans that we can save in our database table and then combine in different ways to make decisions on where to set markers.

Other interesting patterns (phrase detection logic could be in combination with a defense or plaintiff attorney speaking)

We will want combinations of boolean logic and threshold calculations.  For example we might want to look for attorney saying "Objection", "I object", or "Same issue your honor", and score the first two with a 10 out of 10 and the last one with a 5 out of 10.  And then from the judge "overruled", "sustained" might be 10 out of 10 and "I'll allow it" 7 out of ten.  We would combine these all while occuring within a few statements of each other to conclude that we have an excerpt that is an objection interaction between judge and attorney.

So the logic would be something like this, within 5 (variable we can configure) statements, we are looking for
From Attorney (I object) OR (Objection) OR (Same issue your honor) and 
From Judge (Overruled) or (I'll allow it) or (Sustained)

We can achieve the above will all boolean logic, or we can use threshold calculations (our accumulators should support both so we can vary based on indvidual transcripts and adapt as we learn tendencies for specific judges, attorneys, courts, etc.).  For threshold calculation version, we might have something like:

Within 5 statements, we are looking for:

From Attorney (I object) OR (Objection) yields 10 out of 10 OR (Same issue your honor) yields 8 out of 10
From Judge (Overruled) or (Sustained), 10 out of 10,  or (I'll allow it) yields 5 out of 10.

And then within the statement grouping (5 statements in this case), if we have a threshold of 15 (and a combination type of addition), we would get an affirmative objection w ith combinations that are stronger (like Attorney "I object" and Judge "Overruled" which would yield 10 + 10 = 20 which is > threshold 15 for affirmative result, where scenario Attorney "Same issue your honor" and judge "I'll allow it" within 5 statements would yield 8 + 5 = 13 which is < threshold and would not trigger an affirmative pattern for objection.

Note that we might have proximity, phrases producing booleans from Elastic Search and translated into the combination above for threshold calcuations or boolean calculations to trigger our markers.

Another threshold calculation might be a weight between 1.0 for each category of search terms, then a product calculation and threshold.  For exsmple:
From Attorney (I object) OR (Objection) yields 1.0 out of 1.0 OR (Same issue your honor) yields 0.8 out of 1.0
From Judge (Overruled) or (Sustained), 1.0 out of 1.0,  or (I'll allow it) yields 0.5 out of 1.0.

Then we might set threshold (product of above), to .8 - 1.0, high confidence, .5 - .8 or above medium confidence, .3 - .5 low confidence, below .3, no confidence.

So in the case of 

So for these threshold calculations can produce a boolean result and/or a confidence level.

So for example Attorney "Same issue your honor" and judge "I'll allow it" within 5 statements would yield .8 * .5 = .4 or a low confidence result, where other combinations Attorney "I object" and judge "I'll allow it" would yields 1.0 * .5 or a medium confidence level.  Then we can also assign a boolean with an additional parameter MinAffirmConfidenceLevel if set to medium a medium or higher confidence level gives a TRUE affirmation so the marker is set accordingly.  Either way the marker is persisted for human review where the thresholds can be modified or the individual markers can be manually overridden as we seek to fill out pairs of markers (e.g., the beginning and end of objection language).

So breaking it down, we have a few different modes of operation
Accumulator returning boolean
Accumulator returning confidence level (enum)
Accumulator returning float

A confidence level can be trivially converted to a boolean with a confidence threshold, and a float can be trivially converted to a confidence level with a set of thresholds.  All of these accumulators can use expressions that return booleans.  The float accumulators can also use internal component expressions that return floats.

For our initial version, we will use component calcuations for above accumulators
	
Elastic Search - keyword, phrase and proximity expressions that can be run against each statement to return a value.  Each expression can be evaluated in one pass and stored in a database table (that can be linked with keys back to StatementEvent records.  These expressions should be named within the database and can be stored in memory once calculated so that compound expressions and accumulators can use the values

Expression Search - use regex and/or custom parsers through our interface IParser to find matches against text.  Note that for StatementEvent records, we are looking at the text field (which is also indexed in Elastic Search and therefore that is an additional and usually preferable option to evalue expressions), but for WitnessCalledEvent, CourtDirectiveEvent, we can use TrialEvent.rawText (also available for StatementEvent but not preferable as text is abridged).  So when we set up these epxressions, one of the fields to configure is which type of event we are looking for and which text field we are searching against.
	
boolean logic filters on TrialEvent, CourtDirectiveEvent, WitnessCalledEvent, StatementEvent fields and related Speaker records.  We need logic like StatementEvent.Speaker.speakerType=JUDGE or StatementEvent.Speaker.speakerHandle one of ATTORNEY_RE_MR, ATTORNEY_FABRICANT_MR


Note that we will want to parse out of this interaction overruled or sustained and translate to an enum value on the objection outcome that is specific to this MarkerSectionType.

Let's leverage elastic search to do this with a bunch of pre-configured patterns that can be loaded and evaluated in a pass after elastic search has been synced to StatementEvent and before we do Marker evaluation.  We could execute it as a step after Trial information has been synced to Elastic Search.  These patterns will be matched against statements for a True or False value.  If we can do one pass against the elastic search database evaluating each pattern for each StatementEvent.text (which is synced to Elastic Search) and save the results in the database, those results will be available for downstream operations.

[Witness Marker Discovery]

Other types of marker WitnessExamination, WitnessTestimony, CompleteWitnessTestimony

WitnessExamination markers - This is another specific type of marker that we will do a separate pass to establish and these will come in pairs.  When we search for WitnessTestimony markers, the opening marker is simple to find, it is simply the WitnessCalledEvent for each witness and examinationType combination.  The end marker is a bit more involved to find.  After an opening marker is found, the end marker is either constrained by the next WitnessCalledEvent found or the end of a session, whichever comes first.  Once we find the constraining event, we will need to rewind the end marker to the end of the testimony for the witness, examinationType combination.  We can search backwards from that constraining event until we find a StatementEvent where the StatementEvent.Speaker.speakerPrefix="A.", that will signify the last answer given by the witness as part of that examination.  If we cannot find the end marker, we issue a warning, and the user will need to resolve this marker pair.

Once we have established WitnessExamination markers for individual examinationTypes, we will also want overall marker pairs for the entire witness testimony for the witness (WitnessTestimony marker).  We should set the opening marker for this pair as the opening marker for the first examination for the witness (the DIRECT_EXAMINATION), and the closing marker as the closing marker for the last examination conducted for the witness, whichever one that may be.  Note that these types of marker pairs may span multiple sessions where the singular examination markers fall within one session (if a particular examination runs into a new session, we have a new WitnessCalledEvent with a continued flag set to true).

Once we have set all witness testimony markers and activity markers, we will have a good amount of information to fill in additional markers for opening and closing statements (in total and for individual attorneys), jury selection, jury instructions, and other activities that happen within the trial.  We can create the CompleteWitnessTestimony marker section and corresponding markers by bookending all witness testimony and this makes up a large part (middle) of the trial which will narrow the range to find opening and closing statements and other trial sections.


On accumulator implementation (use of included resources):

Let's import the file (in docs/feature-assets/feature-07/samples), and look at the mocked up code (in docs/feature-assets/feature-07/code)
courtroom_expressions_library_expanded.csv (data table containing elastic search expressions to import and run to be used by marker accumulators)
csv_to_es_json.ts (code to translate csv records to ES searches)




## Implementation Notes
See `docs/impl/feature-07-implementation.md` for detailed implementation guide, lessons learned, and diagnostic tools.


