# Feature 4: Elastic Search Integration

## Overview

We want to integrate elastic search into our data so we may do queries that include elastic search that will be exposed in the api.

## Input Sources
- Using the StatementEvent.text field to index in Elastic Search (capture the id back to StatementEvent.elasticSearchId
- JSON query files for now to do direct tests, build some testing into the cli interface
- Support searches where we can combine sql queries (to return a set of StatementEvent records and elastic search (which can do searches across the records and return results).
- Our SQL query can be built with filters (configurable in json).  Let's allow the following filters:
	Trial.name - if specified in input json, limit to that trial, otherwise all
	Session.sessionDate - if specified limit to sessions with that sessionDate
	Session.sessionType - if specified limit to sessions with that sessionType
	StatementEvent.speaker.speakerType - optional limit to speakerType
	StatementEvent.speaker.speakerPrefix - optional limit to speakerPrefix
- in addition to above, allow specification of one or more elastic search expressions that will do a keyword or proximity search and determine if the StatementEvent.text matches, returning a boolean result.  Each named search can return in the result for each StatementEvent selected, if the searches matched and return named booleans.
- The names of the json fields to specify filters for above should be trialName, sessionDate, sessionType, speakerType, speakerPrefix.  The values can either be a single matching value (in appropriate format to match through to a sql query), or a list, in which case we translate to an IN clause rather than an equals clause in the SQL.
	

## Requirements
1. We have already accomodated for syncing the statement table to elastic search.  So let's do a passes (can do in bulk if more efficient) to send all statement data to elastic search for indexing.
2. Build out the ElasticSearchService and a sql query service, that can combine to support the api and cli interfaces.
3. Build a client interface to take a json format accomodating the above (under input sources) inputs
4. Output json results of the queries exeuted through client interface to the output directory
5. Create a bunch of input json tests that can reside in the config directory for now and be standard queries, some examples:
- select everything by speakerType that was (use JUDGE as an example) said for a trial, or further down to a list of sessionDate and sessionType
- select everything from a named speaker, and can be a single value or list of speakerPrefix that match the record, do for a few of the attorneys
- any other good tests of functionality
6. Generate the config json for these queries and execute a series of tests through the client interface to get results for all and put them in the output directory.


## Expected Output Format
Json files of result in the output folder