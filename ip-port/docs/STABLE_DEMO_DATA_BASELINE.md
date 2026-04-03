# Stable-Demo Data Baseline

**Captured:** 2026-04-03
**Branch:** `stable-demo`
**Purpose:** Snapshot of database state before adding new affiliates/competitors via discovery UI. Anything created after these watermarks was added during stable-demo data enrichment.

---

## Entity Counts & Watermarks

| Entity | Count | Latest Created (UTC) | Latest ID |
|--------|------:|---------------------|-----------|
| **Company** | 305 | 2026-02-25 21:28:41 | `cmm2jqwkc00s2jh3me4vq5jbr` |
| **CompetitorRelationship** | 564 | 2026-02-25 21:28:45 | `cmm2jqz9z00tjjh3mrid155jy` |
| **Portfolio** | 24 | 2026-02-25 20:08:05 | `cmm2gv8re1h2luxdiwut1366o` |
| **Affiliate** | 281 | 2026-02-25 19:54:35 | `cmm2gdvza03sfuxdimbvmgdeb` |
| **AffiliatePattern** | 1,609 | 2026-02-25 19:54:35 | `cmm2gdvza03sguxdiluk9ygl9` |
| **Patent** | 72,321 | 2026-02-25 20:12:36 | `cmm2h11ve24rnuxdilea6nb1i` |
| **PortfolioPatent** | 72,321 | — | — |
| **PatentCpc** | 599,669 | — | — |
| **PatentCitationAnalysis** | 29,345 | — | — |
| **PatentProsecution** | 9,944 | — | — |
| **PatentScore** | 798,423 | 2026-02-23 02:03:39 | `cmlyj8y5k0kd63g5hic0hlkw5` |
| **PatentCompositeScore** | 35,872 | 2026-02-19 03:29:14 | `cmlswjlnutqtj74ffbp43yjug` |
| **PatentSubSectorScore** | 45,993 | 2026-02-26 03:14:41 | `cmm2w3uvk00klsm9p9ed8xiul` |
| **ScoreSnapshot** | 175 | 2026-02-26 01:41:30 | `cmm2ss0kq00ou35jembcrdyhq` |
| **PatentScoreEntry** | 37,357 | — | — |
| **FocusArea** | 48 | 2026-03-13 01:03:57 | `cmmo71ike0001phkwgozz7pn6` |
| **FocusAreaPatent** | 5,846 | 2026-03-13 01:03:57 | `cmmo71ikz000lphkwz459tfc6` |
| **PromptTemplate** | 64 | 2026-03-13 01:03:57 | `cmmo71ilg000pphkwkg9l4com` |
| **SuperSector** | 8 | 2026-02-06 11:37:58 | `cmlata1fc027qom6m66mcx0m7` |
| **Sector** | 56 | 2026-02-06 11:37:58 | `cmlata1mb02ihom6mjwaykvv9` |
| **SectorRule** | 138 | 2026-02-06 11:37:58 | `cmlata1m902igom6m210as8yh` |
| **SubSector** | 31,025 | 2026-02-06 11:40:18 | `cmlatd1w10qceom6mtnn701i0` |
| **CpcCode** | 137,598 | 2026-02-06 00:53:52 | `cmla69qg22y65biiutd6zg2ut` |
| **ScoringTemplate** | 9 | 2026-02-06 13:06:16 | `cmlawflk900081tghw1o55d4p` |
| **BatchJob** | 406 | 2026-02-26 03:10:53 | `cmm2vyykz007psm9pp3zc5bes` |
| **PatentFamilyExploration** | 18 | 2026-02-23 20:54:51 | `cmlznno9000tw3m6o8wuy22j7` |
| **PatentFamilyMember** | 2,033 | 2026-02-23 20:57:17 | `cmlznqtbm011i3m6ohv3nsvir` |
| **PatentFamilyExpansionStep** | 16 | 2026-02-23 20:57:17 | `cmlznqtbv011u3m6o5bstcotk` |
| **ApiRequestCache** | 58,247 | 2026-02-26 00:12:03 | `58448` |
| **LlmWorkflow** | 1 | 2026-01-28 17:37:12 | `cmkyb5d2g0000bwiydightdmx` |
| **EntityAnalysisResult** | 5 | 2026-01-28 17:39:56 | `cmkyb8vh7000nbwiyg1ol49eb` |
| **User** | 2 | 2026-01-25 17:16:59 | `default-user` |

### Empty Entities (zero records)
FocusGroup, SearchTerm, FacetDefinition, FacetValue, LlmJob, LlmJobDependency, LlmResponseCache, ProsecutionTimeline

---

## Key Broadcom Baseline

| Metric | Value |
|--------|-------|
| Affiliates | 14 |
| Competitors | 127 |
| Portfolios | (check via GUI) |

---

## How to Identify New Data

Any record created **after 2026-02-26T12:00:00Z** in these entities was added during stable-demo enrichment:
- `Company` — new competitor companies created during accept
- `CompetitorRelationship` — new competitor links
- `Affiliate` — new affiliates accepted from discovery
- `AffiliatePattern` — patterns for new affiliates
- `Patent` / `PortfolioPatent` — newly imported patents
- `PatentSubSectorScore` / `PatentScore` — scores for new patents

For CUID-based IDs, you can also compare alphabetically against the watermark IDs above (CUIDs are roughly time-sortable).
