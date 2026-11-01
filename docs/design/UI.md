# UI and Screens

Style: dark carved wood, dark iron, gold trim, parchment. Our own design. Fonts: **Cinzel** (titles, buttons), **Alegreya Sans** (text, numbers). All text in simple game English.

Screens: Main Menu → Lobby (with loading) → Match (HUD) → End Screen. Plus Settings and Credits.

---

## 1. Main Menu

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                     T E M P L E   W A R S                │
│                                                          │
│                     [  Play  ]                           │
│                     [ Settings ]                         │
│                     [ Credits ]                          │
│                                                          │
│  (live 3D view of the map slowly moving in the back)     │
│                                       v0.1  [⛶ Full screen] │
└──────────────────────────────────────────────────────────┘
```

**Play** opens a small panel:
```
  Your name: [__________]
  [ Create Game ]   [ Join Game ]   Code: [_____]
```

## 2. Lobby (loading runs here)

```
┌────────────────────────────── GAME  ABCD ─────── [Copy Link] ┐
│ Slot  Player         Type    Team  Color   Hero           AI     Ready  Load │
│ 1     Andrii (host)  Human   [1▾]  [Red▾]  [Blood Witch▾] [Normal▾] ✔    100% │
│ 2     Max            Human   [2▾]  [Blue▾] [Random▾]      [Normal▾] ✖     64% │
│ 3     —              [Bot▾]  [2▾]  [Teal▾] [Stone Golem▾] [Hard▾]   ✔      —  │
│ 4     —              [Open▾]                                                │
├──────────────────────────────────┬──────────────────────────┤
│ Chat                             │ Loading                  │
│ Max: hi                          │ Interface    12 / 12  ✔  │
│                                  │ Map          30 / 30  ✔  │
│                                  │ Units        18 / 40     │
│                                  │ Heroes        3 / 8      │
│                                  │ Effects       0 / 24     │
│                                  │ Sounds        0 / 96     │
│                                  │ Shaders      waiting     │
│ [type here...]                   │ ████████░░░░░  64%       │
├──────────────────────────────────┴──────────────────────────┤
│ [Leave]                        [Ready]          [Start Game]│
└──────────────────────────────────────────────────────────────┘
```

- Only the host can change other slots, teams and AI settings. Players change their own color, hero and ready.
- "AI" column = faction AI difficulty. For a Bot slot the Hero column is the bot's hero and the bot uses the same difficulty.
- Hero picker: a grid of 8 portraits with name and role; taken heroes are greyed out.
- Start Game is grey until everyone is ready and at 100%. Hover text says why: "Waiting for Max to load (64%)".
- **Mode** (host, next to the title): "Free for all (4)", "Teams of two (8)" or "Test mode" (like free for all, plus the test panel for everyone in the match). In a team room there are 8 rows, two per kingdom (1 · I, 1 · II, 2 · I, ...). Both players of a kingdom share its team, color, Town Hall, army and start spot, so team and color can not be changed. At the start an open second slot of a playing kingdom gets a bot; a closed one stays empty (that kingdom has one hero). To save height the team room shows a smaller chat and only the load bar.

## 3. Match HUD

Changed 2026-10-31 (user: "smaller, like Dota, not one solid bottom bar"). Layout and sizes are in
`client/src/hud.css`; sizes follow the window height (`vh` clamps), so the HUD takes about the same
share of a laptop and a 4K screen.

```
┌Your Kingdom ⛁25 ⛁40 ⌂6/12 ⚔0 [Tier 1]──[Red][Teal]╭12:34╮[Blue][Purple]──⛁ 640  Ping ◎ ⛶ ⚙ ✕┐
│┌Gathering gold and wood┐                    ╰─────╯                       Kill feed      │
││Orders [Auto][Defend]..│                                                                 │
│└───────────────────────┘                (game view, clickable everywhere)               │
│ FPS line (when on)                                                                       │
│                         [buff][buff][debuff]                                             │
│╭────────╮       ╭──────────────────────────────────────────────────────╮                 │
││MINIMAP │       │ ⚔72-80 ✊60 │[10]Portrait│ Name Lv 10  [Q][W][E][R]  │ [1][2][3]       │
││        │       │ ⛨7    ⚡27 │  (+1)     │ HP █████████████ 1350/1350 │ [4][5][6]       │
││        │       │ ➶2.8  👁44 │  ▓▓▓▓ XP   │ MP ███████░░░░░   453/528  │                 │
└┴────────┴───────┴──────────────────────────────────────────────────────┴─────────────────┘
```

- **Top strip (34 px, opaque):** left: "Your Kingdom" (click: camera to the base), kingdom gold, wood, supply (orange when upkeep starts), army, tier. Middle: the clock on a hanging plaque, allied heroes left of it, enemy heroes right of it (portrait, level, health when seen, grey when dead). Right: own gold, ping, icon buttons (capture mouse, full screen, settings, leave).
- **Kingdom panel** (small, under the strip, left): what the AI does and the order buttons.
- **Minimap:** its own frame in the bottom-left corner.
- **Console** (bottom middle, one piece): stats box (damage, armor, move speed; strength, agility, intelligence, the main one bright), portrait with a level badge, a skill point badge and the XP bar, the name line, skills, then health and mana bars under the skills, then the 2 × 3 inventory. Bars and cooldown sweeps move every frame (the numbers come a few times a second).
- **Buff bar:** above the console, left. Every buff and debuff of the own hero: icon of the ability or item it comes from, green edge = good, red edge = from an enemy, seconds left, a number when it stacks. Hover: name, text, time left.
- **Selected other unit:** a panel above the console: portrait, name, health, armor, damage, ability icons. Heroes also show how far each skill is learned (level pips, grey = not learned; changed 2026-10-31, user: "I want to see that the enemy already learned an aura"), their 6 items and all their buffs with time left. Army units and monsters show one icon per kind of effect (stunned, slowed, shielded...). Works for any owner.
- **Own unit skills:** on an own unit (army or hired) the active skills are buttons (gold edge, cooldown sweep, blue when there is no mana). Click: skills around the unit go off at once; one-target skills ask for a target (left click; right click or Esc cancels). The unit must already be in range ("Too far from your unit.").
- **Hover card:** pointing at a hero or unit in the world (not the own hero, not the selected unit, not buildings) shows a small card next to the mouse: name, level, ally/enemy/neutral and one line per ability (its name and text). Click for the numbers.
- **Shop / Town Hall panel:** the free bottom-right corner (above the console in narrow windows).
- **Floating:** health bars (team color for allies, red for enemies, yellow for neutrals), damage numbers, gold pop-ups on last hits, ground markers for aiming, a green ring where a move order goes and a red one for attack orders.
- **In the world (everyone sees them, also on enemies):** buff markers (stars orbit a stunned head, an eye over a marked unit, thorns for a root, frost ring for a slow, a bubble for a shield, a glow for burning...), a turning rune circle under a hero who learned an aura or carries an aura item (as big as the aura), light motes around a hero with a rare or legendary item (frost sparks for Frost Orb, red wisps for Vampire Fang, a golden halo for crowns...). Code: `client/src/render/status-fx.ts`.
- **Test panel** (test mode only, right side, F7 or "−" folds it): Hero (Level +1, Level max, +1000 / +10k gold, Refresh, Jump), Switches (Can not die, No cooldowns, See the map, speed ×1 ×2 ×4), Enemies (unit kind, count, Place enemies, Place dummy, Remove all; the place is the next left click, Shift keeps placing, right click or Esc cancels), Items (filter box + icon grid, click gives the item). The kill feed moves left of it.
- **Scoreboard (Tab):** per player: hero, level, kills, deaths, gold, camps, faction army supply, Town Hall tier.
- **Alerts** (center top, 3 s): "Your base is under attack!", "Ally base is under attack!", "Level up!", "Not enough gold.", "Not enough mana.", "Out of range.", "Ability is not ready.".

## 4. Town Hall panel

```
┌ Town Hall Upgrades ──────────── your gold: 640 ┐
│ [⚔] Sharper Blades   Lv 1/3   250   ✔          │
│ [🏹] Better Arrows    Lv 0/3   150   ✔          │
│ [🛡] Iron Plates      Lv 1/3   275   Needs Stronghold │
│ [⏩] Training Drills  Lv 0/2   200   ✔          │
│ [🧱] Stone Walls      Lv 0/2   200   ✔          │
│ [💥] Siege Works      Lv 0/2   150   Needs Workshop │
│ [⛏] Rich Veins       Lv 0/2   150   ✔          │
│ [🚩] War Banner       ready    200   ✔          │
│ [💰] Tier Up Fund     ready    200   ✔          │
└──────────────────────────────────────────────────┘
```
(Icons in the game are painted icons from the icon atlas, not emoji.)

## 5. Shop panel

Grid of item icons with price under each. Hover = tooltip. Left or right click = buy. Items you can not afford are dimmed. Drop an item from your inventory onto the panel to sell: "Sell for 125 gold?" (Yes / No). The panel opens when you click a shop building while your hero stands next to it (never by itself); it closes when the hero walks away, or with ✕ / Esc. The Town Hall (upgrades), own production buildings (hiring) and taverns work the same way. The price on a recipe item is what the hero pays now: the parts it carries count ("Your parts pay 550 gold of it."), and the tooltip says what it is made from. Big shops (the Trader's Tent sells 26 items) show as many columns as fit and scroll.

## 6. Tooltips (parchment box)

```
Blood Bolt (Q)           Level 2
Throw a bolt of blood at an enemy. Costs health, not mana.
Damage: 90 / [150] / 210 / 270
Health cost: 55     Cooldown: 8 s     Range: 7
```
Rules: name + hotkey, one line of text, then the numbers. Current level in brackets.

## 7. End Screen

```
            VICTORY            (or DEFEAT)
     Team 1 wins — 31:07
 Player   Hero         Lv  Kills  Deaths  Gold  Camps  Upgrades
 Andrii   Blood Witch  10   12      3     5,240  18      9
 ...
              [Back to Lobby]   [Main Menu]
```

## 8. Settings

- **Graphics:** Quality (Low / Medium / High), Render scale, Shadows (on/off), Effects (Low / High), Show FPS.
- **Sound:** Master, Music, Effects, Voice alerts.
- **Controls:** Quick cast (on/off), Item keys (1–6 or Z X C V B N), Edge scroll (on/off), Camera speed, key rebinding list.
- **Game:** Show damage numbers, Screen shake on big hits (siege blows, big spells, a fallen building, a hero's death, a heavy blow on the own hero), Show health bars (always / when hurt).

## 9. All fixed text strings (first set)

Menus: Play, Settings, Credits, Create Game, Join Game, Your name, Code, Copy Link, Leave, Ready, Not Ready, Start Game, Back, Apply, Full screen, Main Menu, Back to Lobby.
Lobby: Slot, Player, Type, Team, Color, Hero, AI, Load, Human, Bot, Open, Closed, Random, Easy, Normal, Hard, "Waiting for {name} to load ({n}%)", "Waiting for {name} to be ready", "The host left. {name} is the new host.", "Game is full.", "Game not found.", "You were kicked."
Loading: Interface, Map, Units, Heroes, Effects, Sounds, Shaders, Preparing shaders..., Ready, "Download failed. Trying again..."
HUD: Level, XP, Health, Mana, Strength, Agility, Intelligence, Damage, Armor, Gold, Army, Tier, Workers, "Learn ability", "Level up!"
Alerts: "Your base is under attack!", "Ally base is under attack!", "Not enough gold.", "Not enough mana.", "Out of range.", "Ability is not ready.", "Inventory is full.", "Can't do that now.", "You died. Back in {n} s.", "{name} has left the game.", "{name} is back."
AI status: "Building {building}", "Saving for {thing} ({have} / {need} gold)", "Army gathering ({n} / {m} supply)", "Attacking {color}", "Defending the base!", "Taking the expansion", "Retreating", "Clearing a camp", "Tier {n} reached!"
End: Victory, Defeat, "Team {n} wins", Kills, Deaths, Gold, Camps, Upgrades.

## 10. Rules for UI code

- HUD is HTML/CSS over the canvas. Update the DOM only when a value changes (no per-frame DOM writes).
- Health bars, selection circles and damage numbers are drawn in 3D (instanced), not in the DOM.
- All text comes from one strings file (`client/src/ui/strings.ts`) so it is easy to fix or translate later.
- Works from 1280 × 720 up to 4K (UI scale setting).
