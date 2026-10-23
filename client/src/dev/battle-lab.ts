// Local battle field: the real simulation, binary snapshots and match renderer, no socket server.
import {
  ABILITIES,
  BinaryReader,
  BinaryWriter,
  blankBuilding,
  buildMatchNav,
  ClientView,
  entityTypeIndex,
  EventType,
  gameData,
  MatchSim,
  MsgId,
  parseTerrain,
  readCommand,
  SnapshotWriter,
  TeamVision,
  xpForLevel,
  refreshPassives,
  type SimEntity,
} from '@game/shared';
import terrainUrl from '@game/shared/data/map-terrain.bin?url';
import treesUrl from '@game/shared/data/map-trees.json?url';
import decorUrl from '@game/shared/data/map-decor.json?url';
import { MatchClient } from '../game/match-client';
import { loadGameAssets } from '../loader/assets';
import { Loader } from '../loader/loader';
import { createEngine } from '../render/engine';
import { GameWorld, type TreeList } from '../render/world';
import type { DecorItem } from '../render/decor';

document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#142019;color:#efe8d8;font:13px system-ui;overflow:hidden}canvas{width:100%;height:100%;display:block;outline:none}header{position:fixed;top:12px;left:16px;right:16px;background:#15231eef;border:1px solid #c3ad6a55;padding:12px 16px;border-radius:5px}.title{display:flex;align-items:center;gap:16px}.title strong{letter-spacing:.18em;color:#e1cb93}.title span{color:#adbdad;flex:1}a{color:#dbc58e;font-size:12px}nav{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}button,select{font:inherit;border:1px solid #677a67;border-radius:3px;background:#2c4032;color:#f1eadc;padding:7px 10px;cursor:pointer}button:hover,button.armed{background:#806137;border-color:#ddc282}select{min-width:190px}aside{position:fixed;bottom:90px;left:16px;display:flex;gap:6px;max-width:calc(100% - 32px)}aside button{text-align:left;min-width:0;flex:1;max-width:180px;background:#17281feb;padding:9px}aside b{display:block;color:#f4d692;margin-bottom:3px}aside small{color:#adb9aa;font-size:11px}footer{position:fixed;left:16px;right:16px;bottom:12px;padding:10px 14px;background:#14221ded;border:1px solid #b7a27144;border-radius:4px;line-height:1.6}output{display:block;font:11px ui-monospace;color:#aebdab}.label{position:fixed;transform:translate(-50%,0);padding:3px 7px;background:#14221ddd;color:#edd59e;border:1px solid #c4ab6855;font-size:11px;pointer-events:none;white-space:nowrap}@media(max-width:760px){header{left:8px;right:8px;padding:9px}.title span{display:none}.title{gap:10px}.title strong{flex:1}nav{gap:5px}button,select{padding:6px;font-size:11px}aside{bottom:105px;left:8px;gap:4px}aside button{min-width:0;width:calc((100vw - 28px)/4);padding:7px 5px;font-size:10px}aside small{font-size:9px}.label{font-size:10px}footer{left:8px;right:8px;font-size:11px}}
</style>`,
);
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
const stats = document.querySelector<HTMLOutputElement>('#stats')!;
const select = document.querySelector<HTMLSelectElement>('#hero')!;
const skills = document.querySelector<HTMLElement>('#skills')!;
const labelHost = document.querySelector<HTMLElement>('#labels')!;
const ids = ['thorn_marshal', 'grave_bellkeeper', 'tidebreaker', 'lantern_monk', 'obsidian_heart'];
const reviewBatch = new URLSearchParams(location.search).get('batch');
const expansionUnits = [
  'chainbreaker',
  'rune_gunner',
  'null_warden',
  'reliquary_guard',
  'banner_captain',
  'lantern_novice',
  'veil_sister',
  'bulwark_golem',
  'siege_golem',
];
const reinforcementUnits = [
  'boar_lancer',
  'ram_drummer',
  'covered_ram',
  'bolt_cart',
  'badger_mercenary',
  'fox_trailshot',
  'coalback_porter',
  'kite_bomber',
];
const expansionDefenses = [
  'bulwark_hall',
  'timber_wall',
  'stone_wall',
  'reinforced_wall',
  'repair_post',
  'rally_bastion',
  'chain_spire',
  'frost_obelisk',
  'bell_ward',
  'pitch_basin',
  'wind_totem',
  'shield_pylon',
];
for (const h of gameData.heroes) select.add(new Option(h.name, h.id));
select.value = new URLSearchParams(location.search).get('hero') || ids[0]!;
const loader = new Loader();
loader.onProgress((p) => (hint.textContent = `Loading game assets · ${Math.round(p.fraction * 100)}%`));
const { engine, kind } = await createEngine(canvas);
engine.maxFPS = 60;
engine.setHardwareScalingLevel(1);
const { assets, extra } = await loadGameAssets(loader, [
  { group: 'Map', url: terrainUrl },
  { group: 'Map', url: treesUrl },
  { group: 'Map', url: decorUrl },
]);
const terrain = parseTerrain(await (await fetch(extra[0]!)).arrayBuffer());
const trees = ((await (await fetch(extra[1]!)).json()) as { trees: TreeList }).trees;
const decor = (await (await fetch(extra[2]!)).json()) as { types: string[]; decor: DecorItem[] };
const world = await GameWorld.create(engine, canvas, terrain, trees, decor, assets);
world.setMenuMode(false);
world.setMenuBase(false);
world.camera.edgeScroll = false;
world.buildingFacing = () => Math.PI;
engine.runRenderLoop(() => world.scene.render());
await world.library.warmUp(['blue', 'red']);
await world.scene.whenReadyAsync();
let sim: MatchSim;
let client: MatchClient | null = null;
let view: ClientView;
let receive: ((data: ArrayBuffer) => void) | null = null;
let foundry: SimEntity;
let armed = -1;
let labels: { id: number; element: HTMLDivElement; x?: number; y?: number }[] = [];
const reviewProps: ReturnType<typeof world.addUnit>[] = [];
let buttons: HTMLButtonElement[] = [];
let autoCasts = 0;
let lastSkill = '';
const center = { x: 128, y: 105 };
const vision = new TeamVision(256),
  sw = new SnapshotWriter(),
  writer = new BinaryWriter(16384);
const transport = {
  onSnapshot(fn: (data: ArrayBuffer) => void) {
    receive = fn;
    return () => {
      receive = null;
    };
  },
  sendBinary(data: Uint8Array<ArrayBuffer>) {
    const r = new BinaryReader(data);
    if (r.u8() !== MsgId.Command) return;
    const c = readCommand(r);
    if (c) sim.queueCommand(0, c.seq, c.cmd);
  },
};
function label(e: SimEntity, text: string): void {
  const el = document.createElement('div');
  el.className = 'label';
  el.textContent = text;
  labelHost.append(el);
  labels.push({ id: e.id, element: el });
}
function spawn(id: string, x: number, y: number, team = 1): SimEntity {
  const e = sim.spawn(entityTypeIndex(id), team === 1 ? 0 : 1, team, team === 1 ? 1 : 0, x, y, Math.PI);
  e.inert = true;
  return e;
}
function readyBuilding(id: string, x: number, y: number, team = 1): SimEntity {
  const e = spawn(id, x, y, team);
  const d = gameData.buildings.buildings.find((b) => b.id === id)!;
  e.building = blankBuilding(d, ...d.footprint);
  e.building.done = true;
  e.building.progress = 1;
  sim.factions!.get(team === 1 ? 0 : 1)!.buildings.add(e.id);
  sim.factions!.blockers.addRect(x, y, ...d.footprint);
  return e;
}
function refill(): void {
  const h = sim.heroes[0]!;
  h.hp = h.stats.maxHp;
  h.mana = h.stats.maxMana;
  h.cooldowns.fill(0);
}
function addEarthTargets(): void {
  for (let i = 0; i < 4; i++) {
    const e = spawn(i === 3 ? 'stone_golem' : 'swordsman', center.x - 3 + i * 2, center.y - 7, 2);
    e.hp = e.stats.maxHp = e.base.maxHp = 5000;
    label(e, i === 3 ? 'Enemy hero · roll stun' : 'Enemy · combo target');
  }
  const ally = spawn('swordsman', center.x - 2, center.y - 2);
  label(ally, 'Ally · F to enchant');
  world.camera.baseRadius = 27;
  world.camera.lookAt(center.x, center.y - 3);
  hint.textContent =
    'D: place stone · Q: kick · W: roll through stone · E: pull stone / ally · R: Magnetize · F: enchant unit · F6: refill';
}
function addTargets(): void {
  for (let i = 0; i < 5; i++) {
    const e = spawn(i % 2 ? 'swordsman' : 'ogre_brute', center.x - 4 + i * 2, center.y - 7, 2);
    e.hp = e.stats.maxHp = e.base.maxHp = 5000;
    label(e, i % 2 ? 'Swordsman target' : 'Ogre target');
  }
  hint.textContent = 'Targets added. Right-click to attack. Q / W / E / R to aim; left-click to cast.';
}
function addArmy(): void {
  for (let i = 0; i < 12; i++)
    spawn(
      ['swordsman', 'archer', 'pike_warden', 'frost_adept', 'foundry_golem'][i % 5]!,
      center.x - 6 + (i % 6) * 2,
      center.y + 9 + Math.floor(i / 6) * 2,
    );
}
function addExpansion(): void {
  expansionUnits.forEach((id, i) => {
    const e = spawn(id, center.x - 6 + (i % 5) * 3, center.y - 7 + Math.floor(i / 5) * 4);
    label(e, gameData.units.find((u) => u.id === id)!.name);
  });
  world.camera.baseRadius = 36;
  hint.textContent = 'Batch 1: nine painted units. Start skirmish enables their real attacks and automatic skills.';
}
function addLanternDemo(): void {
  const novice = spawn('lantern_novice', center.x - 3, center.y - 8);
  novice.inert = false;
  label(novice, 'Lantern Novice · auto deploy');
  for (let i = 0; i < 3; i++) {
    const ally = spawn('swordsman', center.x - 5 + i * 2, center.y - 10);
    ally.hp = Math.max(1, ally.stats.maxHp * 0.25);
    label(ally, 'Injured ally · healing aura');
  }
  world.camera.baseRadius = 30;
  world.camera.lookAt(center.x, center.y - 5);
  hint.textContent = 'The novice places a killable healing lantern near wounded allies. It heals for 24 seconds; one lantern per novice.';
}
function addDefenses(): void {
  expansionDefenses.forEach((id, i) => {
    const e = readyBuilding(id, center.x - 13 + (i % 6) * 5, center.y - 14 - Math.floor(i / 6) * 5);
    label(e, gameData.buildings.buildings.find((b) => b.id === id)!.name);
  });
  world.camera.baseRadius = 54;
  world.camera.lookAt(center.x, center.y - 12);
  hint.textContent = 'Defense yard: timber → stone → reinforced walls, support and six automatic defenses.';
}
function addReinforcements(): void {
  reinforcementUnits.forEach((id, i) => {
    const e = spawn(id, center.x - 6 + (i % 4) * 4, center.y - 7 + Math.floor(i / 4) * 4);
    if (id === 'kite_bomber') sim.teleport(e, center.x + 10, center.y - 12);
    label(e, gameData.units.find((u) => u.id === id)!.name);
  });
  const lodge = readyBuilding('tusk_lodge', center.x, center.y - 15);
  label(lodge, 'B14 · Tusk Lodge');
  for (const [id, x] of [
    ['wayfarer_inn', center.x - 6],
    ['cinder_inn', center.x + 6],
  ] as const) {
    reviewProps.push(world.addUnit(id, 'blue', x, center.y - 15, Math.PI, 0, false, false, true));
    sim.factions!.blockers.addRect(x, center.y - 15, 3.6, 3.2);
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = id === 'wayfarer_inn' ? 'B23 · Wayfarer Inn' : 'B24 · Cinder Inn';
    labelHost.append(el);
    labels.push({ id: 0, x, y: center.y - 15, element: el });
  }
  world.camera.baseRadius = 40;
  world.camera.lookAt(center.x, center.y - 6);
  hint.textContent =
    'Batch 2: cavalry, siege, mercenaries and bomber. The two inns also replace the map taverns and expand their real hiring rosters.';
}
function startSkirmish(): void {
  const both = [...expansionUnits, ...reinforcementUnits];
  if (!sim.entities.some((e) => both.includes(gameData.units[e.type - gameData.heroes.length]?.id ?? ''))) addExpansion();
  const defenders = sim.entities.filter((e) => e.alive && !e.hero && !e.building && e.team === 1);
  const batch2 = sim.entities.some((e) => e.building?.def?.id === 'tusk_lodge');
  const defenseY = sim.entities.some((e) => e.building?.def?.id === 'chain_spire') ? 15 : batch2 ? 12 : 8;
  if (batch2) {
    label(readyBuilding('watchtower', center.x - 3, center.y - 11, 2), 'Enemy tower');
    label(readyBuilding('stone_wall', center.x + 3, center.y - 11, 2), 'Enemy wall');
    const porter = defenders.find((e) => gameData.units[e.type - gameData.heroes.length]?.id === 'coalback_porter');
    const cart = defenders.find((e) => gameData.units[e.type - gameData.heroes.length]?.id === 'bolt_cart');
    if (porter && cart) {
      sim.teleport(porter, cart.mover.x + 2, cart.mover.y + 1);
      cart.hp *= 0.6;
    }
  }
  for (let i = 0; i < 16; i++) {
    const enemy = spawn(
      ['swordsman', 'archer', 'hawk_rider', 'ogre_brute'][i % 4]!,
      center.x - 9 + (i % 6) * 3,
      center.y - defenseY - Math.floor(i / 6) * 2,
      2,
    );
    enemy.inert = false;
    enemy.targetId = defenders[i % defenders.length]?.id ?? sim.heroes[0]!.id;
  }
  for (const e of defenders) {
    e.inert = false;
    if (e.stats.maxMana) e.mana = e.stats.maxMana;
    if (gameData.units[e.type - gameData.heroes.length]?.id === 'lantern_novice') e.hp *= 0.7;
  }
  hint.textContent = 'Live skirmish. Units choose targets and activate skills automatically; defenses pulse when enemies enter range.';
}
function reset(): void {
  for (const prop of reviewProps) world.removeUnit(prop);
  reviewProps.length = 0;
  autoCasts = 0;
  lastSkill = '';
  client?.dispose();
  labelHost.replaceChildren();
  labels = [];
  skills.replaceChildren();
  buttons = [];
  armed = -1;
  const hid = select.value;
  history.replaceState(null, '', `?hero=${hid}${reviewBatch ? '&batch=' + reviewBatch : ''}`);
  sim = new MatchSim(
    {
      seed: 77,
      noCamps: true,
      slots: [
        { index: 0, heroType: entityTypeIndex(hid), team: 1, color: 1, start: 0 },
        { index: 1, heroType: entityTypeIndex('stone_golem'), team: 2, color: 0, start: 1 },
      ],
    },
    buildMatchNav(terrain, gameData.map),
    { terrain, trees },
  );
  const hero = sim.heroes[0]!;
  sim.teleport(hero, center.x, center.y - 1);
  sim.addXp(hero, xpForLevel(10));
  hero.heroState!.home = [center.x, center.y - 1];
  hero.heroState!.abilityLevels = hero.heroState!.def.abilities.map((id, slot) =>
    ABILITIES.find((a) => a.id === id)!.params['innate'] ? 1 : slot === 3 ? 1 : 3,
  );
  hero.heroState!.skillPoints = 0;
  refreshPassives(sim, hero);
  sim.refreshStats(hero);
  refill();
  const foe = sim.heroes[1]!;
  sim.teleport(foe, 215, 215);
  foe.inert = true;
  const f = sim.factions!.get(0)!;
  f.tier = 2;
  f.gold = 5000;
  f.wood = 5000;
  f.supplyCap = 100;
  readyBuilding('forge', center.x + 10, center.y + 5);
  foundry = readyBuilding('golem_foundry', center.x + 8, center.y);
  foundry.building!.rallyX = center.x + 5;
  foundry.building!.rallyY = center.y - 2;
  label(foundry, 'B07 · Golem Foundry');
  const narrow = canvas.clientWidth / canvas.clientHeight < 1.2;
  ids
    .filter((id) => id !== hid)
    .forEach((id, i) => {
      const e = spawn(id, center.x - 6 + i * 3.2, center.y + 5);
      e.hero = true;
      label(
        e,
        (
          {
            thorn_marshal: 'H07 · Marshal',
            grave_bellkeeper: 'H08 · Bellkeeper',
            tidebreaker: 'H10 · Tidebreaker',
            lantern_monk: 'H11 · Monk',
            obsidian_heart: 'H12 · Heart',
          } as Record<string, string>
        )[id]!,
      );
    });
  ['staff_warrior', 'stone_golem', 'pike_warden', 'frost_adept', 'swordsman', 'cleric'].forEach((id, i) =>
    spawn(id, center.x - 7 + i * 2.5, center.y + 10),
  );
  hero.heroState!.def.abilities.forEach((id, slot) => {
    const a = ABILITIES.find((a) => a.id === id)!;
    const b = document.createElement('button');
    b.innerHTML = `<b>${'QWERDF'[slot]} · ${a.name}</b><small>${a.kind === 'active' ? (a.target === 'none' ? 'Cast now' : 'Choose target') : a.kind}</small>`;
    b.title = a.text;
    b.onclick = () => arm(slot);
    skills.append(b);
    buttons.push(b);
  });
  client = new MatchClient(world, transport, {
    matchId: 'battle-lab',
    yourSlot: 0,
    rejoin: false,
    slots: [
      { index: 0, kind: 'human', name: 'Tester', team: 1, color: 1, hero: hid, start: 0 },
      { index: 1, kind: 'bot', name: 'Targets', team: 2, color: 0, hero: 'stone_golem', start: 1 },
    ],
  });
  view = new ClientView(0, 1, true);
  sendSnapshot();
  world.fog.setEnabled(false);
  world.camera.baseRadius = narrow ? 37 : 30;
  world.camera.lookAt(center.x + 1, center.y + 1);
  hint.textContent = 'Right-click: move / attack · Q W E R: cast · Esc: cancel · F6: refill · Wheel: zoom';
  if (reviewBatch === '2') addReinforcements();
  else if (reviewBatch === '1') addExpansion();
  else if (reviewBatch === '3') addLanternDemo();
  else if (reviewBatch === 'earth') addEarthTargets();
}
function sendSnapshot(): void {
  vision.update(sim.entities);
  const data = view.write(sim, vision, sw, writer).slice();
  receive?.(data.buffer);
}
function arm(slot: number): void {
  const a = ABILITIES.find((a) => a.id === sim.heroes[0]!.heroState!.def.abilities[slot])!;
  if (!a) return;
  if (a.kind !== 'active') {
    hint.textContent = a.text;
    return;
  }
  if (a.target === 'none') {
    client!.cast(slot, { kind: 0, id: 0, x: 0, y: 0 });
    armed = -1;
  } else {
    armed = slot;
    hint.textContent = `${a.name}: ${a.text} Left-click a ${a.target === 'unit' ? 'unit' : 'point'}.`;
  }
  buttons.forEach((b, i) => b.classList.toggle('armed', i === armed));
}
canvas.oncontextmenu = (e) => e.preventDefault();
canvas.onpointerdown = (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  canvas.focus();
  const hit = client?.pick(e.offsetX, e.offsetY),
    p = world.pickGround(e.offsetX, e.offsetY);
  if (e.button === 2) {
    armed = -1;
    if (hit && client!.isEnemy(hit)) client!.attack(hit);
    else if (p) client!.moveTo(p.x, p.y, false);
    return;
  }
  if (armed >= 0) {
    const a = ABILITIES.find((a) => a.id === sim.heroes[0]!.heroState!.def.abilities[armed])!;
    if (a.target === 'unit' && hit) client!.cast(armed, { kind: 1, id: hit.id, x: 0, y: 0 });
    else if (a.target !== 'unit' && p) client!.cast(armed, { kind: 2, id: 0, x: p.x, y: p.y });
    else return;
    armed = -1;
    buttons.forEach((b) => b.classList.remove('armed'));
  }
};
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement) return;
  const slot = 'qwerdf'.indexOf(e.key.toLowerCase());
  if (slot >= 0) {
    e.preventDefault();
    arm(slot);
  }
  if (e.key === 'Escape') {
    armed = -1;
    client?.stop();
    buttons.forEach((b) => b.classList.remove('armed'));
  }
  if (e.key === 'F6') {
    e.preventDefault();
    refill();
  }
});
select.onchange = reset;
document.querySelector<HTMLButtonElement>('#reset')!.onclick = reset;
document.querySelector<HTMLButtonElement>('#refill')!.onclick = () => refill();
document.querySelector<HTMLButtonElement>('#targets')!.onclick = addTargets;
document.querySelector<HTMLButtonElement>('#army')!.onclick = addArmy;
document.querySelector<HTMLButtonElement>('#expansion')!.onclick = addExpansion;
document.querySelector<HTMLButtonElement>('#reinforcements')!.onclick = addReinforcements;
document.querySelector<HTMLButtonElement>('#lantern')!.onclick = addLanternDemo;
document.querySelector<HTMLButtonElement>('#defenses')!.onclick = addDefenses;
document.querySelector<HTMLButtonElement>('#walls')!.onclick = () => {
  let count = 0;
  for (const e of sim.entities)
    if (e.team === 1 && e.building?.def?.id.endsWith('_wall') && sim.factions!.upgradeTier(sim.factions!.get(0)!, e)) count++;
  hint.textContent = count
    ? `${count} wall upgrades queued. Resources and upgrade timers use the normal game rules.`
    : 'Add the defense yard first, or wait for the current upgrade to finish.';
};
document.querySelector<HTMLButtonElement>('#fight')!.onclick = startSkirmish;
document.querySelector<HTMLButtonElement>('#train')!.onclick = () => {
  const ok = sim.factions!.train(sim.factions!.get(0)!, foundry, 'foundry_golem');
  hint.textContent = ok ? 'Golem queued. The real training timer is 38 seconds.' : 'Could not queue: check resources, supply or queue.';
};
document.querySelector<HTMLButtonElement>('#crowd')!.onclick = () => (location.href = '/dev/unit-study.html?mode=expansion');
reset();
setInterval(() => {
  sim.step();
  for (let i = 0; i < sim.events.count; i++) {
    const event = sim.events.items[i]!;
    if (event.type === EventType.Cast && event.kind === 255) {
      autoCasts++;
      const e = sim.get(event.a);
      const skill = e?.building?.def?.skills?.[event.b] ?? (e && gameData.units[e.type - gameData.heroes.length]?.skills[event.b]);
      lastSkill = gameData.skills.find((s) => s.id === skill?.id)?.name ?? '';
    }
    if (event.type === EventType.Trained) {
      const unit = sim.get(event.a);
      if (unit) label(unit, 'Foundry Golem');
      hint.textContent = 'Golem trained. It now uses the normal army combat and animation rules.';
    }
  }
  sendSnapshot();
}, 50);
const point = { x: 0, y: 0 };
world.scene.onAfterRenderObservable.add(() => {
  for (const l of labels) {
    const e = sim.get(l.id);
    if (!e && l.x === undefined) continue;
    const up = e ? (client?.entities.get(e.id)?.unit?.flyHeight ?? 0) : 0;
    world.screenPoint(e?.mover.x ?? l.x!, (e?.mover.y ?? l.y!) - 0.8, up, point);
    l.element.style.left = point.x + 'px';
    l.element.style.top = point.y + 'px';
    l.element.hidden = e ? !e.alive : false;
  }
  const h = sim.heroes[0]!;
  const b = foundry.building!;
  stats.textContent = `${kind} · ${Math.round(engine.getFps())} FPS · HP ${Math.ceil(h.hp)}/${h.stats.maxHp} · Mana ${Math.floor(h.mana)} · Skills cast ${autoCasts}${lastSkill ? ' · ' + lastSkill : ''} · Golem queue ${b.queue.length}${b.trainLeft > 0 ? ' · ' + (b.trainLeft / 20).toFixed(1) + 's' : ''} · Local real combat simulation`;
  buttons.forEach((button, i) => {
    const a = ABILITIES.find((a) => a.id === h.heroState!.def.abilities[i])!;
    const left = Math.max(0, ((h.cooldowns[i] ?? 0) - sim.tick) / 20);
    button.querySelector('small')!.textContent =
      a.id === 'stone_remnant'
        ? `${client?.ability(i)?.charges ?? 0} stones · ${Math.ceil(client?.ability(i)?.rechargeLeft ?? 0)}s refill`
        : a.kind !== 'active'
          ? a.kind
          : left > 0
            ? `${left.toFixed(1)}s`
            : a.target === 'none'
              ? 'Ready'
              : 'Aim target';
  });
});
