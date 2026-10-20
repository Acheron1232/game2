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

## 3. Match HUD

```
┌─[⏱ 12:34]──[Team: ■Red Lv7  ■Teal Lv6]──────────────[💰 640]─[Menu]┐
│ Kill feed (top right): "Andrii killed Max's Stone Golem"              │
│                                                                       │
│                         (game view)                                   │
│                                                                       │
│ ┌ Your Kingdom ───────────┐                                           │
│ │ Attacking Blue          │ ← AI status panel (top left, small)       │
│ │ Army 26 / Tier 2 / 18 wk│                                           │
│ └─────────────────────────┘                                           │
├──────────┬──────────────────────────────────────────┬────────────────┤
│          │ [Portrait]  Blood Witch   Lv 7  ▓▓▓▓▓░ XP │ [it][it][it]   │
│ MINIMAP  │  HP ███████████░░░ 620 / 810             │ [it][it][it]   │
│          │  MP ██████░░░░░░░░ 300 / 588             │                │
│          │  Str 28  Agi 21  Int 40   Dmg 47-53  Arm 4│                │
│          │  [Q][W][E][R]   (cooldown sweeps, + to learn)│ 1 2 3 / 4 5 6 │
└──────────┴──────────────────────────────────────────┴────────────────┘
```

- **Top bar:** game time, ally heroes (portrait, level, health), your gold, Menu button.
- **AI status panel:** status line, army supply, Town Hall tier, worker count. Click it to move the camera to your base.
- **Bottom bar:** minimap (left), hero panel (middle), inventory 2 × 3 (right).
- **Selected other unit:** the middle panel shows its portrait, name, health, armor, damage (no buttons).
- **Shop / Town Hall panel:** opens above the inventory when the hero is near and the building is selected.
- **Floating:** health bars (team color for allies, red for enemies, yellow for neutrals), damage numbers, gold pop-ups on last hits, ground markers for aiming.
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

Grid of item icons with price under each. Hover = tooltip. Left or right click = buy. Items you can not afford are dimmed. Drop an item from your inventory onto the panel to sell: "Sell for 125 gold?" (Yes / No). The panel opens by itself when your hero walks next to a shop, or when you click a shop building; ✕ or Esc closes it.

## 6. Tooltips (parchment box)

```
Blood Bolt (Q)           Level 2
Throw a bolt of blood at an enemy. Costs health, not mana.
Damage: 90 / [150] / 210
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
- **Game:** Show damage numbers, Show health bars (always / when hurt).

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
