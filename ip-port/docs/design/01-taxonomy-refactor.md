# Taxonomy & Sector Management Refactor

## Current State

Our current system has a single taxonomy consisting of a 3 level hierarchy of super-sector, sector, and sub-sector.  It is not clearly mapped in all cases to CPC codes but is partially.  I am not sure to what extent we have filled out this hierarchy down to sub-sector but we have focused on expanding the sectors, and sub-sectors in certain areas more than others.  Some patents are probably poorly categorized based on initial assumptions and we have not refactored very much especially at narrower class levels (i.e., super-sector level).  I am not sure we have an exhaustive hierarhcy where we always categorize patents somewhere (there seems to be some "unknown" classes) - we will want to evolve to having collectively exhaustive and mutually exclusive levels and a true hierarchy.  We might expand to more than 3 levels for our default hierarchy.  We still want to use this type of CPC based super-sector, sector, sub-sector terminology, but we might want to expand it, have more flexible variations, and the possibility of other taxonomy overlays to describe the patents or other objects in our database.  

One main issue with the current system is that we chose the taxonomy association based on the first inventive CPC code of each patent (I believe - we can check how this is currently done), so we are missing a lot of the richness of the CPC codes.  We want to represent most or all of the inventive CPC codes in our taxonomy associations and also have the ability to represent non-inventive or additional CPC codes.  But we want a compromise between pragmatism and a thorough classification system.  We have a nice structured questions system that feeds our flexible scoring capability.  These structured questions use the taxonomy to narrow in on specific areas and we want to expand on that.  Our coverage of the data with structured questions depends on good taxonomy and flexible associations so we want to expand on that to best leverage our innovative way of managing LLM questions on patents, other objects - and the ability to input numeric LLM answers (backed by text reasoning fields) into scores of patents (and potentially other objects in the system like products in the future).

We wish to make taxonomy more generic with our current super-sector, sector, sub-sector just one example of a hierarchical taxonomy.  We can assign multiple taxonomies to an object and name them (e.g, primarySuperSector, secondarySuperSector, etc.).  For now we can have a fixed number per object, but later, we might allow any number (and have a database relationship allowing this).  We should consider naming and how to store a flattened version of a fixed number of taxonomical relationships (perhaps we store primary, secondary, and tertiary and have a flat representation that can be easily filtered - and/or we can have a pure version in an associative table with as many associations for a single taxonomy (e.g., a global taxonomy for all portfolios in system), or for multiple taxonomies (e.g., different taxonomy for specific portfolio).  Also, the hierarchcy of the taxonomy allows us to not need to have flat fields for each layer (e.g. superSector, sector, etc.) we might have just the most specific class of the taxonomy associated - where the ancestors of that deep specific class are associated through the hierarchy.  These are all design issues we should consider and evolve the system - but we will start simple and keep existing functionality working as a guiding principle.

Also consider we might add many CPC codes to General/CatchAll category, and most patents may start out also in General category (should have logic to make primary sector be something other then General - and count based on how many inventive CPC codes in a sub-sector/sector to decide which is primary, except General - we will want to move those CPC codes as we can without messing upsetting taxonomy of too many patents)

There is the problem of choosing primary taxonomy, using inventive CPC and then clustering.  We need some balance between grouping CPC codes so that patents fall into clusters more naturally while preserving some orthogonality in the classes (i.e., to secondary taxonomy differentiates patents).  

We will want to refactor taxonomies with whatever algorithm we use to assign them in mind (e.g., if we take 1st inventive and then try to pull other CPCs into primary association or distribute across associations).  And should primary be weighted to be much stronger ?  We can preserve fields like how many CPC codes of each kind in association table and maybe overall weights of the class for the patent.  Our association table between patent and taxonomy should have the ability to have additional qualifying information like a weight or strength of the association, the number of inventive or non-inventive CPC codes within the association, etc.  This will be a challenge of the system - to have a taxonomy that can cluster CPC codes that fit naturally based on the patents in the system.  Generally within the system we have portfolios of patents in more specific areas of technology that are related to each other - so we only need a small subset of CPC codes to get a good enough grouping.  And at the lower levels of the taxonomy we might be down to the same granularity of the CPC system - but generally we will cluster these codes - so we can have a reasonable size taxonomy class for which we can construct structured questions.

We have code in the system where we refactored taxonomy and structured questions - we will want to move this to the GUI over time - so when we refactor taxonomy, we can see the results and ask the LLM to create new structured quetions, and then test the results and interate.  We can evolve towards this over time and continue to refactor using claude code - but we will want the user to understand that part of the system is the ability to change this.  We will evolve towards having the system be able to run 24/7 goal-seeking better organizations, refactoring questions, etc. with a fixed LLM budget so we can have the system improve itself.


3/15

Model Differentiation , overlap, snapshots, and sampling

Sampling - have ability to sample some pct of LLM jobs in enrichment options - write context input and output including flat files for prompt and response

Models - have as 1st class feature of scoring/snapshots, run different models and then normalize together in snapshots.  To achieve this, we can run overlap sample in both models and normalize using the results (can make that another sampling snapshot, either a ranking overlap or a diversity snapshot)

Snapshot - can really be any grouping, we can describe what it is where its derived from and what its for

Mostly snapshots can be generated by system - and user can set rules how they are generated including overarching best current snapshot based on enrichment runs - they may be partially complete in some cases and be filled out (could be up to topN currently but in progress with background jobs)

User initiates scoring based snapshots when scoring mods, but apart from that mostly by system

Lets figure out the snapshots generation with different methods

Also resetting scoring weights by system - not user scores except when overriding

And when the user overrides scores, maybe want auto-normalization across all at similar level, e.g., sub-sector scoring, might apply weights across sector or super-sector (if more questions in one sub-sector then another, can split the weights and renormalize the remaining part).  This is more conducive when we have term based scoring, need to add that (and can do some multiplicative factors while we are at it)


Scenarios for auto-gen of snapshots

Scenario 1 - Iterative topN rescoring, combining old and new snapshots, same model

Rescore topN at portfolio level or within a taxonomical level, after which we want to expand snapshot to N+M where M is the remaining scores available from another snapshot (probably older, perhaps same model older version, or different model same version - we want to have fewer variables so we would not want different model, older version ideally, but could be that as well with user choice).  It we selected the topN from the topM originally because they were higher ranked, then the topN+ up to M will have an older snapshot shared with the topN which now has newer scoring metrics.  We can normalize the missing questions into topN+ in an expanded snapshot by taking the mean values of all new questions and normalizing down from the mean by the overall score (used for the topN ranking, could be base score, portfolio score (v2) or other we are using), we can use that score perhaps using the mean across topN relative to topN+ specific scores - and can apply to normalize down new questions not available in old snapshot - the end result should preserve ranking pretty closely or exactly for topN+ while topN are reranked based on new questions and weights assigned to them.

We could also purposefully skew the above calculations to use greater than mean values as baseline to create an overlap in the rankings so we force some of the topN that have just been rescored to be below the topN+ (e.g., we could set this to 5% per iteration).  Then we can rerun scoring on the new patents from topN+ that are in the overlap group so that they now get up to date scores and can rerank again.  We could do a few iterations of this to goal seek and do a better job letting patents bubble up (if we started with our goal to rescore 1000 patents, we might start with 900 and overlap groups until we hit 1000).

This scoring and snapshot functionality will be critical as flexible scoring will be a main differntiator of our system.


Scenario 2 - Mixed model snapshots

Another possible remedy to expensive reruns of patents every time we change questions, taxonomy, etc. would be to use a mixture of LLM models.  We can score the topN as we understand it (we are always using an existing scoring snapshot), with the best model and then apply a lesser model to topN+ to get to a topM (larger snapshot).  We can intentially do an overlap, and then normalize scores across both models using the overlapped portion to compare the scores taken there.  We should calculate this to ensure we are saving money (i.e., the redundantly run set is not more expensive then just running all through best model), and to have some choices on overlapped set (might be taxonomical diversity, samples across rankings, etc.).  And this choice might be different based on what we are trying to achieve (topN scoring for portfolio vs. within a sector).  We should have presets for the various snapshot and enrichment settings (this can be added to the advanced features in the enrichment pages).


By combining the above scenarios - we might have a wizard style interface to help us run batch enrichment jobs based on a series of changes we made, for example, lets say the user changes some weights, we refactored some taxonomy, added some new questions at lower taxonomical levels (e.g., sub-sector), and refactored some questions from sub-sector up to sector.  With a mixed set of actions like that, we might want to rescore and enrich top patents manually and spot check to make sure all looks good, and then kick off a batch enrichment that will get a whole portfolio (or even across all portfolios in the system), up to date but using a budget constraint rather than rerunning everything through the most expensive model.  We will simply always track what has been scored with what version of questions, what model, etc. so we can always enrich further, but we are always looking at areas that are intersting at any given moment (e.g., topN within portfolio, or a particular sub-sector or set of sectors, etc. - could be anything deemed important at the time for analysis).




*** LEFT OFF HERE ***



***


*
For now want to achieve goals
- have complete hierarchy for taxonomy, general categories
- option of making it deeper
- can have port or global, can experiment in port
- have refactors available, versioning tied to structured qs
- primary, secondary, tertiary and beyond available
- but just one assoc to patent for each - and can walk hierarchy for rest
- LLM qs can handle all in one request
- implement starting with just primary for LLM and the rest, but others available for analysis, see how much overlap, etc.
- can we have named sub-sectors or others common for global taxonomy but different rules for different portfolios, so they show up based on filtering by name (rather than CPC code), could be interesting feature
- and then feed in to refactoring global vs. port when they diverge

- new abbreviation system throughout

So all should be in sector taxonomy, maybe General/General/General

Also natural way to build out taxonomy - have LLM suggest CPC groupings, names, etc.
*



***
Remember where we came from, mostly we needed to fix up snapshots and normalization to move forward
But also, want to more easily do sub-sector expansion
***

*
Also adding back data from patlytics and other 3rd party sources to a) do deeper analysis, using that to fill in other gaps with inferrence, and b) train our system to do the same or better

*

**
Need to add catch-all category to be exhaustive on any level of hierarchy, last evaluated rule
Does super-sector have its own rules, or just contain rules for sectors (meaning union of all of sectors)

We might want to add some prefix fules at super-sector also (can be or of beginning of all prefixes in sectors to start), that would allow catch all to be established

We could also have catch-all super-sector where none of those rules satisfied within portfolio

When patents end up in catch-all it is something we can queue as a task to refactor categories

**

***
We want some intelligence around inventive CPC codes vs. not and to establish primary sector for any patent, and whether it has alternate taxonomies.  If so, we might weigh taxonomies to one another (more advanced feature).  Or we might consider it evidence to help us refactor our taxonomy based on the patents we have to reduce the number ot taxonomies that express the tech area of the patent.

But if patents have large number of taxonomies, we would not be able to model unless we have one-to-many table in place for this.
***

*****
What would typical refactors look like ?

creating new super-sector/sector/sub-sector from the catch-all category

moving categories from one sub-sector to another to rebalance tech and size of categories to not be too large or small for ranking analysis and LLM jobs that might run on a whole category (if sub-sector is small enough, we might create an LLM job that can run on the entire sub-sector to provide more detail)

Refactoring a sector into sub-sectors (first time before sub-sectors exists - default behavior would be a single catch-all sub-sector before we create rules).  

Also, we may need to introduce naming convention so sub-sectors are unique, assignig prefixes to super-sector, sector

Each would have prefix of parent, then full name of child
Computing/computing-ui might be CMP/computing-ui
and
Computing/computing-ui/displays might be CMPUI/displays

Need to figure convention with "/" or other

When we select some filters, we might need to refaculate other filters for names of patents and whether members of selected categories at higher levels, but this is complex - maybe only if we evaluate one at a time, then we can recalculate the others in filters (might need an apply button)

Also for sector management and this particular taxonomy we want it to map primarily to CPC codes - so we can relay that to attorneys and others that understand the CPC system.  But if we need to refactor and cannot achieve what we want, we might add additional rules that use search terms, or even specific patent exclusion or inclusion lists to get the results we want.

So we need to review what we have with the patterns ,prirorities to make sure OK for refactoring, catch-all category, multi-level taxonomy (beyond super-sector, sector, sub-sector), and allow more levels, those are just labels - we might have sub-sector-l2, etc.), but for our default, try to keep to 3 levels and refactor upwards to get good distribution


Also I do not know what "PROSPECTIVE" is in sub-sectors, perhaps that was an old notion we need to remove - or something we can use to preview possible taxonomy changes, but the GUI should allow us to promote to live status.

What is difference between CPC Prefix and CPC Subgroup type of rules - we need more guidance on the latter are there cpc subgroups with descriptive names we can use ?

Also all of our sub-sectors need descriptive names (as do super-sector/sector) and we need our prefix system.

What does priority, scope, matches, active, etc. do in rules, lets get sync'd are we allowing portfolio specific variants (if so, need to copy in from another and have GUI support).  The priority could be useful if overlaps and may need that for catch-all.


*****

*
In database join patent to taxonomy, have more than 1 can either select by primary or not but still unclear if 1st one independent is arbitrary- also only goes back 10 years ?  If more than one can ask more llm questions, or for now start with one - how many patents affected 

Can store assoc to finest classification (subsector) and to taxonomy itself cause can be multiple 

Also have portfolio default taxonomy- so back down to one in filtering maybe still have flat version

Find doc on this, taxonomy stuff inventive cpc codes, etc.

For now can store 1 sub-sector on default taxonomy per patent (or have 3 slots), but then join to get other levels and require that there are all levels filled out to the bottom each taxonomy has a depth (can be general/general)

Perhaps I can build and maintain many classifications in the taxonomy manager.  Then for each portfolio, just set one as default - and can change it and view data that way.  Run LLM jobs against all, that are assigned to patent, why not ask the additional questions and have the data .  We should just have evidence that we have answers to certain versions of the questions and we do not need rerun.

We can have multiple taxonomy and refactor and try things and see counts of patents/categories, perhaps view questions/answers through that interface.  Then assign one and the other parts of the system work the same.

when we have expanded taxonomy for one portfolio, within sector, some lower group, can merge back into global - or into another - abilityt to overwrite sub-sectors or merge uniogn, intersection of rules

Exclusion rules at end, lower piroirty ?

Seed from config ?  What does this do ?  Need confirmation dialog, where is the config ?

Also on our performant denormalized schema as end game (still do intermediate versions)
*

****
IPC before 2013 instead of CPC, think there is an IPC->CPC mapping

****

We should break into primary, secondary, and tertiary, have a field for inventive CPC count, associated with each patent.  But we can also have a more general association table with taxonomy so patents with 11+ inventive CPC codes will have all associative data and ones with 5-10 can be used to help us refactor.  We should have a flag that gives us an idea of the coverage by the 3 taxonomical associations (100% if 1-3 taxonomical associations cover all inventive CPCs), and less otherwise.  

How should we handle non-inventive ?


***
Include sub-sector refactoring based on grouping inventive patents where possible - at least as one technique

We will assign multiple taxonomies (of same type), and then refactor based on 

This is where portfolio taxonomies might largely diverge from main one

But with multiple portfolio taxonomies, we can attempt to refactor the main taxonomy to server all in system

One major criteria - minimizing overall number of taxonomical classificaitons per patent 

We can filter by primary taxonomy or all - and we want to minimize how many taxonomies a patent is in - and subsequently the number of LLM structured question variants, until we know we are getting much better detail with more classifications
***

**
Make sure we have inventive differentiation on our CPC codes associated with patents

Also have a count on inventive and other types.

We will want to filter on those rare patents with many inventive CPCs
**


<!-- Describe current sector/super-sector/sub-sector hierarchy -->

Our current hierarchy is rigid and originates from a single (broadcom) portfolio and our initial notions of how to categorize.  It is based on CPC mappings but it is not completely clear and consistent how all are mapped (e.g., super-sector - we do not have rules in place for that).  

## Problems with Current Approach

<!-- What's not working? Limitations? -->

It is imbalanced with the numbers of patents falling in various categories.  It lacks catch-all categories that would allow each level to be collectively exhaustive.  It is unclear how super-sectors map to CPC codes - there should be more clarity regarding the levels of the CPC hierarchy and how we map.  We should have the ability to refactor and rebalance.  The names super-sector, sector, sub-sector are just contrived for one type of taxonomy, the system needs to support more variations with different names based on context.  We do not need all the rules currently implemented (search terms, etc.) that are not being used, we can focus on CPC codes and perhaps a few other rule types but test and make sure everything supported is working.

We currently assign the taxonomy (super-sector/sector/sub-sector) based on the first inventive CPC code, and the ordering is often arbitrary, so we are missing the additional inventive classifications (we still have CPC code associations but we do not use them for structured questions differentiation, etc.).



## Proposed Changes

### Hierarchy Structure

<!-- New taxonomy hierarchy design -->
We want a generalizable "taxonomy" that is hierachical, where we can name the levels, specify how deep it should be, and have catch-all categories (we can default this name to "general") within each.  We should have a prefixed naming convention so lower levels are discernible when they are used in filters (otherwise could have naming collisions - and not sure what we are looking at when filtering - although we can also improve GUI to limit contextually lower classifications within a taxonomy based on selections made to higher classifications but this implemention is tricky).

We want more robust taxonomy editing to allow taxonomies for an object type like patents to be established based on varied means like an existing system (e.g., CPC codes), or more general system (manual assignment, keyword or search term based, etc.).  Some of this is already designed into system, but we are largely using CPC code prefixes.  We want to extend this to general patent taxonomies (can have multiple per portfolio and standard ones across portfolios), and have refactor available to change the classifications as appropriate to better balance the classification system.  

Refactoring will have implications of invalidating existing scores and rankings (but old systems will be preserved and used through scoring snapshots as the system evolves), and the system will handle rerunning jobs accordingly, estimating cost ahead of time, and managing background tasks to fulfill refactoring.  The system already has a robust data enrichment capability to incrementally expand portfolios, and this will all be tightly integrated to allow the system to evolve naturally.

Also, we want to balance the number of taxonomical associations with each patent for pragmatism, richness, and flexibility.  Based on our current portfolios of interest, patents generally have anywhere from 0 - 11+ inventive CPC codes with median around 5 (we can redo analysis as we get into this further based on data present in the system when we refactor).  In many cases, the differentiation of the inventive CPC codes occurs at the lowest levels (closer to the CPC subgroup), which when mapped to our super-sector/sector/sub-sector - more often will vary at the sub-sector level or sector level and we can actively refactor the main taxonomy to suit our portfolios of interest (and eventually we could assign a different variation of a taxonomy to a particular portfolio and work on refactoring with a smaller set of more focused patents).  But based on analysis done  *** REF DOC HERE, e.g., CPC_Inventive_vs_Additional_and_IPC_Mapping_Guide.md *** , we believe having 3 associations should be a good balance, so we would have primary, secondary, and tertiary associations.  Or we can have a free-form number of associations through another entity, and have a default (1st or primary association) that functions like our current taxonomy and have additional associations that can be optionally called upon for richer analysis.

So we would want to refactor our taxonomy to best accomodate inventive CPC classifications across our patents of interest (more recent topN patents across portfolios in the hot super-sectors), so that they fit in fewer taxonomical classifications.  For example, if a patent has 11 inventive CPC codes, but they all fit within 3 taxonomy mappings (i.e., groups within the 11 all fall within mapping for a sub-sector, such that 3 total associations encapsulate all), that would be best.  Now we might store associations beyond 3 (but not have GUI support like primary, secondary, tertiary filters) to track all associations and assist in refactor.

We can also capture number of inventive CPC classifications for each patent, also overall count, additional counts, and count of CPC classifications not covered in the three associations (primary, secondary, tertiary) so we can easily filter patents that have further analysis due beyond our taxonomy classifications.

Now we can also associate the fields differently and this can be decided whether a flat class, secondaryClass, tertiaryClass might be made as fields within a patent or another entity with a one-to-one association with patent (to provide more flexibility of where our taxonomy is associated vs. patent specific fields), this will need to be decided during refactor design analysis.



### Multiple Taxonomy Associations per Patent

<!-- How patents can belong to multiple sectors/categories -->
*** LEFT OFF HERE ***

Ultimately, any object in the system that can be classified can have any number of classification systems associated.  They might be the same classification system with multiple classifications, or different ones.

Our current system has one taxonomy for everything, and it is hierarchical broken into super-sector, sector, sub-sector.  And the only "object" being classified currently are patents.

Our next iteration should have a generalized taxonomy where we can demonstrate that more taxonomies can be maintained, but for now we will just have one taxonomy for everything - still at super-sector, sector, sub-sector level (although we will add flexibility for deeper hierarchy in the future), and this will have multiple associations.  We will handle 3 such associations at the GUI level (where we can display and filter these associations), primaryClass (or just class), secondaryClass, tertiaryClass.  We might maintain a table association that has more (so that all CPC codes are mapped), but we can priortize and refactor to focus on the 3 associations per patent for now.

The most important thing is we do not want to lose the rich associative data of the CPC Codes assigned to patents, but we need to make it manageable and focus it on our goals for specific portfolios and interest areas.  

We are enhancing our current taxonomy to have better naming conventions (with prefixes for higher levels to make all classifiers unique), and with general categories at each level to be a catch all to ensure all levels are mutually exclusive and collectively exhaustive.  We can still use the primary as the main focus where it exists in current places in the GUI (like sector pages, enrichment by sector, etc. - we can start by only allowing the primary class to be used there).  This will help us have a reasonable migration path where we can test existing functionality during changes without too many changes at once.

We want to use the flexibility of our structured questions and versioning system to our advantage and we can create a completly unique set of questions for a given patent based on its membership in different classes of the taxonomy.  So for example, if a patent has 11 Inventive CPC Codes and through our taxonomy refactoring we have those spread across 3 taxonomy classes - we can ask questions in a single LLM request that satisfy all of those taxonomy associations, so overtime we build the library of questions asked of individual patents.  Our versioning, snapshot, and enrichment systems will handle that different patents have different current versions of data that has been run.

We should also take note that since we have a clean hierarchy for our taxonomy, we do not need individual fields for super-sector, sector, sub-sector as we do now, as we can get those through joins (and now we will have 3 major associations).  But whether we have a flat database representation that has the 3 main associations (primary, secondary, and tertiary) broken out for easy joining/filtering, and then within those, can have the 3 levels (super-sector, sector, sub-sector) is an implementation detail.  Ultimately, we can have new taxonomies with new level names (i.e., not sector based), or deeper taxonomies (i.e., in the future we add sub-sub-sector or sub-sector2 for deeper hierarhcy), and that would then require schema changes - but this is OK if we make a conscious decision on current pragamatism vs. ultimate flexibility.  And our schema may take on both variations (metadata tables describing the practical mapping of our pragmatic de-normalized tables vs. the future golden model allowing more flexiblity).

We can also use multiple taxonomical associations to compare scores in differentiated levels to determine appropriatness of the association and potential for refactor.  For example, if one association at sub-sector level for a patent shows very high scores in the sub-sector specific questions, but another shows poor scores at sub-sector level, perhaps the latter association should be re-evaluated - and if this happens for many patents with similar associations, we might refactor the sub-sectors.  So we should have an overall approach to refactoring that uses some statistical techniques on the current taxonomies and associations and evaluates alternates at approporiate levels (for example, we might evaluate from sector level down where there is a lot of score variance at lower levels).

Also note that when we do taxonomy refactor - we might want to use a less expensive model and create scoring snapshots with that model for use in analysis.  And once we settle on a better taxonomy and reclassify patents - we might use a better model to 1) generate new LLM structured questions and 2) run the structured questions on the topN for any interest area (portfolio level or a specific super-sector or other taxononmical class).  We can always use the lesser model for lesser ranked patents and use our snapshot combination techniques to fill out data.  This way we can refactor as needed and manage cost of doing so.


### Sector Management UI/API

<!-- How sectors are created, edited, managed -->

## Data Model Changes

<!-- Schema changes needed -->
We may eventually want to model this entire system with a highly flexibile EAV type schema to enable scores and other derived facet calcs at any level.  And then a completely flexible taxonomical system with hierarchical and non-hierarchical classifications that can have any number of associations.  We would model many objects beyond patents, including products, and we could extend the system to general e-discovery docs or any documents for that matter.  But for now, we need to take pragmatic steps to extend our schema, allow more flexibility while not making the queries overly complex.  We might break out score, LLM question fields, patentsview api fields, taxonomical associations, etc. in to separate entities that can be joined to get full patent data rather than having a patent entity with many fields across many functional areas.  

We can make a few practical choices at compile time for now to have finite scores available, finite associations that are visible in GUI etc, so that we can create a reasonable compromise in the schema design.  We might have "userScore", "consensusScore" (equivalent to current v2, v3 scores), taxonomical scores at any level (e.g., for any sub-sector with different questions, the system has the ability to score and rank within that sub-sector - and this could be done for primary, secondary or tertiary associated taxonomies).  Now in practice, in the short term, we will use default weights for all of these and have the system set them en masse rather than expect the user to change weights on all scoring calcs - but we want the design of the system to support such user changes.  But in initial versions after refactor, the user will not be able to create new taxonomies, or new scores (but the general design of the system should support it for long term).

We might include some metadata tables, EAV or other style that describes our schema to marry long term flexibility with short term pragamatism, and we might want to demo features that highlight long term flexibility - but without making the features available for user manipulation yet.  For example, we might have read only admin screens that show structured questions down to sub-sector level and corresponding weights for scoring set by the system - so we can demonstrate to users that in the long term we have control over all of these things from the GUI, but in the short term, they are set within are coding pushes using claude code.


```prisma
// Example schema changes
```

## Migration Strategy

<!-- How to migrate from current structure -->
Let's add the new flexibility to the system but focus on getting the GUI working and making some simplifying assumptions:

1) v2, v3 scores can be renamed and we can add ability to edit/view other scores on those pages, but for now we can just support the existing scores first and incrementally add ability to edit taxonomical level scores
2) we can add more taxonomy associations, but we can still focus on the primary in terms of getting existing system and GUI working

I think we can break out some more entities and move fields around, but we still will have a patent focused schema for now (later we can add more generic objects and may need EAV model mixed in and have metadata to describe additional entities).  So, we might partition fields into a bunch of tables associated with patent with one-to-one or one-to-many (for taxonomy), and split up the fields coming from different enrichment endpoints - and still have separation of keeping some long text out of schema and in json and/or elastic search to keep size of database reasonable.


## Impact on Other Components

<!-- How does this affect scoring, snapshots, etc.? -->

All components will be affected as scoring will need to be more flexible to be applied anywhere with a unique set of questions/metrics that can rank a set of patents (or more general objects eventually).  The snapshots will be used to help transition and evolve the system with new questions being added at any time, so the snapshots will need to apply to scores at any level, as will the score/snapshot/structured questions versioning system.
