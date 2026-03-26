# Scoring Snapshots & Normalization

## Current State

<!-- Describe current snapshot implementation -->

We currently use snapshots to persist current scores based on the current state of LLM questions feeding metrics - and other data driven metrics, combined with user weights.  The snapshot can be compares against others for ranking movements (we can change sliders, taking snapshots, recalcualting and seeing changes), but can also be pushed as the default version of a particular score (e.g., v2 score).  That field is then persisted per patent and can be sorted, filtered, aggregates, etc.  Many things can invalidate scores including changed weights by user, changes to LLM questions, or taxonomy, etc.  When this happens, we do not want to force a rerun of all data affected, as this is expensive and we want to encourage incremental changes to LLM questions, weights and other parameters.  

We have recently implemented some normalization techniques to help this, but I want to rethink this approach.  We should do normalization techniques but they should be applied into expanded snapshots - where we might reconcile two different snapshots that have different versions of data.  But each of the source snapshots should be generally consistent within itself (either has all contemporary LLM questions, scoring, etc. on whatever subset represented within snapshot).  And then we can more intelligently combine snapshots.  For example, lets say we add a question to sector level and have snapshots that have data down to the sub-sectors.  If we keep the user weight at 0 for the new question we can effectively use old data.  But if we raise the weight - and LLM questions have only been rerun on some filtered topN patents - we can isolate that group as a snapshot, knowing its version is current.  And then we can apply a normalization that might place an average value of the new metric, but normalized down based on the original relative rankings so that it is fairly distributed - but we will also track that this happened and that the version of questions of some patents in the snapshot is out of date (so can be updated later).  But then we have a reasonable larger snapshot (the combination of the two original snapshots), that can be ranked together for further enrichment or analysis.


## Problems with Current Approach

<!-- What's not working? Limitations? -->
When we add new LLM question, change weights, etc. and apply to a topN of data we can get portions of the data out of sync with others and then ranking becomes difficult or arbitrary.  We have attempted to add some auto-normalization, but we can easily lose sight of what assumptions were made and assume that the snapshot is consistent when it is not.  We want a balanced approach where we can explicitly choose to expand a snapshot by combining other snapshots with a known normalization technique and retain the revision history of all data within the larger combined snapshot so it can be easily brought up to date over time, by incrementally rerunning LLM metrics and rescoring as appropraite.

We need to think too much about when to take snapshots and how they will be normalized to be useful - the system will have options to generate snapshots for us after events like enrichment.  Useful snapshots will contain a set of patents that have a common profile of structured questions that have been run with same version and model.  In addition, we may apply normalization to mix snapshots with different profiles to create a larger snapshot - but with a known normalization technique to effectively combine snapshots for our purposes - and we can do this iteratively during enrichment to provide the user with good snapshots to use at all times.  We might have a mode to generate a topN snapshot based on best data at all times, and then have an indicator for the user to view patents from that snapshot in summary or aggregate pages - by selecting data only from the best snapshot available.  

****
We can have a filter to limit to up to date snapshots.  If the user selects all data or a larger set, ignoring that filter - the user must understand the consequences of viewing mixed data - or we must always create a new snapshot or keep current an overall snapshot for all data.
****



## Proposed Changes

Add explicit combinations of snapshots, retain versioning - and have normalization techniques that will attempt to keep relative rankings consistent with before while incorporating new information like added or changed LLM questions.

**
left off here
**

### Snapshot Types

<!-- Different kinds of snapshots and their purposes -->

Snapshots Types: 

cross-model normalization
iterative topN calcs
expansion of user scores
consensus scores

These are just methods of getting to a snapshot that can be accepted by user for current scoring and ranking purposes - in practice after we mix a few snapshots, they really are all a hybrid of combination techniques.  Unless we rerun all patents in a snapshot through same model and version of structured questions, we will have potentially some type of hybrid snapshot in place.

After we take an action that affects scoring we generally can take a snapshot.

Snapshot expansion and normalization occurs to make activities more broadly applicable, especially when creating snapshots using hetergeneous scores (scores from different structured question versions, or from different models, etc.)

We can build rich and robust facilitities to iterate with multiple techniques to expand snapshots to have a best-of snapshot to have relative ranks for whatever need we have.



### Snapshot Scope

<!-- Portfolio, super-sector, sector, sub-sector scoping -->

v2 scoring (renamed to user scoring/portfolio scoring, shortened to porftolio scoring)
v3 scoring (renamed to consensus portfolio scoring, shortended to consensus scoring

We can always have a consensus version of any score

super-sector score
sector score
sub-sector score

And all above are specific to each variant in the taxonomy (e.g., if 100 total sub-sectors within a taxonomy, each can have its own score).  

**
Now this will be a bit tricky with LLM structured question versioning, as we can change questions within a specific sub-sector or group of sub-sectors for example, and that will not affect sector scoring, so if we are recalculating sector level scores we would maintain awareness of this so our sector level scores are not invalidated (or relegated to a less than up to date version) based on changes at sub-sector level.

Add to this that we might have multiple taxonomic associations and so to ask structured LLM questions for a given patent within a single request (as this creates efficiency with overhead of base context including claims and other long text) - a patent's LLM questions might be the union of all questions for all taxonomic associations.  So depending on what we are evaluating, whether the questions are up to date enough for the purposes will depend (if we we are looking at sector scores and we are up to date for the sector - we are OK).  And also consider that out of date scores can be dealt with via snapshot normalization and combinations - it is normal that we are dealing with out of date scores.

Snapshots are meant to help with this and we have the notion of how close they are to the latest and greatest of questions and models running the questions - but we often have a hybrid run with older questions and lesser models and our unique design of enrichment/snapshots/structured questions/scoring makes this a smooth evolutionary process.
**



### Normalization Strategies

<!-- How scores are normalized across different populations -->

Rather than focus on statistical methods, we want to use some common sense heuristics to normalize metrics that are sparsely populated or are out of date with respect to latest model runs.  Our system will typically be in a state of mixed snapshots of scores where different sets of patents have been scored with different versions of structured questions or a different LLM model or both.  One thing we can always do is take a sampling of scores using two different methods (for example using a better LLM model and a less expensive one).  By comparing aggregates of the samples and using the overlap, we can apply a normalization to bring forward the lesser of the two sets to the greater (e.g., estimate the scores that would have occurred for the snaphost using the lesser model if they were run against the greater model).  We should do this in a way that is conservative and does not artificially boost scores/rankings of lesser patents (we can attempt to preserve previous rankings roughly on aggregate - meaning the lesser snapshot had a relative overall aggregate ranking vs. the better snapshot, and we can roughly approximate that in the normalization while allowing some crossover.


Note that this works since we typically enrich the topN with newer questions or a better LLM model.  Lets say we run a better LLM model on the top 500 portfolio level patents where we previously had run top 2000 on a lesser model.  We could take an overlap of the new and old scores and see how they compare - see where one model scores higher vs the other.  Then we can attempt to normalize the total 2000 to approximate what we think would have been scored but be conservative to not promote too many from the bottom 1500 into the top 500 (we might set a max of 100 that can move - or use some percentage overlap for this).  We want to see that using the better LLM model finds more detail which will inform us that some from the previous top 500 were perhaps over estimated and we can move some down and promote some from the old set based on the normalization (the weights we use can vary to affect the type of overlap we want).  And then the new ones that have been promoted to the top 500 might be rerun through the new LLM to get scores up to date and we can repeat the process with the overlap for a few iterations promoting some from the bottom group scored with the old model and demoting some newly scored with new model and redo the normalization on the rest of the lower set.

With a few iterations of this, we should have better results that overall produce a good topN (in this case 500) and do a decent job of estimating the rest so we can have a new snapshot of 2000 that is useful. 

We should create these snapshots as part of enrichment and we can use this to score a complete snapshot with the best information available at any given time - and then capture new v2 or v3 score snapshots when we are satisfied.

The same might apply to topN within sector (which will be a more flexibile classification scheme going forward), to have good within taxonomy class scores.

And the example we use with a better model vs. a lesser LLM model could also be applied to new version of structured questions  vs. old - where we estimate the value of new questions with these normalization, rerun, and overlap methods.

The key is we use our enrichment screens to generate the snapshots and make available to other pages that need scores and metrics for filtering, ranking, aggregates, etc.

We will still let the user generate snapshots for scoring when they modify the weights also - but then we are storing the default weights that can be used when the system generates snapshots through enrichment.

We will also need the ability to clean up old snapshots as they will proliferate, especially when we have suitable snapshots for all patents in the system where old snapshots really are several versions behind.


### Leveraging Non-Latest LLM Data

<!-- How to use LLM scores that aren't from the latest template version -->

If we have updated LLM questions and are missing questions for patents scored with old data - we can conservatively apply a normalized average version for the new questions that will keep the patents not scored with the latest ranked relatively the same as before, but with some tricks to rescore some near the boundary between newly scored with a topN filter vs. the old as described above.

### Freshness Tracking

<!-- How staleness is detected and tracked -->
We need to preserve which version of structured questions have been applied on each patent portfolio wide and for each associated taxonomy.  Our version system must consider the various levels of the taxonomy, the overall portfolio level questions, the combination of multiple associative taxonomies, etc.  Instead of staleness/freshness, we might have a revAIQ (revision of AI questions) notion that applies and understands the different levels of questions in a taxonomy, at portfolio level, and that each patent might associate with multiple taxonomies.  Our versioning system can have a dependency tree and a convention that will allow us to track this properly.


### Snapshot Comparison

<!-- Comparing rankings between snapshots -->
When we rescore topN out of M, lets say top 500 out of 2000, where the previous 2000 had a snapshot of scores that produced a ranking within whatever score we are using - lets say v2 score (or user portfolio level score with new terminology used), we can keep the rankings from the old snapshot 2000 to use to try and preserve rankings roughly.  Since the top 500 has been rescored - we can expect some internal reshuffling based on new detail - but the old lesser 1500 we can roughly expect to still be the lower 1500.  Except we can engineer and overlap of some percentage (described above), lets say 100 and then iterate, moving some up from the bottom and rerunning and allowing some from the top to drop down.

Of course, we always know which have actually been scored with new versions and which were normalized into place (and we can use text of the reasoning fields to describe that metric was established with normalization).  But by being careful to not artifically inflate lower patents that have not had the latest model or questions applied, we can ensure that topN runs treat the most promising patents and the overlap iteration technique gives opportunity for new detail to demote previously overestimated patents in the topN while promoting promising patents from the lower M-N, enriching more patents in the process to evaluate overlaps and improving the normalization applied to the rest of the snapshot so we still end up with a snapshot of "M" entries that can be used as current.


## Data Model Changes

<!-- Schema changes needed -->

```prisma
// Example schema changes
```

## When Snapshots Are Created

<!-- Triggers for snapshot creation -->

## Snapshot Lifecycle

<!-- Creation, activation, archival, deletion -->
