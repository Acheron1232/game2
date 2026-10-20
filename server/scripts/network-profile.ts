import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BinaryWriter, ClientView, entitySources, parseTerrain, SnapshotWriter, TeamSight } from '@game/shared';
import { readSharedDataFile } from '../src/data-files';
import { runHeadlessMatch } from '../src/match/headless';

const terrain = parseTerrain(readSharedDataFile('map-terrain.bin'));
const totals = [0, 0, 0, 0];
const largest = [0, 0, 0, 0];
const fromTick = 15 * 60 * 20;
const toTick = 20 * 60 * 20;
runHeadlessMatch({
  seed: 9,
  slots: 4,
  maxMinutes: 20,
  attach: (sim) => {
    const vision = new TeamSight(terrain, sim.factions!.trees);
    const views = [0, 1, 2, 3].map((slot) => new ClientView(slot, slot + 1));
    const sw = new SnapshotWriter();
    const writer = new BinaryWriter(4096);
    return {
      update() {
        if (sim.tick % 2 === 1) vision.update(entitySources(sim.entities));
        for (let slot = 0; slot < 4; slot++) {
          const bytes = views[slot]!.write(sim, vision, sw, writer).byteLength;
          if (sim.tick >= fromTick && sim.tick < toTick) {
            totals[slot]! += bytes;
            largest[slot] = Math.max(largest[slot]!, bytes);
          }
        }
      },
    };
  },
});
const report = {
  seed: 9,
  gameMinutes: [15, 20],
  snapshotHz: 20,
  downKBps: totals.map((bytes) => bytes / 300 / 1024),
  largestSnapshotBytes: largest,
  note: 'Four normal team views in a real bot combat simulation; payload bytes, without WebSocket headers. Not the all-seeing accelerated spectator.',
};
mkdirSync(join(import.meta.dirname, '../logs'), { recursive: true });
writeFileSync(join(import.meta.dirname, '../logs/network-profile.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
