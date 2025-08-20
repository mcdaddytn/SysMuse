
Within PROCEEDINGS pages, we have three main types of text:
1) Statements 
2) Court directives
3) Witness Events


The statements are text stated by a known court participant with conventions of speaker name as first non whitespace characters (after known indent block) followed by a colon.  The text of the statement follows the speaker identification prefixes within a multi-line block.  Some examples of speaker prefixes:

THE COURT:
COURT SECURITY OFFICER: 
MS. TRUELOVE:
MR. HADDEN:
BY MR. HADDEN:
Q.
A.

Note that the "BY MR. HADDEN:" convention is used at the beginning of witness testimony to clarify speaker, but is equivalent to MR. HADDEN or Q. (once the witness testimony has been established).

Alternatively during witness testimony we have Q. and A. in place of explicit speaker names which can be reconciled with speakers by contextual knowledge of the attorney (doing the questining on the Q. side) and the witness (being questioned on the A. side).


Examples of court directives (starting with pairs):

{Jury out.)
{Jury in.)

(Courtroom sealed.)
(Courtroom unsealed.)

(Videoclip played.)
(Videoclip ends.)
(Videoclip stops.)

The above court directives are in pairs and can be related to each other.  For the Videoclip directives, we have the start directive of (Videoclip played.) and the end directive of (Videoclip ends.) or (Videoclip stops.).  Our system should support aliases of known directives so we can maintain that there are related pairs (there might be too many permutations otherwise if we do not use aliases).

Examples of court directives (that appear to be singular) that mark events within the courtroom:

(Recess.)
(Witness sworn.)
(Venire panel in.)

(The Court on the Bench - Open Court.)
(Juror brought into the jury room.)
(Juror excused to return to the courtroom.)
(Conference concluded in jury room.)
(Unselected venire panel members out.)

(This portion of the transcript is sealed
and filed under separate cover as
Sealed Portion No. 1.)

The last one has some variability as we may have "Sealed Portion No. 1.", "Sealed Portion No. 2., etc.".  We might implement these types of directives as regular expressions where we can parse out the variable information.

Note that we might find that above directives fall into groups or pairs and we can related over time as we discover more scenarios.  Any directives we are unaware of that meet syntax requirements should be reported, so we can add to our system.

Note that while these appear to be court directives, they really do not meet the requirements as they are usually within a multi-line block that contains other non-whitespace text.  These are used to clarify the speaker after a Q. speaker prefix.  They should probably be parsed (maybe as part of phase 1 - just as a speaker clarification).
(By Mr. Baxter)
(By Mr. Fabricant)
(By Mr. Re)

Similarly there may be use of parenthesis across multi-line text that does not meet the requirements for court directives which dictates that no other non-whitespace text can occur outside the parenthesis of the potentially multi-line block (although most court directives fit within one line).


Witness Events

Identity alternates and speaker clarifications.  Sometimes we will see speaker prefixes such as:
THE WITNESS: 
BY MR. BAXTER:

These are really just alternate syntax for speakers and should probably be handled in phase 1 parsing.

Here is a passage of witness testimony where "THE WITNESS" occurs:
Q.   This patent --
A.   No, no, no.    I asked a question.     Could you highlight that part?
THE COURT:     Dr. Li, you don't get to ask questions.    He asks questions.
THE WITNESS:       Sure.
THE COURT:     I think he's used to Mr. Fabricant's voice.   The volume of it anyway.
MR. RE:    Okay.
Q.   (By Mr. Re)    You know, sir, of course, that this patent 
application was rejected by the Patent Office because the
features in this patent were already known, correct?
A.   I know that was a reject, but I don't know the reason

You can see that there are just speaker clarifications and substitutions for the Q. and A. syntax usually when an interruption by the judge (THE COURT) or other similar, that compels the reporter to clarify.  The "BY MR. BAXTER:" usually occurs at beginning of witness testimony to establish the speaker doing the questining (subsequently referred to as Q.)

Here are phrases for types of examination, if any others occur they should be accumulated and highlighted at end of parsing so they can be added to system processing:

REDIRECT EXAMINATION
DIRECT EXAMINATION
CROSS-EXAMINATION
RECROSS-EXAMINATION

CROSS-EXAMINATION CONTINUED
PRESENTED BY VIDEO DEPOSITION

Note "CONTINUED" may be added to any examination type and should be stored as an independent attribute.  Also "SWORN" or "PREVIOUSLY SWORN" should be noted as separate attributes when they occur.  Witnesses can be called and the first line in that case will be the witness name and information (see below), but if above EXAMINATION variants occurs on a single line, assume that we are dealing with the same witness that was called most recently.  Thus, state information must be preserved as we parse chronologically so we can fill in the witness information.


Some examples of witness calling, multi-line blocks from transcripts:

MANLI ZHU, PH.D., PLAINTIFF'S WITNESS, SWORN
DIRECT EXAMINATION
BY MR. BAXTER:

MANLI ZHU, PH.D., PLAINTIFF'S WITNESS, SWORN
DIRECT EXAMINATION

ALEKSANDAR PANCE, PLAINTIFF'S WITNESS
PRESENTED BY VIDEO DEPOSITION

JOSEPH MCALEXANDER, III, PLAINTIFF'S WITNESS
PREVIOUSLY SWORN
CROSS-EXAMINATION CONTINUED

DANIEL M. MCGAVOCK, DEFENDANTS' WITNESS, PREVIOUSLY SWORN
CROSS-EXAMINATION

SCOTT HAYDEN, PLAINTIFF'S WITNESS
PRESENTED BY VIDEO DEPOSITION

SAYFE KIAEI, PH.D., DEFENDANTS' WITNESS, SWORN
DIRECT EXAMINATION




