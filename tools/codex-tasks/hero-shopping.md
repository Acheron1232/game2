# Task: hero bots buy items and Town Hall upgrades

Change `shared/src/sim/hero-bot.ts` and write `shared/test/hero-bot-shop.test.ts`. Do not edit other files.

## Background
Bot heroes (`HeroBot` in `shared/src/sim/hero-bot.ts`) farm, retreat, fight and learn, but never spend gold. Rules in `shared/data/ai.json` → `heroBot`:
- `shopping`: "Buy healing potions when below 2. Then follow the hero's item list (heroBuild below) at the nearest shop when gold allows."
- `heroBuild.<heroId>`: the item ids to buy, in order.
- `upgrades`: "Spend 30% of gold above 300 on Town Hall upgrades, in this order: iron_plates, sharper_blades, better_arrows, rich_veins, stone_walls."

Items (Phase 7c): read `shared/src/sim/items.ts` (`ITEMS`, `itemIndex`, `canStore`, `shopInRange` or similar, `INVENTORY_SIZE`, item commands `CommandType.BuyItem { item }`, `UseItem { slot, target, id, x, y }`), `shared/data/shops.json` (what each shop sells), `gameData.map.shops` (shop positions). Healing potion id: look it up in `shared/data/items.json`.
Town Hall upgrades (Phase 8c): `shared/src/sim/faction/hall-shop.ts` (`UPGRADE_IDS`, `upgradeProblem(sim, hero, index)`, `hallInRange`), `upgrades.ts` (`upgradeStatus`), command `CommandType.BuyUpgrade { upgrade: index }`. The faction: `sim.factions.get(slot)`.

**The bot only acts through `sim.queueCommand(slot, seq, cmd)`**, like a player. Use the bot's own `send()` (it keeps the sequence numbers). Never change gold, items or entities directly.

## Behaviour
1. Potions: when the hero has fewer than 2 healing potions and enough gold, and a shop that sells them is within 25 units (or the hero is already going home / to a fountain and passes one), walk to the shop and buy until 2. Drink a potion (`UseItem`) when health < 45% in a fight, or while retreating, if the potion cooldown is ready.
2. Item list: when not in a fight and not retreating, and gold ≥ the next item's cost + 100, go to the nearest shop that sells the next item of `heroBuild[heroId]` and buy it. Skip items the bag can not hold. A bot is "shopping" while it walks there (state text "Shopping").
3. Town Hall upgrades: when the hero is within 30 units of one of its own finished Town Halls (or passes by when going home), and gold > 300, buy the next upgrade in the `upgrades` order that `upgradeProblem` allows, while the spend stays within 30% of (gold − 300). Walk into range (6 from the building edge) first. State text "Buying upgrades".
4. Never shop while the base is under attack or while the hero is in a fight (enemy within 10 that it attacks, or that attacks it).
5. Difficulty: Easy shops potions only; Normal and Hard do everything.
6. Keep the throttle the bot already uses (at most a few commands per think) and keep thinking only every `reactionSec`.

## Tests (`shared/test/hero-bot-shop.test.ts`)
Use the same setup as `shared/test/hero-bot.test.ts` (map nav, `MatchSim` with one bot slot) and, for upgrades, a world with factions (`{ terrain, trees }`, see `shared/test/hall-shop.test.ts`). Check:
- a bot with 400 gold next to a Trader's Tent buys healing potions up to 2;
- a bot with 1000 gold and no fight walks to a shop and buys the first item of its `heroBuild`;
- a hurt bot (35% health) with a potion near an enemy drinks it;
- a bot with 1500 gold near its own Town Hall buys `rich_veins` when the others are not allowed yet (no Forge), and spends at most 30% of gold above 300;
- an Easy bot does not buy list items.
- the existing `shared/test/hero-bot.test.ts` still passes.
