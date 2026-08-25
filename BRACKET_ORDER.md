This is a loser-routing problem, not a game-number or queue-order problem. The Winners Round 2 losers currently drop into the same redemption branch as teams they could have just beaten.

For the 16-team template, the problematic routing is here: [bracketTemplates.ts](/workspaces/colosseum/src/server/services/bracketTemplates.ts:510) and [bracketTemplates.ts](/workspaces/colosseum/src/server/services/bracketTemplates.ts:550).

The fix is to cross the Winners R2 drops into the opposite half of Redemption R2:

| Redemption game | Existing matchup | Recommended matchup |
|---|---|---|
| 17 | Winner 13 vs Loser 9 | Winner 13 vs Loser 11 |
| 18 | Winner 14 vs Loser 10 | Winner 14 vs Loser 12 |
| 19 | Winner 15 vs Loser 11 | Winner 15 vs Loser 9 |
| 20 | Winner 16 vs Loser 12 | Winner 16 vs Loser 10 |

Equivalently, change the loser destinations:

- Game 9 → Game 19
- Game 10 → Game 20
- Game 11 → Game 17
- Game 12 → Game 18

In the example, Team B would remain on the Game 13 → 17 path, while Team A would drop from Game 9 into Game 19. Their paths cannot converge again until Game 27, after several redemption rounds, instead of immediately at Game 17.

This is the usual “cross-bracketing” approach: preserve the order within each half, but rotate the second-round drops into the opposite half. Tournament analysis specifically identifies `3,4,1,2` as the correct 16-team drop order rather than `1,2,3,4`, primarily to prevent early repeat pairings. [Getting the Drops Right](https://tourneygeek.com/2017/01/25/getting-the-drops-right/) Other bracket generators similarly route second-round losers away from their original branch to prevent early rematches. [Example TypeScript implementation](https://github.com/nadersafa1/double-elimination/blob/main/src/wireLoserRouting.ts)

The same defect exists in the 8-, 32-, and 64-team templates. The general formula for `m` Winners R2 games is:

```ts
const redemptionPosition = (winnersPosition + m / 2) % m;
```

That produces:

- Size 8: `5→10, 6→9`
- Size 16: `9→19, 10→20, 11→17, 12→18`
- Size 32: rotate Games 17–24 by four Redemption R2 positions
- Size 64: rotate Games 33–48 by eight positions

Both representations must be updated: `loser_advances_to` and the corresponding redemption game’s `team2_source`. Otherwise bye resolution and live advancement can disagree.

One deployment caveat: generated templates are persisted, and the seeder currently uses `ON CONFLICT ... DO NOTHING` at [bracketTemplates.ts](/workspaces/colosseum/src/server/services/bracketTemplates.ts:51). Therefore, changing the generator alone will not repair templates already stored in an existing database. The implementation needs a scoped template migration or versioned upsert. Existing in-progress brackets should remain untouched; unstarted brackets can be regenerated.

I’d also add a regression test for the exact 10-team scenario, since the current tests validate references but not rematch topology at [bracketTemplatesSeed.test.ts](/workspaces/colosseum/tests/sql/bracketTemplatesSeed.test.ts:122). No code was changed during this diagnosis.