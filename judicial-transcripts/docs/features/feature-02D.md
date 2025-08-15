# Feature 2D: Phase 1 Parsing issue cleanup, Witness Called Events

## Overview

We have some parsing issues that need to be cleaned up but we are mostly in good shape from previous efforts in Feature 2, feature 2B, and Feature 2C.  But we have a serious problem parsing WitnessCalledEvent records from the raw data, and this feature aims to fix that.  Note that a previously attempted claude session did not lead to a solution but was documented with implementation-guide-02D.md.  Subsequently, much more detail (including a full timeline of original transcript events) are included in this document (feature-02D.md), so we should have enough detail to get this implemented properly.  


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


But here are many more instances that occur in the logs and we need to document all of them.  I did a search for "EXAMINATION" in the transcripts and here are lots of example of these (I left the timestamp and line number as was in original transcript).  You can see all of these records in the Line table by searching for "EXAMINATION" or "DEPOSITION" within the Line.text field.  Any time either of these strings with a case sensitive search is found "EXAMINATION" or "DEPOSITION", you can look at the lines parsed immediately prior and after to see all the permutations of WitnessCalledEvent instances we should be parsing.  They should all be SWORN or PREVIOUSLY_SWORN based on what is in the transcript initially with DIRECT EXAMINATION and carrying the state forward to CROSS-EXAMINATION, REDIRECT EXAMINATION, RECROSS-EXAMINATION which occur in sequence after  DIRECT EXAMINATION and retain the state of the witness.  Note that REDIRECT and RECROSS can continue to alternate at end if attorneys still want to question witness to respond to what was brought up during the opposing sides arguments.  So you can have patterns like: 

DIRECT EXAMINATION [only a direct, opposing side declines to cross]
DIRECT EXAMINATION, CROSS-EXAMINATION
DIRECT EXAMINATION, CROSS-EXAMINATION, REDIRECT EXAMINATION
DIRECT EXAMINATION, CROSS-EXAMINATION, REDIRECT EXAMINATION, RECROSS-EXAMINATION
DIRECT EXAMINATION, CROSS-EXAMINATION, REDIRECT EXAMINATION, RECROSS-EXAMINATION, REDIRECT EXAMINATION
DIRECT EXAMINATION, CROSS-EXAMINATION, REDIRECT EXAMINATION, RECROSS-EXAMINATION, REDIRECT EXAMINATION, RECROSS-EXAMINATION
DIRECT EXAMINATION, CROSS-EXAMINATION, REDIRECT EXAMINATION, RECROSS-EXAMINATION, REDIRECT EXAMINATION, RECROSS-EXAMINATION, REDIRECT EXAMINATION
[etc and so on with the alternation of REDIRECT EXAMINATION, RECROSS-EXAMINATION]

If a witness is called back in another session, generally they are labelled as PREVIOUSLY_SWORN and you see CONTINUED.  For video depositions there is less information logged but we should have a witness called event with the appropriate type.  This has been documented and requested before.  You can query the database to see the raw phase 1 data in the Line table and if there are any questions how to parse all of these, let's work it out in this session.

All in all there were 46 instances of "EXAMINATION" in the transcripts and 12 instances of "DEPOSITION" which should indicate a total of 58 WitnessCalledEvent records.  You can do searches of the Line table with LIKE where clause for above strings and find the same information.

The following are all of the transcript entries that should result in records in the WitnessCalledEvent table - my notes are in square brackets [].  There are 48 events in total over the 12 session transcripts for 6 distinct days. morning and afternoon sessions, but not all contained witness events.

Note that only one witness (whether by in-court examination (one of DIRECT EXAMINATION, CROSS-EXAMINATION, REDIRECT EXAMINATION, RECROSS-EXAMINATION ) or by Video Deposition presented in court, may occupy the court's time at any given time, and we process events chronologically, retaining state of what witness is current (the last one introduced to the court either personally in-court or by video deposition).


[Beginning Transcript exerpts]

[10/1/2025 Session, Afternoon]

03:47:13    7              QI "PETER" LI, PLAINTIFF'S WITNESS, SWORN
03:47:13    8                           DIRECT EXAMINATION
03:47:14    9   BY MR. FABRICANT:

[Witness Qi Peter Li called by Plaintiff's attorney "MR. FABRICANT" for initial DIRECT EXAMINATION, sworn in by court]

05:04:33   13                             CROSS-EXAMINATION
05:04:35   14   BY MR. RE:

[Witness Qi Peter Li still on stand, cross-examined by Defendant's attorney "MR. RE", witness already sworn in by court, so still SWORN]

[10/2/2025 Session, Morning]

08:32:04    9        QI "PETER" LI, PLAINTIFF'S WITNESS, PREVIOUSLY SWORN
08:32:04   10                         CROSS-EXAMINATION CONTINUED
08:32:05   11   BY MR. RE:

[Witness Qi Peter Li called back to stand, session has changed to next day, continuing to be cross-examined by Defendant's attorney "MR. RE" already sworn in by court, so now PREVIOUSLY SWORN, since it happened in a previous court session]

09:53:49   21                            REDIRECT EXAMINATION
09:53:50   22   BY MR. FABRICANT:

[Witness Qi Peter Li still on stand, now a redirect by Mr. Fabricant original plaintiffs attorney that called the witness]

10:36:25   24                 SCOTT HAYDEN, PLAINTIFF'S WITNESS
10:36:29   25                    PRESENTED BY VIDEO DEPOSITION
[New witness Scott Hayden presented by video deposition]

10:48:46   25                      WEI LI, PLAINTIFF'S WITNESS
10:48:47    1                      PRESENTED BY VIDEO DEPOSITION
[New witness WEI LI presented by video deposition]

11:22:27    1                   ROHIT PRASAD, PLAINTIFF'S WITNESS
11:22:32    2                     PRESENTED BY VIDEO DEPOSITION
[New witness ROHIT PRASAD presented by video deposition]

11:32:09    6                 ALEKSANDAR PANCE, PLAINTIFF'S WITNESS
11:32:13    7                     PRESENTED BY VIDEO DEPOSITION
[New witness ALEKSANDAR PANCE presented by video deposition]


[10/2/2025 Session, Afternoon]

12:51:38    3           MANLI ZHU, PH.D., PLAINTIFF'S WITNESS, SWORN
12:51:38    4                             DIRECT EXAMINATION
12:51:42    5   BY MR. BAXTER:
[Witness MANLI ZHU called by Plaintiff's attorney "MR. BAXTER" for initial DIRECT EXAMINATION, sworn in by court]

01:28:25   16                            CROSS-EXAMINATION
01:28:26   17   BY MR. HADDEN:
[Witness MANLI ZHU still on stand, cross-examined by Defendant's attorney "MR. HADDEN", witness already sworn in by court, so still SWORN]

03:30:32   14                             REDIRECT EXAMINATION
03:30:41   15   BY MR. BAXTER:
[Witness MANLI ZHU still on stand, redirect by Plaintiff's attorney "MR. BAXTER", witness already sworn in by court, so still SWORN]

03:45:41   16                             RECROSS-EXAMINATION
03:45:41   17   BY MR. HADDEN:
[Witness MANLI ZHU still on stand, recross by Defendants's attorney "MR. HADDEN", witness already sworn in by court, so still SWORN]

03:48:18   23                             REDIRECT EXAMINATION
03:48:19   24   BY MR. BAXTER:
[Witness MANLI ZHU still on stand, redirect by Plaintiff's attorney "MR. BAXTER", witness already sworn in by court, so still SWORN]


03:49:38    2                CHIAWEI "JERRY" WU, PLAINTIFF'S WITNESS
03:49:40    3                      PRESENTED BY VIDEO DEPOSITION

04:49:05   16        JOSEPH C. MCALEXANDER, III, PLAINTIFF'S WITNESS, SWORN
04:49:05   17                           DIRECT EXAMINATION
04:49:10   18   BY MR. RUBINO:




[10/5/2025 Session, Morning]

08:33:35    2                             PREVIOUSLY SWORN
08:33:35    3                      DIRECT EXAMINATION CONTINUED
08:33:38    4   BY MR. RUBINO:

10:46:55   13                           CROSS-EXAMINATION
10:46:57   14   BY MR. HADDEN:


[10/5/2025 Session, Afternoon]

12:54:46   20                JOSEPH MCALEXANDER, III, PLAINTIFF'S WITNESS
12:54:46   21                           PREVIOUSLY SWORN
12:54:46   22                      CROSS-EXAMINATION CONTINUED
12:54:48   23   BY MR. HADDEN:

01:12:05    7                            REDIRECT EXAMINATION
01:12:15    8   BY MR. RUBINO:

01:22:52   16                    WAI CHU, PLAINTIFF'S WITNESS
01:22:53   17                    PRESENTED BY VIDEO DEPOSITION

01:37:18   21                   CARLO MURGIA, PLAINTIFF'S WITNESS
01:37:19   22                     PRESENTED BY VIDEO DEPOSITION

01:50:18   16                   AMIT CHHETRI, PLAINTIFF'S WITNESS
01:50:18   17                     PRESENTED BY VIDEO DEPOSITION

02:16:29    8                   PHILIP HILMES, PLAINTIFF'S WITNESS
02:16:29    9                     PRESENTED BY VIDEO DEPOSITION

02:35:10   21                  MIRIAM DANIEL, PLAINTIFF'S WITNESS
02:35:11   22                    PRESENTED BY VIDEO DEPOSITION

03:16:09    5                 ENERINO CARUCCIO, PLAINTIFF'S WITNESS
03:16:11    6                      PRESENTED BY VIDEO DEPOSITION

03:39:29   21             ALAN RATLIFF, PLAINTIFF'S WITNESS, SWORN
03:39:29   22                           DIRECT EXAMINATION
03:39:32   23   BY MR. LAMBRIANAKOS:

04:45:57   12                           CROSS-EXAMINATION
04:45:58   13   BY MR. DACUS:



[10/6/2025 Session, Morning]

08:32:04   12             ROHIT PRASAD, DEFENDANTS' WITNESS, SWORN
08:32:04   13                          DIRECT EXAMINATION
08:32:05   14   BY MR. HADDEN:

09:08:27    9                             CROSS-EXAMINATION
09:08:27   10   BY MR. BAXTER:

09:29:25   25                            REDIRECT EXAMINATION
09:29:27    1   BY MR. HADDEN:

09:31:01    4                            RECROSS-EXAMINATION
09:31:10    5   BY MR. BAXTER:

09:34:29   12               PHILIP HILMES, DEFENDANTS' WITNESS, SWORN
09:34:29   13                              DIRECT EXAMINATION
09:34:30   14   BY MR. HADDEN:

10:44:37   11                            CROSS-EXAMINATION
10:44:38   12   BY MR. FABRICANT:

11:25:21   10                            REDIRECT EXAMINATION
11:25:21   11   BY MR. HADDEN:

11:31:02   13                          RECROSS-EXAMINATION
11:31:02   14   BY MR. FABRICANT:

11:33:16   10                  MATTHEW HOLLAND, DEFENDANTS' WITNESS
11:33:21   11                     PRESENTED BY VIDEO DEPOSITION


[10/6/2025 Session, Afternoon]

12:52:51   21          SAYFE KIAEI, PH.D., DEFENDANTS' WITNESS, SWORN
12:52:51   22                            DIRECT EXAMINATION
12:52:53   23   BY MR. LAQUER:

01:55:31   15                             CROSS-EXAMINATION
01:55:34   16   BY MR. LAMBRIANAKOS:

02:29:45    5                             REDIRECT EXAMINATION
02:29:48    6   BY MR. LAQUER:

03:03:41   23    RICHARD M. STERN, JR., Ph.D., DEFENDANTS' WITNESS, SWORN
03:03:41   24                           DIRECT EXAMINATION
03:04:13   25   BY MR. RE:

04:26:09    3                             CROSS-EXAMINATION
04:26:14    4   BY MR. RUBINO:

04:37:51    6                            REDIRECT EXAMINATION
04:37:54    7   BY MR. RE:

04:45:06   10                             RECROSS-EXAMINATION
04:45:18   11   BY MR. RUBINO:

04:47:34   10          DANIEL M. MCGAVOCK, DEFENDANTS' WITNESS, SWORN
04:47:34   11                           DIRECT EXAMINATION
04:47:35   12   BY MR. DACUS:


[10/7/2025 Session, Morning]

08:32:14    6    DANIEL M. MCGAVOCK, DEFENDANTS' WITNESS, PREVIOUSLY SWORN
08:32:14    7                           CROSS-EXAMINATION
08:32:15    8   BY MR. LAMBRIANAKOS:

08:59:17   21                            REDIRECT EXAMINATION
08:59:20   22   BY MR. DACUS:

09:09:58   17                            RECROSS-EXAMINATION
09:10:18   18   BY MR. LAMBRIANAKOS:

09:14:11   22                         REDIRECT EXAMINATION
09:14:15   23   BY MR. DACUS:

09:15:47   10         JOSEPH C. MCALEXANDER, III, PLAINTIFF'S WITNESS,
09:15:47   11                             PREVIOUSLY SWORN
09:15:47   12                            DIRECT EXAMINATION

09:37:22   11                             CROSS-EXAMINATION
09:37:24   12   BY MR. HADDEN:

09:59:17   21                             REDIRECT EXAMINATION
09:59:18   22   BY MR. LAMBRIANAKOS:

10:02:29   10                             RECROSS-EXAMINATION
10:02:39   11   BY MR. HADDEN:


[10/8/2025 Session, Morning, Bench Trial recalling some witnesses]

01:03:37    6        QI "PETER" LI, DEFENDANTS' WITNESS, PREVIOUSLY SWORN
01:03:37    7                             DIRECT EXAMINATION
01:03:38    8   BY MR. RE:

01:39:12    6                            CROSS-EXAMINATION
01:39:14    7   BY MR. FABRICANT:

01:43:30   12                            REDIRECT EXAMINATION
01:43:32   13   BY MR. RE:

01:46:43   12               NICHOLAS GODICI, DEFENDANTS' WITNESS, SWORN
01:46:43   13                             DIRECT EXAMINATION
01:46:44   14   BY MS. DOAN:

02:52:33    9                            CROSS-EXAMINATION
02:52:39   10   BY MR. LAMBRIANAKOS:

03:35:50   20                         REDIRECT EXAMINATION
03:35:52   21   BY MS. DOAN:

[End Transcript exerpts]



## Input Sources
Same as feature-02.md and feature-02B.md, the various forms of the input data for transcripts.

## Expected Output Format
Data in our relational database should be verified after running phase 1 only


