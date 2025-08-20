# Feature 2: Phase 1 Parsing issues

## Overview

We have some parsing issues that need to be fixed.  

## Requirements

First off, I am only seeing in the database within the table WitnessCalledEvent DIRECT_EXAMINATION and CROSS_EXAMINATION and everybody is NOT_SWORN.  So multiple problems here.  I extracted from the logs of the entire case run (can be run by executing "example-trial-config-mac.json" configuration ), all of the witness events (by searching for "EXAMINATION" or "DEPOSITION").   All of these should be causing WitnessCalledEvent records to be inserted and everyone should either be SWORN or PREVIOUSLY_SWORN (unless a video deposition and SWORN is not specified).  When a witness is introduced, they are typically sworn , and then when we have a CROSS-EXAMINATION, REDIRECT EXAMINATION, or RECROSS-EXAMINATION, we are just adding another event to a previously sworn witness (and should be preserving the witness and the sworn state in our parsing context as we navigate chronologically through the events).  When a trial session expires and we move to the next we might see "PREVIOUSLY SWORN" and we should notate that as we should 'CONTINUED", there are flags and enums for that.  But we seem to be not recording most of these events.  I do not see any of the video depositions being recorded.  If we run the test in example-trial-config-mac.json, we should see events that resemble the following (pulled from the original text versions of the transcripts that were parsed:

10/1/2020 PM
03:47:13    7              QI "PETER" LI, PLAINTIFF'S WITNESS, SWORN
03:47:13    8                           DIRECT EXAMINATION

05:04:33   13                             CROSS-EXAMINATION

10/2/2020 AM
08:32:04    9        QI "PETER" LI, PLAINTIFF'S WITNESS, PREVIOUSLY SWORN
08:32:04   10                         CROSS-EXAMINATION CONTINUED
09:53:49   21                            REDIRECT EXAMINATION

10:36:25   24                 SCOTT HAYDEN, PLAINTIFF'S WITNESS
10:36:29   25                    PRESENTED BY VIDEO DEPOSITION

10:48:46   25                      WEI LI, PLAINTIFF'S WITNESS
10:48:47    1                      PRESENTED BY VIDEO DEPOSITION

11:22:27    1                   ROHIT PRASAD, PLAINTIFF'S WITNESS
11:22:32    2                     PRESENTED BY VIDEO DEPOSITION

11:32:09    6                 ALEKSANDAR PANCE, PLAINTIFF'S WITNESS
11:32:13    7                     PRESENTED BY VIDEO DEPOSITION



10/2/2020 PM
12:51:38    3           MANLI ZHU, PH.D., PLAINTIFF'S WITNESS, SWORN
12:51:38    4                             DIRECT EXAMINATION

01:28:25   16                            CROSS-EXAMINATION

03:30:32   14                             REDIRECT EXAMINATION

03:45:41   16                             RECROSS-EXAMINATION

03:48:18   23                             REDIRECT EXAMINATION

04:49:05   16        JOSEPH C. MCALEXANDER, III, PLAINTIFF'S WITNESS, SWORN
04:49:05   17                           DIRECT EXAMINATION

10/5/2020 AM
08:33:35    1           JOSEPH MCALEXANDER, III, PLAINTIFF'S WITNESS,
08:33:35    2                             PREVIOUSLY SWORN
08:33:35    3                      DIRECT EXAMINATION CONTINUED


12:54:46   20                JOSEPH MCALEXANDER, III, PLAINTIFF'S WITNESS
12:54:46   21                           PREVIOUSLY SWORN
12:54:46   22                      CROSS-EXAMINATION CONTINUED

01:12:05    7                            REDIRECT EXAMINATION
03:39:29   21             ALAN RATLIFF, PLAINTIFF'S WITNESS, SWORN

03:39:29   22                           DIRECT EXAMINATION
04:45:57   12                           CROSS-EXAMINATION



Also we are seeing these types of entries iine console output:
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MR. OSTLING
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MR. OSTLING
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MR. OSTLING
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MR. OSTLING
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MR. RUBINO
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MR. RUBINO
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MR. RUBINO
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MR. RUBINO
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MS. LOEBBAKA
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MS. LOEBBAKA
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MS. LOEBBAKA
2025-08-10 09:31:31 [info]: Creating anonymous speaker for: MS. LOEBBAKA
2025-08-10 09:31:32 [info]: Creating anonymous speaker for: MS. LOEBBAKA

Now, one problem is we should only see this logging statement once, when we are actually creating the anonymous speaker, so the log statement needs to be moved where the insert happens (if it already exists we are not creating again).  Only MR. OSTLING is an attorney that was not introduced in the summary and is legimately considered an anonymous speaker.

For MR. RUBINO, the problem is his full name has a suffix III, and it is not being parsed correctly, here is the attorney record as parsed for MR. RUBINO:

3	MR. VINCENT J. RUBINO, III	MR.	RUBINO,	MR. III		4	2025-08-10 14:26:47.686	2025-08-10 14:28:39.925

So we are interpreting last name as III, and speaker prefix as "MR. III", so we need to fix this parsing.

For MS. LOEBBAKA, the problem is that she was parsed without a title, here is her attorney record:
11	MR. KENDALL M. LOEBBAKA	MR.	LOEBBAKA	MR. LOEBBAKA		12	2025-08-10 14:26:47.864	2025-08-10 14:28:40.043

and here is where she is announced in the transcript summary:
      2   MR. JOSEPH R. RE
          ALAN G. LAQUER
      3   KENDALL M. LOEBBAKA
          JOSHUA J. STOWELL
      4   KNOBBE, MARTENS, OLSON & BEAR, LLP
          2040 Main Street, Fourteenth Floor
      5   Irvine, CA 92614

So there is no title declared.  In this case, we should leave the title blank or null and probably just set speakerPrefix as "??? LOEBBAKA" in the attorney record until they are referenced in a transcript.  If we get an attorney reference like "MS. LOEBBAKA" and we can't find a match in the attorney table with speakerPrefix, we should search by last name for attorneys without titles, and if a match is found, we can update the attorney record with the title as found in the transcript (in this case MS., and update the speakerPrefix, and name, so it will be matched from then on).

We should add separate fields for firstName, middleInitial, and suffix to parse the additional elements.  Another troubling name is:
JOSEPH C. MCALEXANDER aka JOSEPH MCALEXANDER, III - referenced two different ways as a witness.  We should similarly parse out firstName, lastName, title, suffix, middleInitial and save to the database so if we do not get a direct match, try matching on lastName, firstName and if we get a match, do not add another records, currently we are adding two records to the database for this person.

Implement these parsing fixes to complete feature-02


