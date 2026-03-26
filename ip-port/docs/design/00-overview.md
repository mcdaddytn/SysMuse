# Design Overview

## Vision

<!-- High-level vision for the system redesign -->

The system was originally built to analyze a single portfolio, the broadcom patent portfolio, but is evolving to be an I.P. management tool.  It supports multiple portfolios and can discover competitors and affiliates and fill in data incrementally to be analyzed for each portfolio and in comparison to other portfolios for competitive analysis.

In addition, to processing patent data, it will evolve to gather and synthesize additional data on products, product subsystems and components, corresponding tech stacks aggregating patents, and the patent information to better predict infringement and licensing opportunities.

It supports a single taxonomy to arrange patents currently, loosely based on USPTO CPC codes, but that taxonomy can be generalized to any classification system including hierarchical systems and non-hierarchical systems.  We will evolve the system to handle multiple taxonomies for any object in the system including patents and will expand taxonomies to also apply to other objects other than patents.

There is a scoring system in place that has a few scores that can be applied to patents, but this will be generalized to have as many scores as a user wants, and also to be applied to other objects like products.

We want to redesign the system, but implement changes incrementally keeping the system working at all stages.  So phasing this is important, and we should make good choices as to what is possible to implement next and what is helpful to implement next.  Ask questions as necessary and I will guide through design, implementation, testing and then additional iterative cycles to get to a more ambitious version of our system.

Early on, we should create a strategy of tags/branches of versions, etc. as needed to make sure we can get back to a working version, or deploy a previous version for comparitive regression testing.  We will want to have access to a previous version that we can use to do regression tests on data - so we should walk through that process - an instance can be on the local network, and we will also work towards deploying a version on a server that will be always on.

Also we can create additional services, schema entities, etc. to faciliate analysis that will help with redesign - e.g., we can do extensive analysis on CPC code distribution and how we might refactor taxonomies.  So early in the process, we can create additional services that will help in the refactor and we may create a claude code skill related to a data service that can help with redesign and regression testing.


## Problem Statement

<!-- What problems are we solving? What's wrong with the current approach? -->

The current system was not designed with all of this in mind, rather was built from the ground up to gather as much free data on the broadcom portfolio - and then to add in LLM analysis of that portfolio.  Features were added incrementally without a more comprehensive design in mind and now that initial design is straining and we must re-design to better anticipate incremental improvements.  We will solve the problem of allowing an I.P. professional to analyze a patent portfolio to identify competitors, related patents, and opportunities for infringement cases, licensing, acquisition of new companies based on patent portfolios and products, and strategic positioning for future I.P. development.



## Design Principles

<!-- Guiding principles for the redesign -->

In the process of making our taxonomy and scoring more generic, introducing the possiblity of more objects to be scored and classified then just patents, we want to preserve the existing functionality and add flexiblity incrementally.  We can add metadata EAV style entities (although we can leave out the "V" portion - and have metadata tables that describe the current pragmatic schema for patents with current superSector/sector/sub-sector taxonomy and v2 and v3 and sector scores).  Our schema can be a combination of a more generic version that can handle the ultimate flexiblity with a pragmatic version that implements the current capabilities so we can evolve slowly.  So at first we can add metadata descriptions of current tables, and make incremental changes to add more flexibility.  We also have some data stored in .json or .xml files for long text and we have the ability to use elastic search for long text (although not being actively used), but in any case, our metadata schema should describe where any data item resides and have data on how to put data together and return in a data service, rather than having hard-coded paths for json, xml retrieval of data.  Also complex queries might be constructed using metadata, so that we can avoid hard-coding queries as much as possible.  This will help as we evolve the schema and make it easier to track changes.

We can enhance our services for Patent Summary, Aggregate View, sector views, etc. with exports through services - so we can capture current data to compare against future versions to provide good regression testing.  We might deploy a previous version of the system on a machine to be accessible during refactor so we can check live data snapshots and/or take a set of test snapshots for regression testing purposes before refactors.  Early on we can enhance our services to make regression and refactoring easier before getting into riskier changes.

We wish to make taxonomy more generic with our current super-sector, sector, sub-sector just one example of a hierarchical taxonomy - this is described in detail in other docs.

We wish scoring to be more generic, with any number of scores able to be named and created (again for now, we can choose finite score fields - but we should begin designing for the more general case).  This is described in more detail in other docs.


## Component Relationships

<!-- How do the major components (taxonomy, scoring, snapshots, enrichment) relate? -->

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Taxonomy     │────▶│    Scoring      │────▶│   Snapshots     │
│  (01-taxonomy)  │     │  (02-scoring)   │     │  (04-snapshots) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                        │
         │              ┌───────┴───────┐               │
         │              │   Consensus   │               │
         │              │ (03-consensus)│               │
         │              └───────────────┘               │
         │                                              │
         └──────────────┬───────────────────────────────┘
                        │
                ┌───────▼───────┐
                │  Enrichment   │
                │(05-enrichment)│
                └───────────────┘
```

We will be designing and maintaining taxonomies to organize patents (and other objects like products), but lets use patents as our tangible example.  We can enrich data based on a scoring or ranking to choose which patents to get more data on which might include paid sources like LLMs.  Patents can be ranked by any score or parameter for this purpose, for example we could use patent number of grant date descending to get newer patents first.  Then we can grab some free data that is quick to acquire (like uspto basic data), and establish a base score , also figuring in remaining years on the patent, citation count, etc., after which that can be used to rank patents with that data.  Then we can start running LLM questions on the patents and do portfolio level ranking next (known now as v2 ranking), which can then be used for enrichment decisions to grab more data.  So once a score is established for any group of patents, it can be used to rank them for further attention.

But since this will always be incremental, we must have robust features to handle that - and we can use snapshots for this.  Any group of patents with the same data available can be loaded into a snapshot (save current calculated score of any type based on current data), so that snapshot is available to rank patents even if data changes or questions/metrics evolve (then we mark data as stale, but it can still be used).  Often we will have multiple snapshots or sets of patents with different data, for example set 1 has all uspto basic data, and set 2 has uspto basic data plus portfolio level questions up to date.  In that case, if we want to rank over a greater set, we might combine snapshots by applying some type of normalization calculation to create a greater snapshot that is the union of both snapshots, and fill in the missing data with some technique to estabish a score within the greater snapshot set.

Different factors might invalidate snapshots:
- new structure questions at any level (portfolio or taxononical level), related through an inheritance structure
- user reranking through slider/weight manipulation
- taxonomy refactoring

So rather than have a binary notion of "staleness" we will evolve to have a more robust notion of how up to date any data in the system is.  We will have ways to combine data from different recency levels in terms of questions asked, models used (higher and lower cost LLM models), and other factors - so our system will naturally navigate having data with the highest quality LLM model questions and latest taxonomy refactor and questions refactor - mixed with older versions.

We can always use existing snapshots and decide when to calculate new ones which makes enrichment easier - we have good enought scoring to decide what to turn our computational attention to next and which data to get through limited throttled, apis, etc. - a good way to manage finite resources to expand our understanding of the data).  Having a best version of a snapshot at any time helps us prioritize what to expend computational resources and human attention on first.  The system is always in a state of evolving knowledge.

We have user scoring to allow a user to change weights to affect a score that can be used for ranking or priority of expending resources.  And then consensus scoring is just a more advanced version where multiple parties can participate.  This will create more mature assessment of portfolio once it is largely filled in - to prioritize for more expensive activities like litigation assessment.  So those are nice features to manipulate weights - or the system can use the last set weights or defaults and always create overall scores without further user intervention.


## Data Flow

<!-- How does data flow through the system? -->

Generally we will follow the sequence:
1) add a company to the system
2) discover affiliates and competitors of the company
3) begin data enrichment with topN patents generally with simple uspto patentsview data retrieval, maybe top 500-5000 based on our anticipated need for depth in the portfolio or our educated guess at the size of the portfolio.  This first enrichment will give us an idea of the taxonomical breadth of the patents (i.e., which classifications are filled out within the topN - which from first enrichment will likely be most recent patents).
4) Depending on what we discover, we might download all patents for the portfolio, and then all related patent data (patent families, odp, prosecution history, bulk data extration (long text, claims, etc.).  Or we might decide to enrich by taxonomy, for example choosing topN within more desirable super-sectors and avoid super-sectors we have little interest in)
5) In parallel or after that step, we can enrich LLM data which generally consists of running portfolio and taxonomy specific questions (e.g., super-sector/sector/sub-sector), since our questions are inherited and we use the optimization of batching all known questions for a patent in one batch
6) We might do taxonomy refactor if we decide our current scheme does not classify the interesting tech areas with sufficient granularity.  This might trigger reruns of LLM jobs - or at least invalidate or mark as stale some of the data in the system (e.g., the sector being refactored or for which questions are added).
7) We then might fill out competitive portfolios in the same way (likely we will start with fewer patents for competitors, just getting a sense of top most recent patents to see what areas they are strong within).  But when we get down to specifics we might selectively enrich areas of competitive portfolios as well.
8) We may iterate through the above process a bit until we have a good handle on our portfolios strengths and overall value and some competitive information, after which we can start inferring product information.
9) As we get into filling in product information we may, rank top patents and send to 3rd parties, to fill out product data, run family expansion, create focus areas, and specific prompt templates to begin to infer product data (and this is one of the major areas of the system we can enhance in the future with more web search, 3rd party data, and additional features to fill in gaps in product knowledge where information is private and proprietary).


## Key Decisions

<!-- Major architectural decisions and rationale -->
We must do this work incrementally but over time, create a very flexible data model.  The system works now, we want to keep it that way, and add features that will add incremental value.  We will make more substantial refactors when strategic - when migration is simple enough to perform and verify.


## Open Questions

<!-- Unresolved design questions that need discussion -->
There are a lot of questions around filling in product information - I am adding some design ideas in doc *** fill in doc name  ***

We do not need to change the system specifically on the first pass to incorporate product information but rather our LLM questions, taxonomy, scoring, enrichment, and other features that associate, classify, evaluate patents might have equivalents with products and other types of entities described by documents.  Our refactor, among other things will position us to bring in more information to the system and apply some of the services.  In terms of products, our first effort will be to import data provided by an external vendor describing products associated to patents.  We can use this information to run further LLM analysis and to begin expanding the system to understand the relationship between patents and products in the market.



## Additional areas not covered

We do not have specific documents to cover the following areas, but new concepts will be introduced:

Focus Areas
We might implement contextual gravity here to help identify patents that have central importance among the group.  Look at the document Contextual_Gravity_Engine_Spec.md for a description of this.

Family Explorer
The contextual gravity calculation might be done on the fly to help us with the challenging problem of limiting results as we consider expansion.  See the doc for details, and lets walk through the design enhancements.

The "Focus Areas" and "Family Explorer" are existing areas of the system.  The focus areas are used as a general place to group patents that have known relationships to each other of any kind - so the user can track them together and we can run collective LLM prompt templates on the group.  The family explorer is meant to explore citation relationships in various ways.  We are not focusing on these two areas in the initial refactor - but we should make a note to come back to it later and once we have improved taxonomy, scoring, and snapshots, we might be better positioned to use more advanced concepts like contextual gravity to find richer relationships in our data.


Aggregate View

Patent Summary

For the latter two - we want to enhance the filtering capability to help with multiple stage setting of filters.  We should have a way to apply filters such that further filters can respect what is already filters - recalculating what is avaialble and number of documents affected.  For example, if we filter by super-sector - and then are looking to filter or group by sectors, we should only see the ones available, and with the correct number of patents.  We do not need to do this on the fly - we can have an Apply button that will take this into consideration.  This should make it easier to implement and prevent sluggish perfomance.  If the user wants to see intermeidate changes to filters (e.g., limit avaialble sectors based on selection of super-sector), apply can be pressed, further filtering executed, then pressed again.  This applied to both Patent Summary and Aggregate View - and anywhere else in system where filtering is present.



Page refactor

LLM Scores and Sectors (which is a scoring page) can be refactored and combined.  We do not really need "LLM Scores" as most all scores may be from LLM (except base score).  But we need to figure out what to name them, we can have "User Scoring" and "Consensus Scoring" - and have the ability to select any score that is appropriate on a given page.  So for "User Scoring", we could have "v2 scoring" - which perhaps we can rename - but then the ability to select any other score, and for taxonomically oriented scoring, that will require selecting filters of the categories we want to score - and have the page adapt to show weights for the relevant questions.


Sector management needs refactor (make it Taxonomy Management) to be more general.  Some of the pages around sector scoring, etc. will not make sense after refactor and will be made to be more general use.  For example, the distinction between score types can melt away a bit in the interface, and we can just select a type of score that we want to manipulate or view rather than have specific pages for portfolio scores vs. sector scores (which really imply scoring with any taxonomical classification as a filter).


Within admin, we will add new features to allow us to narrow the taxonomy, scoring, and other features to be specific and active in the application.  For example, we might allow up to 3 taxonomical associations per patent and setting or resetting that would be a major change - and only would be done at admin level.  Initially, we might make all of these settings read-only as changing them are too expensive - but in some cases having the options displayed in admin (even if read-only), lets us demo the system and explain the way the system is modeled and can change and evolve.

