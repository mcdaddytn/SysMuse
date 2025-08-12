# Feature 5B: Search Tweaks and Cleanup

## Overview

We have debugged the parsing more and have a solid method to get through phase 2 with elastic search integration.  I would like to get more of a handle on the tests we have, and evaluate and potentially tweak them all so they are relevant, and create output for each (so each json output has a corresponding text file).  For ones that are really not demonstrating anything with our test data set, we can change them or delete them to produce meaningful results.

## Requirements

For new output templates, that have not yet been created (we can have a few generic ones used for many different queries).

On new templates built, we can include fields like Speaker.speakerHandle or a combination of speakerType and speakerPrefix on various output text files when doing output so we know what type of speaker.  We mostly want to see what was said and minimal metadataa, like timestamp, session, etc. in a minimal one line metadata summary plus the speaker text, we do not need a lot of extra text.

We will be refactoring the search coming up, right now we want to see quality of our results.

For tests when we have a speaker saying something indicating some type of interchange within the courtroom (like objections, or other matters of protocol, we will want to see at least on some of the queries surroundingStatements of 5 or more to capture content (just do this when it seems appropraite).

On some queries with many search strings, it would be good to know which search strings actually work and dial in results so we get a reasonable number of hits (> 0% but less than 5% of statements from that speaker) probably a good range, maybe larger tolerance for the judge.

So in a nutshell, let's get tests we have working well to demonstrate the system.  We can iterate and I will look at results also, but you can also do some iteration, seeing how many results you get, removing and adding search strings, manipulating proximity, doing queries against raw StatementEvent data to see what might work, etc.

Let's also have a simple and convenient way to run all tests with one command that are saved within a single output directory that can be zipped up and saved for analysis.  There are a lot of scripts have been built, but let's focus on a simple one to run everything and please provide a summary of the best way to run tests (a simple way within are commad line interface would be great) and view results.

## Input Sources
- data in the database and elastic search from phase 2 

## Expected Output Format
Json files of result in the output folder and text files of rendered templates.

