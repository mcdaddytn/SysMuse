# Consensus Scoring (Generalized v3)

## Current State

<!-- Describe current v3/LLM scoring approach -->
The current consensus scoring is just applied at portfolio level and allows multiple profiles saved from v2 scores to have a weighted average consensus score from multiple participants.  In the future we will have multiple logins, and each user will only have access to one role in the consensus scoring (except someone at scoring admin level) - or might not have the ability to contribute to certain consensus scores.  But for now, we are just expanding from only having portfolio level scores that can be calculated using the v2 scoring (slider GUI weight manipulation) and v3 scoring (multiple profile weights against v2 weight profiles) to having the same scoring paradigms (and the GUI pages) apply to other scores like taxonomic level scores.  By making these pages more generic and dynamic (for example if doing a sector level score - we could use sector level metrics as well).

Note much of what is described here applies to scoring in general - these questions just happen to be in the consensus-scoring doc - but consensus scoring is relatively simple and will not change much - but the information here is relevant to the greater refactoring effort.


## Problems with Current Approach

The current page works reasonably well but will be more generally applied.  And since we have scoring snapshots and weight profiles related to v2, v3, these will need to be more generalized to handle different types of scores.  But the way consensus v3 scoring applies currently to v2 scoring (and both are variations of portfolio level scoring), we should have the consensus screen offer a variant to any weighted metric score that uses the v2-like slider paradigm.  We are just making this page and service more generically useful.

<!-- What's not working? Limitations? -->
Currently limited to portfolio scoring, will expand to other scores (defined at system level what will be allowed to be edited and tracked).  We will at first not allow scores to be added through admin screens - but in the future that may happen, we should just start designing towards that.  We might have greyed out options on scores that are available in the admin screens - to just demonstrate that the system considers these as flexible dynamic scores and in the future we can add more as we can also add to our taxonomies - and also later have more scorable objects in the system (like products), so we will have permutations of possible scores (taxonomy A on products at each level of the taxonomy or a subset of levels).


## Proposed Changes

### Structured Questions
<!-- How questions are defined and structured -->
We should have enhanced versioning of structured questions and for now a read-only display should be added so we can see what is in system (we already have prompt template screens that show question format prompts), we might adapt this so we can demo the feature to show the questions and how they translate to metrics, reasoning fields, and end up in scoring formulas.  Initially, this will be read only to demonstrate the feature without adding the complexity of user creating new questions on the fly.


### Question Inheritance

<!-- How questions inherit from parent levels (portfolio → super-sector → sector → sub-sector) -->

```
Portfolio Questions
    └── Super-Sector Questions (inherit + extend)
        └── Sector Questions (inherit + extend)
            └── Sub-Sector Questions (inherit + extend)
```

This is a powerful feature and will be extended in the future to more general taxonomies.  Taxonomies can have any number of levels and multiple taxonomies may be applied to a given object type like patents.  We can have multiple taxonomies of a single type (like our current super-sector/sector/sub-sector system) or different taxonomies and either can have multiple associations to a system object like patents.  For now, we will just being migrating the schema for more flexibility and work towards having multiple taxonomical associations of the same type (super-sector/sector/sub-sector) to patents.


### Append/Prepend Text

<!-- How inherited questions can be customized at lower levels -->
The feature to have a question asked at a higher level, but allow prepend or appended text is useful to allow more detail to be asked at lower levels of taxonomy but have a metric that applies at a higher level and can be scored at a higher level.  We will continue to support this and it will be more general as taxonomies become more general.


### Question Versioning

<!-- How question changes are tracked -->
We will need to have better versioning and track changes of questions at every level of the taxonomy, currently portolio->super-sector->sector->sub-sector, but in the future if we have deeper hierarchies our inheritance and versioning will need to track it.  I think we could have a convention like 1.1.2.3 which would be portfolio.super-sector.sector.sub-sector - and for deeper hierarchies would have more terms and dots separating.  And this version will apply to each instance of the lowest level of the hieararchy.  So 1.1.2.3 for sub-sector video/streaming/codecs will be different then for video/streaming/cdns.  If we change CDN questions that version may become 1.1.2.4 - so we would know to invalidate or mark as past revisions on those scores and snapshots (the CDN scores within the snapshot will be invalidated).  But the 1.1.2 portion might apply to video/streaming and only when those questions are changed we would get 1.1.3.1 (can reset the lowest ones) and we need to invalidate from the sector on down.  When portfolio level questions are changes everything is invalided - but we will use snapshots to not throw away old scores - but to normalize them to keep using them temporarily for ranking until eventually all scores are made fresh.  We want to encourage the changing of questions as needed and not be apprehensive about rescoring - we will have facilities in our snapshot capability to help with this.


### Scoring from Answers

<!-- How LLM answers map to numeric scores -->
As currently done, we can continue - the wording of the LLM question can dictate what numerics to return on the "rating" type fields, and "reasoning" text fields can be returned that explain the rating.  We can be specific in how rating is specified (1 means irrelevant, 5 means highly relevant, etc.).


## Data Model Changes

<!-- Schema changes needed -->
In general, we are abstracting scoring more and associating more freely with patents, different taxonomical levels, and differnt object types (e.g. products) in the future, so we should refactor schema incrementally as needed as we move through the corresponding feature enhancements.


## Template File Structure

<!-- How JSON templates are organized -->
This can continue to evolve as we add more taxonomy flexibility and the ability to have different questions for different portfolios, etc. - for now we have one taxonomy for everything in the system, but that will become more flexible as we go, and we may need more flexibility in this structure - also we will need the new versioning to be reflected in our templates and throughout the system.


## LLM Integration

<!-- How prompts are constructed, responses parsed -->
One future enhancement will be when patents are given multiple taxonomy associations - we might ask even more questions in a given LLM round trip to best use resources.  Currently we are combining portfolio questions with those at every level of taxonomy - but in the future if the patent has three taxonomical classifications associated, we might union all of the questions in one LLM roundtrip.  This flexibility is a strength of the system as we maximize the utility of every LLM call and we will continue to expand that feature.


