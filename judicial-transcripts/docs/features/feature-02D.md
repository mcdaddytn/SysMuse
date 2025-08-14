# Feature 2D: Phase 1 Parsing issue cleanup, Witness Called Events

## Overview

We have some parsing issues that need to be cleaned up but we are mostly in good shape from previous efforts in Feature 2, feature 2B, and Feature 2C.  But we have a serious problem parsing WitnessCalledEvent records from the raw data, and this feature aims to fix that.


## Requirements

We are missing WitnessCalledEvent records for most times that is happens, and it is crucial that we get this correct.  In the database table for WitnessCalledEvent we have the following records after the last run:

1	583	1	CROSS_EXAMINATION	PREVIOUSLY_SWORN	false	false	"QI "PETER" LI, PLAINTIFF'S WITNESS, PREVIOUSLY SWORN
CROSS-EXAMINATION CONTINUED"
2	1450	2	VIDEO_DEPOSITION	NOT_SWORN	true	true	"SCOTT HAYDEN, PLAINTIFF'S WITNESS
PRESENTED BY VIDEO DEPOSITION"
3	1493	3	DIRECT_EXAMINATION	NOT_SWORN	false	false	WEI LI, PLAINTIFF'S WITNESS
4	1815	4	VIDEO_DEPOSITION	NOT_SWORN	true	true	"ALEKSANDAR PANCE, PLAINTIFF'S WITNESS
PRESENTED BY VIDEO DEPOSITION"
5	6418	5	DIRECT_EXAMINATION	NOT_SWORN	true	false	"JOSEPH C. MCALEXANDER, III, PLAINTIFF'S WITNESS,
PREVIOUSLY SWORN
DIRECT EXAMINATION"


But here are many more instances that occur in the logs and we need to document all of them.  I did a search for "EXAMINATION" in the transcripts and here are lots of example of these (I left the timestamp and line number as was in original transcript).  You can see all of these records in the Line table by searching for "EXAMINATION" or "DEPOSITION" within the Line.text field.  Any time either of these strings with a case sensitive search is found "EXAMINATION" or "DEPOSITION", you can look at the lines parsed immediately prior and after to see all the permutations of WitnessCalledEvent instances we should be parsing.  They should all be SWORN or PREVIOUSLY_SWORN based on what is in the transcript and carrying the state forwad to CROSS-EXAMINATION, REDIRECT EXAMINATION, RECROSS-EXAMINATION which occur in sequence after  DIRECT EXAMINATION and retain the state of the witness.  If a witness is called back in another session, generally they are labelled as PREVIOUSLY_SWORN and you see CONTINUED.  For video depositions there is less information logged but we should have a witness called event with the appropriate type.  This has been documented and requested before.  You should query the database to see the raw phase 1 data in the Line table and if there are any questions how to parse all of these, let's work it out in this session.

All in all there were 46 instances of "EXAMINATION" in the transcripts and 12 instances of "DEPOSITION" which should indicate a total of 58 WitnessCalledEvent records.  You can do searches of the Line table with LIKE where clause for above strings and find the same information.

Here are a bunch of examples of "EXAMINATION" instances from the transcripts

03:47:13    7              QI "PETER" LI, PLAINTIFF'S WITNESS, SWORN
03:47:13    8                           DIRECT EXAMINATION
03:47:14    9   BY MR. FABRICANT:

05:04:33   13                             CROSS-EXAMINATION
05:04:35   14   BY MR. RE:

12:51:38    3           MANLI ZHU, PH.D., PLAINTIFF'S WITNESS, SWORN
12:51:38    4                             DIRECT EXAMINATION
12:51:42    5   BY MR. BAXTER:

01:28:25   16                            CROSS-EXAMINATION
01:28:26   17   BY MR. HADDEN:

03:30:32   14                             REDIRECT EXAMINATION
03:30:41   15   BY MR. BAXTER:

03:45:41   16                             RECROSS-EXAMINATION
03:45:41   17   BY MR. HADDEN:

03:48:18   23                             REDIRECT EXAMINATION
03:48:19   24   BY MR. BAXTER:

04:49:05   16        JOSEPH C. MCALEXANDER, III, PLAINTIFF'S WITNESS, SWORN
04:49:05   17                           DIRECT EXAMINATION
04:49:10   18   BY MR. RUBINO:

08:32:04    9        QI "PETER" LI, PLAINTIFF'S WITNESS, PREVIOUSLY SWORN
08:32:04   10                         CROSS-EXAMINATION CONTINUED
08:32:05   11   BY MR. RE:

09:53:49   21                            REDIRECT EXAMINATION
09:53:50   22   BY MR. FABRICANT:

12:54:46   20                JOSEPH MCALEXANDER, III, PLAINTIFF'S WITNESS
12:54:46   21                           PREVIOUSLY SWORN
12:54:46   22                      CROSS-EXAMINATION CONTINUED
12:54:48   23   BY MR. HADDEN:

01:12:05    7                            REDIRECT EXAMINATION
01:12:15    8   BY MR. RUBINO:

03:39:29   21             ALAN RATLIFF, PLAINTIFF'S WITNESS, SWORN
03:39:29   22                           DIRECT EXAMINATION
03:39:32   23   BY MR. LAMBRIANAKOS:

04:45:57   12                           CROSS-EXAMINATION
04:45:58   13   BY MR. DACUS:

08:33:35    2                             PREVIOUSLY SWORN
08:33:35    3                      DIRECT EXAMINATION CONTINUED
08:33:38    4   BY MR. RUBINO:

10:46:55   13                           CROSS-EXAMINATION
10:46:57   14   BY MR. HADDEN:

12:52:51   21          SAYFE KIAEI, PH.D., DEFENDANTS' WITNESS, SWORN
12:52:51   22                            DIRECT EXAMINATION
12:52:53   23   BY MR. LAQUER:

01:55:31   15                             CROSS-EXAMINATION
01:55:34   16   BY MR. LAMBRIANAKOS:

09:53:49   21                            REDIRECT EXAMINATION
09:53:50   22   BY MR. FABRICANT:

12:54:46   20                JOSEPH MCALEXANDER, III, PLAINTIFF'S WITNESS
12:54:46   21                           PREVIOUSLY SWORN
12:54:46   22                      CROSS-EXAMINATION CONTINUED
12:54:48   23   BY MR. HADDEN:

01:12:05    7                            REDIRECT EXAMINATION
01:12:15    8   BY MR. RUBINO:


03:39:29   21             ALAN RATLIFF, PLAINTIFF'S WITNESS, SWORN
03:39:29   22                           DIRECT EXAMINATION
03:39:32   23   BY MR. LAMBRIANAKOS:



Here are a bunch of examples of "DEPOSITION" instances from the transcripts.  They are usually (or always) followed by a court directive such as:
(Videoclip played.)


03:49:38    2                CHIAWEI "JERRY" WU, PLAINTIFF'S WITNESS
03:49:40    3                      PRESENTED BY VIDEO DEPOSITION

10:36:25   24                 SCOTT HAYDEN, PLAINTIFF'S WITNESS
10:36:29   25                    PRESENTED BY VIDEO DEPOSITION

10:48:46   25                      WEI LI, PLAINTIFF'S WITNESS
10:48:47    1                      PRESENTED BY VIDEO DEPOSITION

11:22:27    1                   ROHIT PRASAD, PLAINTIFF'S WITNESS
11:22:32    2                     PRESENTED BY VIDEO DEPOSITION

11:32:09    6                 ALEKSANDAR PANCE, PLAINTIFF'S WITNESS
11:32:13    7                     PRESENTED BY VIDEO DEPOSITION

11:33:16   10                  MATTHEW HOLLAND, DEFENDANTS' WITNESS
11:33:21   11                     PRESENTED BY VIDEO DEPOSITION




## Input Sources
Same as feature-02.md and feature-02B.md, the various forms of the input data for transcripts.

## Expected Output Format
Data in our relational database should be verified after running phase 1 only


