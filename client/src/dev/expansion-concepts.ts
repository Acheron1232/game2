// A selection board for concept art. It does not alter the game's data or asset manifest.
import data from '../../../art/concepts/2026-10-23/catalog.json';
import production from '../../../art/concepts/2026-10-23/01-production.png?url';
import unitsA from '../../../art/concepts/2026-10-23/02-new-units-a.png?url';
import unitsB from '../../../art/concepts/2026-10-23/03-new-units-b.png?url';
import walls from '../../../art/concepts/2026-10-23/04-walls-gates.png?url';
import towers from '../../../art/concepts/2026-10-23/05-towers-traps.png?url';
import existing from '../../../art/concepts/2026-10-23/06-existing-rosters.png?url';

interface Concept {
  code: string;
  name: string;
  does: string;
  weakness: string;
  parent?: string;
  parentName?: string;
  trains?: string[];
  role?: string;
}
interface Sheet {
  id: string;
  title: string;
  concepts: Concept[];
}
const sheets: Sheet[] = data.sheets;
const urls = [production, unitsA, unitsB, walls, towers, existing];
const names = ['Training buildings', 'New recruits I', 'New recruits II', 'Walls & gates', 'Towers & traps', 'Existing barracks'];
const all = new Map(sheets.flatMap((s) => s.concepts.map((c) => [c.code, c] as const)));
const implemented: Record<string, string> = {
  B14: 'tusk_lodge',
  B23: 'wayfarer_inn',
  B24: 'cinder_inn',
  U15: 'boar_lancer',
  U16: 'ram_drummer',
  U25: 'covered_ram',
  U26: 'bolt_cart',
  U33: 'badger_mercenary',
  U34: 'fox_trailshot',
  U35: 'coalback_porter',
  U46: 'kite_bomber',
  B13: 'bulwark_hall',
  U14: 'chainbreaker',
  U17: 'rune_gunner',
  U18: 'null_warden',
  U24: 'reliquary_guard',
  U38: 'banner_captain',
  U41: 'lantern_novice',
  U42: 'veil_sister',
  U47: 'bulwark_golem',
  U48: 'siege_golem',
  D01: 'timber_wall',
  D02: 'stone_wall',
  D11: 'repair_post',
  D12: 'rally_bastion',
  D15: 'chain_spire',
  D16: 'frost_obelisk',
  D18: 'bell_ward',
  D21: 'pitch_basin',
  D23: 'wind_totem',
  D24: 'shield_pylon',
};
const storageKey = 'temple-wars-concepts-2026-10-23';
let chosen = new Set<string>();
try {
  chosen = new Set<string>(JSON.parse(localStorage.getItem(storageKey) || '[]'));
} catch {
  /* A fresh selection also works with storage blocked. */
}
let active = Math.max(
  0,
  sheets.findIndex((s) => s.id === new URLSearchParams(location.search).get('sheet')),
);
const host = document.querySelector<HTMLElement>('#catalog')!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
};
document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
*{box-sizing:border-box}html{background:#18221e;color:#eee8da;font-family:system-ui,sans-serif}body{margin:0}main{max-width:1460px;margin:auto;padding:32px 28px 64px}header{display:flex;align-items:start;gap:28px;border-bottom:1px solid #b8a5734a;padding-bottom:22px}header>div:first-child{flex:1}.eyebrow{font-size:11px;letter-spacing:.22em;color:#c8b783;font-weight:700}h1{font-family:Georgia,serif;font-size:34px;font-weight:400;line-height:1.2;margin:10px 0}header p{max-width:760px;color:#b5c1b6;font-size:14px;line-height:1.6;margin:0}.summary{min-width:100px;text-align:right;font-size:12px;color:#b5c1b6}.summary strong{display:block;font-family:Georgia,serif;font-size:42px;line-height:1.2;color:#e3d29c;font-weight:400}nav{display:flex;flex-wrap:wrap;gap:8px;padding:22px 0 18px}button{font:inherit;font-size:13px;cursor:pointer;border:1px solid #657363;background:#27372e;color:#e9e6d9;padding:9px 13px;border-radius:3px}button:hover{border-color:#c4af75}button[aria-pressed=true]{background:#d8c28a;color:#20271f;border-color:#d8c28a}.toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px}.toolbar h2{font-size:18px;font-weight:500;letter-spacing:.02em;margin:0;flex:1}.toolbar a{color:#dbc58f;font-size:13px}.sheet{display:block;width:100%;height:auto;background:#ece4d4;border:1px solid #b7a16d66}.guide{color:#b5c1b6;font-size:13px;line-height:1.6;margin:14px 0 20px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid #b8a5734a;border-left:1px solid #b8a5734a}.card{padding:18px 20px;border-right:1px solid #b8a5734a;border-bottom:1px solid #b8a5734a;scroll-margin-top:25px}.card.selected{background:#bca36813}.card h3{font-size:15px;font-weight:600;margin:0;line-height:1.5}.card label{display:flex;align-items:start;gap:9px;cursor:pointer}.card input{margin:5px 0 0;accent-color:#d8c28a;width:15px;height:15px}.code{color:#d7c18b;font-variant-numeric:tabular-nums;margin-right:6px}.card p{font-size:13px;line-height:1.65;margin:10px 0;color:#dedfd2}.card .weak{color:#a8b5a8;font-size:12px}.links{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:#b5c1b6;font-size:11px;margin-top:12px}.links button{padding:4px 7px;font-size:11px}.selection{margin-top:24px;border:1px solid #b8a5734a;padding:18px 20px;background:#1d2b22}.selection h2{font-size:15px;font-weight:500;margin:0 0 10px}.selection p{font-size:13px;color:#cabd99;line-height:1.7;min-height:22px}.selection .buttons{display:flex;gap:8px}.existing{font-size:12px;line-height:1.7;color:#b5c1b6;border-left:2px solid #bda56c;padding-left:14px;margin:14px 0 20px}.notice{font-size:12px;color:#a6b2a5;margin-top:18px;line-height:1.6}.card:target{outline:2px solid #d8c28a;outline-offset:-2px}@media(min-width:1700px){main{padding-top:48px}}@media(max-width:900px){main{padding:22px 16px 40px}h1{font-size:27px}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}header{gap:15px}.summary strong{font-size:34px}}@media(max-width:580px){.cards{grid-template-columns:1fr}h1{font-size:24px}.summary{min-width:60px}nav{gap:6px}nav button{font-size:11px;padding:8px}header p{font-size:12px}.card{padding:16px}.toolbar{gap:8px}}
</style>`,
);
const header = el('header');
const intro = el('div');
intro.append(
  el('div', 'TEMPLE WARS / CONCEPT ROUND 02'),
  el('h1', 'Production & defense'),
  el(
    'p',
    '72 concepts to choose from. New training branches, their recruits, walls, gates and defensive structures — plus new troops for the six production buildings already in the game.',
  ),
);
intro.firstElementChild!.className = 'eyebrow';
const summary = el('div');
summary.className = 'summary';
summary.append(el('strong', '72'), el('span', '6 sheets · 12 each'));
header.append(intro, summary);
const nav = el('nav');
nav.setAttribute('aria-label', 'Concept sheets');
const body = el('section');
const selected = el('section');
selected.className = 'selection';
selected.append(el('h2', 'Your shortlist'));
const selectionText = el('p');
const buttonRow = el('div');
buttonRow.className = 'buttons';
const copy = el('button', 'Copy codes');
const download = el('button', 'Save shortlist');
buttonRow.append(copy, download);
selected.append(selectionText, buttonRow);
host.append(
  header,
  nav,
  body,
  selected,
  el(
    'p',
    'Both selected batches are playable: seventeen units and fifteen structures, including three wall levels and two map inns. Cards with a model link have a first implementation; other cards remain concepts.',
  ),
);
host.lastElementChild!.className = 'notice';
function shortlist(): string {
  return sheets
    .flatMap((s) => s.concepts)
    .filter((c) => chosen.has(c.code))
    .map((c) => c.code + ' ' + c.name)
    .join('\n');
}
function updateSelection(): void {
  selectionText.textContent =
    shortlist().replaceAll('\n', ' · ') || 'Select the checkboxes below the sheet. Your choices stay in this browser.';
  try {
    localStorage.setItem(storageKey, JSON.stringify([...chosen]));
  } catch {
    /* Selection remains usable in memory. */
  }
}
copy.onclick = async () => {
  try {
    await navigator.clipboard.writeText([...chosen].sort().join(', '));
    copy.textContent = 'Copied';
  } catch {
    selectionText.textContent = shortlist();
  }
};
download.onclick = () => {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([shortlist() + '\n'], { type: 'text/plain' }));
  a.download = 'temple-wars-concept-shortlist.txt';
  a.click();
  URL.revokeObjectURL(a.href);
};
function go(code: string): void {
  const index = sheets.findIndex((s) => s.concepts.some((c) => c.code === code));
  if (index < 0) return;
  show(index);
  location.hash = code;
  document.getElementById(code)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function link(code: string): HTMLButtonElement {
  const button = el('button', code + ' ' + (all.get(code)?.name || ''));
  button.onclick = () => go(code);
  return button;
}
function show(index: number): void {
  active = index;
  const sheet = sheets[index]!;
  history.replaceState(null, '', `?sheet=${sheet.id}`);
  body.replaceChildren();
  for (const [i, button] of [...nav.children].entries()) button.setAttribute('aria-pressed', String(i === active));
  const toolbar = el('div');
  toolbar.className = 'toolbar';
  toolbar.append(el('h2', sheet.title));
  const full = el('a', 'Open full-resolution sheet ↗');
  full.href = urls[index]!;
  full.target = '_blank';
  full.rel = 'noopener';
  toolbar.append(full);
  const picture = el('img');
  picture.className = 'sheet';
  picture.src = urls[index]!;
  picture.alt = sheet.title + ' — twelve concepts, left to right and top to bottom';
  const guide = el(
    'p',
    'Read left to right, top to bottom. The descriptions below explain each role and its weakness. Click a source or recruit code to follow its production chain.',
  );
  guide.className = 'guide';
  body.append(toolbar, picture, guide);
  if (index === 5) {
    const note = el('div');
    note.className = 'existing';
    note.textContent =
      'Current rosters — ' +
      data.existingBuildings.map((b) => b.name + ': ' + b.currentUnits.map((id) => id.replaceAll('_', ' ')).join(', ')).join(' · ') +
      '. The concepts below are proposed additions.';
    body.append(note);
  }
  const grid = el('div');
  grid.className = 'cards';
  for (const concept of sheet.concepts) {
    const card = el('article');
    card.id = concept.code;
    card.className = 'card' + (chosen.has(concept.code) ? ' selected' : '');
    const label = el('label');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = chosen.has(concept.code);
    checkbox.setAttribute('aria-label', 'Select ' + concept.code + ' ' + concept.name);
    const heading = el('h3');
    const code = el('span', concept.code);
    code.className = 'code';
    heading.append(code, document.createTextNode(concept.name));
    label.append(checkbox, heading);
    card.append(label, el('p', concept.does));
    const weak = el('p', 'Counterplay: ' + concept.weakness);
    weak.className = 'weak';
    card.append(weak);
    if (implemented[concept.code]) {
      const review = el('a', 'Playable draft · view 3D model ↗');
      review.href = `/dev/models.html?model=${implemented[concept.code]}`;
      review.style.color = '#d7c18b';
      review.style.fontSize = '12px';
      card.append(review);
    }
    const links = el('div');
    links.className = 'links';
    if (concept.trains) {
      links.append(el('span', concept.code === 'B23' || concept.code === 'B24' ? 'Hires:' : 'Trains:'));
      for (const code of concept.trains) links.append(link(code));
    } else if (concept.parent) {
      links.append(el('span', 'From:'));
      if (all.has(concept.parent)) links.append(link(concept.parent));
      else links.append(el('span', concept.parentName || concept.parent));
    } else links.append(el('span', concept.role || 'Defense'));
    card.append(links);
    checkbox.onchange = () => {
      if (checkbox.checked) chosen.add(concept.code);
      else chosen.delete(concept.code);
      card.classList.toggle('selected', checkbox.checked);
      updateSelection();
    };
    grid.append(card);
  }
  body.append(grid);
  updateSelection();
}
names.forEach((name, i) => {
  const button = el('button', name);
  button.onclick = () => show(i);
  nav.append(button);
});
show(active);
