# Generalized Weighted Scoring Framework

## Current State

<!-- Describe current v2-enhanced scoring approach -->

We might want to rename v2 scoring and v3 scoring, to "User Scoring" and "Consensus Scoring" or "Team Scoring"
And then we will have levels including portfolio, and taxonomical levels (currently super-sector, sector, sub-sector), but more levels and different named taxonomies might be available moving forward.

Note we need to have generalied views of these scores within the Sectors page (which should be renamed to Taxonomy Scores or Taxonomy Ranking).

We wish our scoring formulas to be more flexible, beyond weighted additive formulas, we want to have subterms, multiplicative factors and more options beyond linear, sqrt, log, etc.  We can introduce constants like offsets, multipliers, divisors, exponents, etc. to individual metrics (numeric fields returned by LLM questions or calculated simply from uspto or other data), to add more flexibility.  For example, instead of sqrt as one curve on a metric, we might change to n-root and have n be > 1.0 and <=4.0 or some range so that we can have square root, cube root, or other reasonable variations.  The same with log (can have base 10, natural log, etc.).  Whatever scoring formulas allowed, we still want user control limited (once formulas for a given score are established - which is an admin function) to sliders affecting weights - so the user has a simple mechanism to affect rankings.  We will continue to use consensus scoring as well (where multiple users can affect weights and vote collectively on ranking), and also allow normative view manipulation in the future (where user can just change the rankign directly and from there we can change the weight sliders and identify error if that is not sufficient to rank as the user desires in the manually set normative view - and this might trigger restructuring of formulas, introduction of new metrics, or further negotiation between users to agree on a result.

The current scoring has a base score - which is a portfolio or actually system wide score (we can decide whether to vary at portfolio level) to prioritize and rank patents based on minimal and free information from uspto apis, etc.

The formula can change (more below) in advanced versions, but OK for now

v2 score - really if portfolio level score
v3 score - is consensus score of v2, theoretically can have super-sector, sector, and sub-sector consensus scores also - or any further taxonomical scores we design, there can be user scores (single user weights), or consensus scoring (multiple user weights with profiles).


When we add new structured questions to any level - and there are initially no weights for these (since user set weights based on previous questions), we can start with 0 weights for new questions.  If we make them non-zero, we will need to perform some type of normalization to mix snapshots - this is discussed in other areas of these docs.



## Problems with Current Approach

The system works reasonably well but mostly has issues when we wish to get more detail about patents through additional structured LLM questions.  When that happens, it can cause a number of issues
- current scoring formulas do not consider new metrics returned by LLM questions
- typically new questions apply to taxonomical levels (e.g., sector) rather than portfolio wide, and we need scoring to be more flexible to apply at different levels (globally, portfolio level, or any taxonomical level, currently super-sector, sector, or sub-sector)
- running new LLM jobs will often invalidate old scores if questions are added or changed, and our system does not track versioning sufficiently to handle this gracefully.


## Proposed Changes

We make scoring a more general service and GUI that can apply to different levels (portfolio, super-sector, sector, sub-sector for now - but the notion of taxonomy will also be expanded).  Our current "v2" scores are really portfolio level scores - but we can apply the same scoring paradigm (using LLM questions to establish metrics that can be input to formulas with weights that can be manipulated by the user).  We should have the GUI and service around scoring be able to apply to any type of score in the system that uses this paradigm.

In the future, we will allow much more flexibile scoring formulas beyond simple weighted coefficients controlled by user multiplied to a LLM or other type of generated metric.  We might have multiplicative factors, subterms, offsets, variable exponents, etc.  We do not need to implement this right away - and we want to maintain current compatibility, but as we are redesigning, we should keep future design in mind.


### Metric Types

<!-- Different types of metrics: quantitative, LLM-derived, computed -->
Yes - we have quantitative (e.g., number of citations), LLM-derived (e.g., design around difficulty), computed (e.g. competitor citations - takes into consideration number of competitiors and number of citations, also another type would be v2 score itself as that is a weighted formula on metrics).  In the future we may have subterms (which could be defined as intermediate metrics or computed metrics dependent on others).  So we may want to consider that now in the redesign, although we will be maintaining current functionality for the initial refactor in this area (although we will be immediately enhancing scoring snapshots and normalization).


### Weight Profiles

<!-- How weights are defined, scoped, applied -->
Weights might be expanded in the future to be more flexibily applied within more general formulas rather than being constrained to be a coefficient of a simple metric.  We have weights at "v2" level which are really just portfolio level scores - but we might also have super-sector, sector, sub-sector scores using the same types of weights (although more will be available since more questions at those levels returning metrics).  The same paradigm could apply and we could use the same GUI and services to implement scores at any level using the weight profiles and the slider GUI paradigm.  The "v2 score" notion is a bit of a misnomer - we can keep the name for initial refactor, but really that is a portfolio level score, and we might apply the same GUI to other scores and rename the page for general scoring (and v3 scoring really just means consensus scoring added to another score - in this case v2 or the portfolio score).


### Scoring Algorithm

<!-- The general formula/approach for computing scores -->
For now, we will keep the same type of formulas but in the future we may add a number of new options to how weights are applied, the types of metrics and scaling (can expand from linear, sqrt, etc. to general n-root with n being supplied as a constant parameter for the metric, an additive offset where appropriate, etc.) - we will be designing a more general formula management system where we have a mixture of parameterized weights that can be controlled by sliders (or other types of controls if appropriate) mixed with the metrics returned in various ways and constants tied to the metrics that can only be modified in an administrative sense (not controlled normally by user - but may be changed occasionally to affect the formulas by a system admin).

We might also evolve to have grouped terms of weights combined with metrics from LLM questions or other system metrics.  The grouped terms can have overall coefficients - this might make normalization much easier.  For example, for a multi-level hierarchy, we can have some portion of the overall score from the sub-sector level vs. the sector level.  If we had grouped terms for portfolio questions, super-sector, sector, then sub-sector - it would be easier to set overall weights of each sets of questions and create an overall score (for example, we might weight all portfolio questions at .5, super-sector at .2, sector at .1, sub-sector at .1 - and within each term have the specific structured questions at that level).  Then we could easily set the weights of portfolio vs. super-sector and others and separately within groups set relative weights of each questions.  This is only one such use of grouped terms.  Another use might be to get a good represenation of citation weights since that might involve competitive vs. non-competitive citations, etc. - and it might make sense to have it all within a single term that can be weighed by the user.  So evolving towards grouped terms as part of our calcs (i.e., adding parenthesis to the formulas) will have many uses.


### Extensibility

<!-- How new metrics can be added -->
When new LLM questions are added, new metrics generally arise as the number returning questions.  We might also add other metrics from other data , like USPTO data, for example, we might want inventiveCPCCount, additiveCPCCount, etc. applied to each patent - and this can be pulled from patent enrichment data.  In the future we will have GUI features to add LLM questions or to refactor current structured questions - so this will become a dynamic change - for now it is only done with code revisions and/or metadata (e.g., structured questions json) changes - which show up as revisions in the source tree.


## Data Model Changes

<!-- Schema changes needed -->
Changes should be made to support more flexible taxonomy, the possibility of other entities for product and other documents (in the future we might score e-discovery or other types of documents with a similar paradigm).  Scores will need to be more flexibile in the future allowing more formula variations.  We must expand our snapshot capabilities to better leverage existing scores as changes happen naturally (we do not always want to invalidate existing data we have paid for with LLM fees and some hard work to arrange and calibrate - we will have expanded snapshots and normalization to help leverage existing scores).  Our schema must better support this and have excellent versioning of scores, structured questions, and the ability to invalidate - or more precisely to track revisions of scores and questions - so like a source control system, we know how far behind a given area of scores might be - and we will know how to get data in sync when necessary or to best leverage out of sync data to make reasonsable comparisons.  We will be developing a more comprehensive versioning contention in the near term to be able to make these calculations and rather than have a notion of "staleness" we may have revAIQ (revision of AI questions) and have a convention like 1.2.1.4 for each structured question inheritance tree (portfolio.super-sector.sector.sub-sector) or something similar where we can have awareness at what level questions have changed that would require rescoring, new snapshots, etc.


## API Design

<!-- Key endpoints and their behavior -->
These will need to be modified as needed to support more flexibility in the system, and in the near term enhance our snapshot ability and the ability to apply scoring screens to other scores besides just portfolio level.


## UI Considerations

<!-- How the scoring UI should work -->
We should have more general use of the scoring screens.  The current v2 scoring page can just be a general scoring page that can apply to scoring at various levels (portfolio which is really the current v2, super-sector, sector, or sub-sector with the latter 3 having enhanced metrics from more LLM questions).  And in the future our taxonomy may be more dynamic and include more levels (and different names for taxonomy levels, super-sector, sector, and sub-sector are just one naming convention).  Also names of scores might be enhanced or changes (v2 is just portfolio level scoring and v3 is consensus portfolio scoring currently), but those scoring pages can be applied to other scores - and ultimately we will be able to have as many scores as we want as multiple taxonomies will be supported - we can expand how many levels each taxonomy spans - and each patent or other system entity might have primary, secondary, tertiary and beyond associations with any taxonomy (a good example if the multiple CPC codes applied to each patent from which our current taxonomy is derived - we could be assigning multiple taxonomies).  So we should leverage our existing scoring pages and just change them to be able to apply to different configured scores in the system - in the future we might allow this to be added via admin or other GUI function - more scores might be added dynamically to the system.

