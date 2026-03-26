# Data Enrichment & Auto-Calculation

## Current State

<!-- Describe current enrichment pipeline -->
Enrichment is a nice feature with a lot of options to choose what we should spend resources on.  But versioning is not robust enough and we must be able to choose topN within whatever category to enrich but only enrich the ones that are not up to date (and the current binary rendition of this is not enought - we need versioning).


## Problems with Current Approach

<!-- What's not working? Limitations? -->
When we run topN enrichment, we must consider which of the topN are already up to date and which need to be enriched - and reflect that in the numbers so we can see the scope and cost of the operation being proposed.  We currently have a notion of stale LLM data - a binary condition, but really we want a notion of whether LLM data is up to the version latest version available contextually, based on what is beign enriched.  So if within sectors.

Also we can expand enrichment beyond just portfolio level and super-sector level (which is a bit contrived anyway since tied to our one taxonomy currently in used - in the future more taxonomies are possible).  So what if we want to enrich just one sector and enhance LLM questions at sector or sub-sector level - this flexibility will help us be more aggresive about continuing to evolve our structured LLM questions and scoring without being afraid of invalidating data.

Now we do not need to implement enrichment beyond current choices of by portfolio and by super-sector right away - but we should be evolving our system toward that capability - and these services and GUI should handle the general case - of making the proper filters, finding topN on current available scoring, and enriching to bring data to highest quality available.

Now we have an interesting chicken and egg problem where a score we might use for enrichment is being updated by enrichment.  

Lets say we are trying to find the best patents in the VIDEO super-sector using the v2 score (which is portfolio level LLM questions weighed through user intervention).  But we just added a few portfolio level questions which will affect the v2 score (and this is a real scenario because we added some new portfolio questions and have not re-run LLM questions or rescored).  One simple but costly solution is just rerun all patents through new questions - but in practice it is not only expensive but time consuming and even then not compreshensive because there area always patents with incomplete data (old patents, ones for which we had problems enriching data for any number of reasons), etc.  So our system has a number of facilities to handle this through evolving structured questions, flexibile scoring, scoring snapshots, and normalization.

So a tangible example of this - we just added new portfolio questions and we are interested in the VIDEO sector for portfolioA.  Assume we currently have scored this portfolio up to the top 5000 overall before, and 1200 of those happen to be in the VIDEO super-sector - so before changing portfolio questions, top 1000 of VIDEO would have been fully enriched.  So we capture a snapshot of scores of the top 5000 overall and push the scoring set as default so they can be used for ranking.

But now we want to see the new questions and we are prioritizing VIDEO.  So we can select top 1000 under video super-sector and enrich them.  The system should know based on versioning, that current scores are out of date and can run on the top 1000.
After that run we have top 1000 VIDEO patents with the new scoring and 200 with the old scoring (as well as the rest of the original 5000 in other super-sectors out of date with regard to LLM question versioning).  We are interested in how the top 1000 might be re-ranked with the new questions so we can bump the scoring weights up for the new questions and recalculate the scoring snapshot.  Now that snapshot should be aware (and this is a new feature - changed from old behavior).  The snapshot should be limited by the system to have all of the data (or at least this should be recommended and a warning if otherwise) that is up to date.  Once we have the new top 1000 snapshot of VIDEO, that is nice and we can analyze the new data.  But now we realize are questions are good (as opposed to we might want to iterate, change questions and run on top 1000 again to save time and money as we evolve questions).  But when we have decided the scores and data are good, we want to apply more widely.  Now we want to start with the most important patents to us which might still be VIDEO, but we have 200 with out of date scores.  One option would just be to enrich top 2000 VIDEO - but we do not have that many in video - so we may as well start enriching general sectors, maybe top 3000 overall (which might take care of missing 200 of video or many at least).  So either we can enrich top 3000 overall using a different measure (like base_score - but that would completely change the set of patents we are enriching), or we can expand our scoring snapshot for top 3000 (and this is where the new functionality comes in).  We would want to apply a normalization to the scores that do not have the new questions so they can be reranked so we can tell which are in the new top 3000 based on v2 score (a much more accurate score for our purposes than base score).

So we can apply a normalization that is fair in that it will still keep the previously highly ranked video patents high - while ranking old patents roughly how they were (but without the nuance of the new questions).  So we might add a small weight to the new questions and apply a normalization expanding the pure snapshot of top 1000 VIDEO (which is all consistent to version) to a new top 3000 overall snapshot that has mixed versions.  The normalization might take into consideration the average values of the new questions - but instead of assigning the average to all the patents missing the score - it might be normalized down by the relative previous v2 score of those patents relative to the average previous v2 score of all the patents in the top 1000 VIDEO snapshot - so the rankings remain relatively stable for the rest of the top 3000 that we now want to update with new LLM questions.  

Then we can run new questions on the top 3000, rescore, create a new snapshot and push it and everything is up to date.  That would be a reaonable workflow to try and incrementally enrich patents with LLM data as we evolve questions.  And this sequence  could be done automatically in a loop (run new questions on small snapshot, normalize within larger snapshot, reenrich until some goal has been reached, top N are up to date for a given super-sector, overall, etc.).  We can work towards this type of iterative loop that can better evaluate evolving scoring and evolving questions to enrich better candidates and use our budget more prudently.

This auto-looping feature can be a future enhancement, but we want to build our snapshots to be aware of versions and when we have mixed snapshots with normalization we want to do it consciously for the purposes of having working scores that help further enrichment.  We want to be able to do it manually before automatically and build our snapshotting and normalization for this purpose - I am afraid of just normalizing scores within snapshots and artifically boosting patents that should not be because we are unaware of the implications and mechanics of the normalization.  So we should simplify the normalization and implement pragmatic algorithims based on previous snapshot data, aggregates of data from different scoring versions with the goal of only reranking patents substantially when we have new information - but allowing potential good patents to bubble up to get the enrichment needed so they can differentiate themselves.

When we have this working well, we can apply all the way down through taxonomies so we can actively change questions at lowest levels and rerun without worrying too much about how reruns will affect other areas of the portfolio.  If substantial changes are made only at sector and below levels - we can concentrate reruns there - and thus improve portfolio across the breadth of the taxonomy - improving scoring and questions at lower levels.  Only when question changes bubble up to portfolio and higher taxonomical levels like super-sector do we need larger reruns to get all up to date - but that can happen when we are satisfied questions are stable for awhile at that level.


This is a complicated set of steps so we want to have enrichment handle this.

**
Perhaps enrichment can use scoring snapshots without pushing them as default.  Instead of just selecting the score an using current - can use different scoring snapshots

We might want a best of auto-snapshot feature to be created to do the best snapshot at any level based on the latest data - we can have system suggest best settings.  Also we can auto-create snapshots after enrichment that update and then do desired normalization as first step to iterative versions of this (maybe have iteration up to N times part of enrichment, and shoot for smaller goals first, redo it with tolerances, leaving space for bubble ups from normalization)  In other words, patents in the top N that score worse with new questions can dip below other patents to get new questions answered
**

So our scoring/reranking/snapshot/enrichment should
- incorporate new data and within the up to date snapshot, lets the new stars rise, and previously highly ranked fall a bit
- let the normalization let the best of the previous (which should be close to same relative ranking as before) rise about patents that fell out of the topN with new data - so they get a chance to rise legitimately with new data included

When we select a snapshot size that is larger than consistently scored group, a popup should show previous scores and the normalization actions that will happen.  We might want to test normalization and make sure it creates an effective mix of new and old - we can do a test normalization or a goal seek to interchange some number of old and new.

In terms of current changes that have been made and not tested, we made some enhancements to normalization.  I am afraid we might have focused too much on adding a few mathematical variations, rather than the practical implications of normalization - it will lower some patents' rankings and raise others for the purposes of further enrichment during the critical enrichment pipeline which is meant to allocate attention on deserving patents, bubbling up good ones, and bubbling down less promising ones.  Perhaps rather than focusing on different mathematical variants, we can use simple techniques that use old score snapshots to achieve this.  We might event let the user specify a desired overlap or bubble-up range during a snapshot normalization - to ensure an overlap happens so that some patents that have already been enriched to the latest version move down in rankings and some move up in rankings - so that they can get the latest data and be more fairly scored subsequently.  If we do this in a iterative goal-seeking enrichment (with parameters to control the overlap, max number of iterations, max budget - or LLM enrichment operations), this might be much better than 

And we might have automatic snapshot creation that uses common sense techniques - or at least smart defaults when we choose to create new scoring snapshots manually - so that patents with LLM questions behind the most current, get mixed in fairly.

Lets explore this design a bit to come up with something practical and useful - this is some of the most important stuff to improve currently.  We are in a difficult position of having spent a lot of time and money on LLM enrichment with the desire to continue to improve it - but we must have a robust way to incrementally improve.

And we should generalize enrichment beyond just super-sector to run at other taxonomical levels - like scoring, taxonomy, etc. we should generalize what was previously artificially constrained to portfolio and super-sector level scores - we are essentially changing this to use any scoring snapshots available at a given level.  So if we want to enrich a sub-sector or sector iteratviely and improve questions, we might use sector specific scoring (that incorporates the latest questions being iterated) to thus give us a method to evolve the structured LLM questions and related scoring.

And as we add other data types to the systems (products, etc.) we might have similar enrichment pipelines involving different data sources relevant to those entities.  This is for future development - but we should consider in our schema, service, and GUI design that we want these services and components reusable.


***
left off here
***


## Proposed Changes

### Enrichment Pipeline

<!-- Overall data enrichment flow -->

```
Raw Patent Data
    → Basic Enrichment (XML parsing, CPC codes)
    → Citation Enrichment (forward/backward citations)
    → Competitor Enrichment (competitor citations, density)
    → LLM Enrichment (structured question scoring)
    → Score Calculation (weighted composite scores)
    → Snapshot Creation
```

### Auto-Calculation

<!-- What gets calculated automatically and when -->

We can have auto-calculation of snapshots after enrichment as an option (and we might do this in a loop with a goal seeking enrichment algorithm).  Since we know what has been enriched, we can certainly rescore based on current weights v2, v3, taxonomy level scores, etc. as appropriate and allow the user to select but also set good defaults based on context.

We may also which to reset snapshots after the user changes weights - those are the two major times where we want to recalculate scoring and snapshots - 1) after users change weights either in basic scoring (what is now v2 - slider based), or consensus scoring (what is now v3), and 2) LLM enrichment (or other enrichment that fills metrics used for scoring - right now after basic patents view import, this is only LLM enrichment that creates new parameters for scoring).  Another exception might be when we import new competitors we might recalculate base scores, but generally we do this at the beginning before importing patents.  So we want options to auto-calculate scores and snapshots after enrichment.  Possibly after importing new competitors and/or affiliates if it affected scores - we might want option to auto-recalculate those.  We may need to add base score to the snapshot capability, not sure if that is in place - in order to implement auto-recalc of that score.

But then when the user is recalculating with sliders - we might want some options on how to create wider snapshots that combine data with different LLM question revisions, using a few different normalization options including the goal seek/overlap method - and the ability to select the top N within whatever score used for ranking (base, portfolio (v2 or v3), or taxonomy based scoring where appropriate - note this will affect scores that are only usable within the taxonomical subsets for now - later we might renormalize taxonomy scores across the portfolio to be used more widely).  

So in one sense the user is initiating re-calc and pushing of snapshots after changing weights - but we have some auto-recalc features to help them fill out the snapshots across heterogeneous versions of scoring parameters.


### Auto-Normalization

<!-- When normalization is applied automatically -->
The current understanding from our last session (which produced changes we have not yet tested) is much different than what is presented here.  We should simplify the math options implemented in favor of simple math utilizing aggregate snapshots taking before the auto-normalization and then using simple methods to create the bubble overlap we want - of just to apply averages on new or changed LLM metrics that are newly present since last calculation, to have reasonable defaults used for when non zero weights are assigned to new or changed questions.  The user will need help guiding through this process and can select how large the snapshot should be (top N or which type of score ) and basic parameters to help preserve what was learned in previous scoring and ranking while allowing new data to influence the ranking, but not dominate the scoring on patents for which the data does not exist yet - that is the focus of our normalization efforts.


### TopN Rerun Goals

<!-- How the system ensures top patents have fresh LLM data -->
This is discussed above.

### Batch Job Management

<!-- How enrichment jobs are queued, tracked, resumed -->
What we have in place is reasonable I think , but will be enhanced by our snapshot, normalization improvements and the ability to be more generic in our enrichment (not limited to portfolio and super-sector).  Initial implementations can keep the options we have now (we do not need to add enrichmnt down to sector/sub-sector initially or allow other taxonomies - but this should be figured into our design to have more flexibility when we do want to handle this.

### Staleness Handling
<!-- What triggers re-enrichment -->
We have discussed a revAIQ (revision of AI questions) type field rather than staleness boolean, tracking what version of questions a patent is up to date with relating to one taxonomy (if the patent has primary, secondary, tertiary taxonomical classficiations - which won't be implemented immediately but coming soon) the system needs to track version that has been run previously so we know what to rerun when requested.  The user will trigger re-enrichment, but the system figures out which in the topN will be prioritized and how that topN is calculated through the enhanecments suggested in these documents.

We will also need to record model used - this can also be used to determine latest if data is at maximal quality.  We might have multiple factors considered in our revisions including model, version within portfolio and any taxonomy factors (which taxonomy and what version of questions).  For multiple taxonomy associations, this becomes more complicated and we will often need to figure out per patent what the 'staleness' state is or what is needed to bring to maximal quality.  The patents can be grouped in snapshot subsets always where we are up to date in many factors.

***
Question on whether we really want version down to individual sub-sector, different Qs combinations with their own versions.  Or we can have a version across the whole portfolio - take a snapshot of all sub-sector questions as of that time.

Perhaps the way to do this, is whenever we modify any sector or sub-sector, we increment the version across the whole portfolio but at that level (for example sub-sector level).  Then we can change and refactor other sub-sectors, we just know when the last calculation was done, not necessarily which sub-sectors have been updated.  We can edit many sub-sectors and rerun them in current version, just at some point, we need to lock down current version so we increment again (maybe when we do more than one change to a given sub-sector in combination with other ones.

***

*** LEFT OFF HERE ***

**
Need to figure out how to handle versioning across multiple updates of taxonomy and also model combinations.

Maybe sub-sectors can have old versions and just increment when they actually change, so many will appear stale - only ones that have been changed more recently will have newer versions - but when an old one changes, it can either be incremented at that level of come up to the latest.

Any given overall version

portfolio.super-sector.sector.sub-sector 

can be recorded at each taxonomic level where the last Qs run came from and any given update will have questions changed just sparsely at different levels.

It is imperative then that we have one taxonomy type per portfolio to only have one version.

Maybe we just decide when to freeze a version, and before we do that - if we do not freeze and we change it - we invalidate existing scores - or we need to recalculate and determine what is stale.

Maybe we can use dates modified along with revAIQ to help short this out.  We can set in patent associated table containing scores, updated date and version.  If the version itself mod date does not match mod date in patents, we need to invalidate or determine what changed and if it affects patent.

Or maybe at the end of dot notation version with portfolio and taxonomy, we have an extra minor revisions (could be a letter), for changes along the way.

When we do sector/sub-sector expansion we may go through a few refactors, but it will not affect other sectors if they have not been modified (although might if we need to renormalize based on values in other sectors).



**



## Data Model Changes

<!-- Schema changes needed -->

```prisma
// Example schema changes
```

## Job Types

<!-- Different enrichment job types -->
In the future we will have enrichment jobs for sector, sub-sector, also for secondary and tertiary classifications (and more possible) - these will all be combined into the LLM questions asked for each patent (batch together all possible questioned needed for all taxonomical associations in one shot).  Also, we will have other types of taxonomies and very flexible association with patents and other objects in the future.  With all that said, we will keep what we have now for initial implementation, but design towards ultimate flexibility in this area.


## Priority & Scheduling
<!-- How jobs are prioritized -->
We may want to look at concurrency of jobs like LLM enrichment and others where there is a throttling limit.  Currently we can queue jobs and set some limits - but really the system should have a notion (and perhaps this is within admin settings) of the upper throttling limits imposed by the apis we use or self-imposed for cost control (like with LLM jobs).  While we can queue many jobs, our system should manage the limits to make sure they work within throttling constraints.  We can do a bit of design iteration on this and keep it simple to start, but the system needs improvement in this area.

