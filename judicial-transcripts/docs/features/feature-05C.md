# Feature 5C: Search Tweaks and Cleanup Continued

## Overview

We are continuing to improve the searches we are using for testing so that thay are all relevant and show something.  We will get each search to resturn results from our test database.  First we will increase diagnostics available and add some more methods of querying.  We will modify individual query json files to ensure they all return results.

## Requirements

We should have in addition to speakerPrefix the ability to query speakders by speakerHandle and use those interchangeably in queries.

Output the filters for sql select back to the console and also the SQL that will be used to select the StatementEvent records as well as the count of records returned from the select from the relational database.

Output the elastic search specification for each distinct elastic search query being executed back to the console and show the number of hits.


## Input Sources
Data in the database from previous phases.

## Expected Output Format
Json files of result in the output folder and text files of rendered results.