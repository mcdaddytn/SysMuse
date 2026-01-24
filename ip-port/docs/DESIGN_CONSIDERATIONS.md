<Introduction>
Note in this doc we are using XML style section delimiters like <Introduction> and </Introduction>

First order of business, lets read this document and organize it with other documents describing past learning and design issues into a more strucutre development queue.

We are evolving this application from a broadcom specific patent portfolio system using purely file storage (json, etc.) to a database based service, and ultimately to a GUI multi-tiered system.

Our immeidate goals are to formalize the file-cache of any API calls and LLM calls we do in conjunction with a database schema (that will evolve to support GUI) that starts minimally to support our request caching, so we can immediately start filling in the cache (which likely will need to run overnight to fill out portfolio).

<Introduction>



<Overall Design Goals>

We have been running this system using persisted json and now we need to change to use a database, postgres running in docker.  We will have a GUI and a server going forward, but for the next steps we simply want to persist all data that has been stored locally in json and/or other formats in the relational database.  All data we retrieve through api can be saved locally as well as the result of LLM prompts.

We already have laid a groundwork for a schema but we should consider some additional design points:

1) Any ratings/rankings we are using to create a combined score are typeically integer rankings - and we can keep that for now, but we should store as float so we have the flexibility of more precision.  Our overall score is currently a float but is calculated as some type of weighted average with variants of multiplicative terms and additive with weights.  

2) We have the notion of affiliates and competitors currently and should keep that.  We might weigh citations from competitors vs. non competitors vs. affiliates differently.  A company would be promoted to be a competitor based on a theshhold of citations over the entire portfolio, affiliates are clear from the assignee patterns of the subsidiaries of broadcom (our initial porffolio for testing the system - there could be others in the future, so this needs to be designed into the system, but for now it is all broadcom portfolio data for testing).

We will need to rerun our previous rankings but using the database oriented design - we first want to recreate our previous results to ensure functionality of the system (unless we find that previous results were incorrect), we will use those results as a baseline.

Previously we had issues merging in the VMWare patents where they were done at a later time, since we did not have complete assignees mapped.  Once we were considering VMWare patents - we had some issues running stats with them in and out of the dataset.  And once we ran with the VMWare patents in place, with the v3 calculations, they seem to dominate the set.  In recent discovery, we realize that VMWare patents often cite their own patents - and we would like concequently to have a different weight on citations within the affiliate pool. 

So for short term - we sould like to be able to recreate previous results but with data persisted in database.

Then we would like to run alternate scoring algorithms once data is downloaded, so we can experiment with scoring without additional api or LLM calls.

Also need to be able to persist in a json format that can be imported/exported into other database instances, so we can set up multiple instances of this system by exporting/importing a json dump of all data

</Overall Design Goals>




<Third Party Systems>
We want to correlate, display, and store data from 3rd party vendors such as patlytics (see patlytics Batch 1.1 9 Patents.xlsx for sample of data returned)

Our system will be a central hub to evaluate our portfolio including sending some patents to 3rd party tools to retrieve additional information that can be synthesized into our data.  The first example is patlytics with an example spreadsheet included in context.

We will also be interfacting with &AI - another patent analysis platform which should produce claim charts that might be used for an initial litigation package.

</Third Party Systems>



<LLM dependencies>

We might do 2nd order LLM questions on sector specific, workflow with the first, once we know initial LLM answers perhaps this includes establishing sector, lets re-address how this is done.

We currently have two different phases of LLM data - 1) general, across sector, and then 2) sector specific.  We will likely expand this notion into more complex workflows including continuously improving sector assignment, so with that sophistication, we will need more LLM job state management.

</LLM dependencies>



<result caching>

First, we should create a local cache of json definitions of patent data from uspto and any other endpoints we use including for IPR, PTAB, citation data, etc.

Let's create a naming convention using a unique ID like the patent id and any additional file pattern depending on which type of patent data being cached.

The format of the json should be such that we capture all data from the api, so we do not need to access it again once downloaded.

But we should also have the ability to iterate and change our database schema, mapping to this jaon format.  Thus, we can download any information from the uspto and related apis (may also apply to any other apis we access in the future), and we maintain a local cache tied to the data format at the time of the download.


We may iterate our schema design many times to support our GUI including abstracting data attributes into facets rather than fixed fields on database tables.

For the initial implementation, we want simplicity to quickly match our previous release that did calculations only based on the metrics we established for v2 and v3 scoring.  We might have separate database tables to capture these metrics that have a one to one relationship with the main patent table - so that we might replace at a later date and we do not need to change the patent table too often.  We might have several ancillary tables linked via relationships using the MTI pattern of prisma so that we do not load too many fields in the patent table - rather put different fields in related tables that might change independently of the patent table.


In addition, our LLM calls should be cached so that if I am importing the system on another machine, all responses can be re-used without execution.  We are running on development machines largely, and the results we accumulate will be exported to a server to run the actual application.

</result caching>


<Classification of Companies>
Definition of assignees


Definition of competitors - Across the portfolio, when we have passed a threshold of citations from one company, we can elevate the status of that company to a competitor.


Note that for major companies, we maintain a map of assignee names to the company name.  We should evaluate variants as we go, report on new variations, and maintain our mappings of assignee names to company names that might be affiliates or competitors.  We already have in our config assignee variants, competitors, affiliates, etc.  Let's just abstract this a bit further to have the notion of a company with assignee variants that might be an affiliate, a competitor, or a neutral party (below a threshold where they are considered a competitor).


Use the sample spreadsheets provided to show competitors that we expect to find, we just need to recreate the compatitor mappings and the affiliate mappings and pay special attention to new companies that are neither and incrementally evaluate where they belong (affiliate, competitor or neutral).  Consider in the future we might have a more continuous view of affiliates vs. competitors, may have competitors within a sector only, or have a situation specific view on whether a company is an affiliate or competitor (for example if evaulating possible patent pools with different M&A scenarios of companies).

</Classification of Companies>


<Sector Expansion>

We may over time evolve towards multiple sectors per patents with membership based on cpc code, LLM questions, and/or search terms present in title or abstract.  We might use a combination of those factors .  For now, we can assign sectors as before, having a default based on CPC codes so that all patents have a sector - but then more specific sectors may emerge based on search terms or a combination of factors.  We will likely run sector expansion or perhpas a better term would be sector refactor - since we might alter our overall sector assignements as we get more data in.  We can do more advanced search term expansion that can pull more meaningful and unique search terms from abstracts, titls, claims, associated product information, etc. over time.  For now, just document the design vision and we will recreate our previous results before doing rassignments and recalculations.

For now, we might enhance our sector expansion by observing adjacent sectors, and having additional attributes for secondary and tertiary sectors for a given patent.  We could use LLM questions to establish additional sectors based on a ranking by the LLM of how the patent may fit in various sectors.

Likely, we will have loops where we can find sectors based on search term extraction from patent abstract and other text, including defaults mapped from CPC codes.  We could then propose possible sectors for various patents based on the presence of search terms, and then have the LLM rankings measure the suitability of sectors as primary or otherwise (secondary, tertiary and beyond are more like facet style attributes that can aid with association, but not a primary category schema like the initial sector - which we want to have at least one sector and super-sector for all patents).  We might ask the LLM to suggest alternate sectors as we do the expansion as well.

Also to note in prvious efforts, we did sector expansion with individual scripts and code-embedded search terms.  We should be able to refactor all this code and just extract the search terms into metadata (can be stored ultimately in database, or json in the interim - but we do not want the search terms used embedded in code, and we do not want a proliferation of code files to expand each sector - lets refactor this.

</Sector Expansion>


<multiple schema design>

We might maintain multiple schema files:
1) ip-port-facet - facet database for ip-port project
2) ip-port-llm - llm workflow schema
3) ip-port - has patent and file cache information
4) ip-port-cache - to maintain api and llm file cache to obviate need to rerun calls on different dev machines

These schema breakouts seem logical, but lets explore the separation based on relationships, etc.

We have included in context jud-tran-schema.prisma .  This is an example schema file from another project, it has LLM workflow and facet schema elements that can be used as models - in the future these systems may coexist in a larger application.  But also, use basic patterns there (e.g., auto-increment, MTI, relationship patterns, etc.)


I am including in the context a schema from the judicial-transcripts project.  We might use as design inspriration the facet section of the schema and the workflow state for LLM jobs.  We will want to expand our ip-port projects to have both multi-stage LLM calls and facet calculations, where we can create new facets on the fly (without database schema changes), and use them in data results, GUI displays, filters, etc.

</multiple schema design>


<baseline results>

We want to recreate our previous results to make sure our changes have not adversely affected the ability to score patents - but also lets be open to the possiblity that some of our past anslysis was incorrect or incomplete and evaluate current assumptions as we move forward.  We did seem to have trouble merging VMWare data after initially missing those assignees - it was unclear whether we correctly balanced that data vs. previous data.  Also, we may have biased our sector breakout based on the natural order in which we built the system.

The baseline results are meant to just make sure we have basically maintained functionality from previous versions as we expand our capabilities.

See the following context files for results from a recent run:

heatmap-batches-v2-LATEST.json
SECTOR-MAPPING-LATEST.csv
TOPRATED-2026-01-21.csv
TOPRATED-V2-2026-01-21.csv

</baseline results>
