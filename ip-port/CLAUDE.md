# IP-Port Project Rules

## Critical: Always Include Claims Context in LLM Scoring

ALL LLM patent scoring MUST include claims context. Never use `includeClaims: 'none'` in any operational code path. The default `DEFAULT_CONTEXT_OPTIONS` is configured correctly (`includeClaims: 'independent_only'`, `maxClaims: 5`, `maxClaimTokens: 800`) — always use it. Patent scoring quality degrades significantly without claims. There is no valid use case for scoring without claims in production.

## Base Score Formula

The project uses v4 time-weighted base scoring (as of April 2026):
- Citation Score: `log10(fwd+1) × 20`
- Time Score: `clamp(yrs/20, 0, 1) × 45`
- Velocity Score: `log10(cpy+1) × 15`
- Youth Bonus: up to 10 pts for patents < 5 yrs old with 15+ yrs remaining
- Sector Multiplier: 0.8x–1.5x
- Expired Multiplier: 0.1x

Formula exists in 3 locations that must stay in sync:
1. `src/api/services/portfolio-enrichment-service.ts` — calculateBaseScore()
2. `src/api/services/patent-hydration-service.ts` — calculateBaseScore()
3. `scripts/recalculate-base-scores.ts` — calculateBaseScore()
