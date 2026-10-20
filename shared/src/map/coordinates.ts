import { gameData } from '../data/index';

const MAP_SIZE = gameData.map.size.width;
const POS_SCALE = 65535 / MAP_SIZE;

export const qPos = (v: number) => Math.round(Math.max(0, Math.min(MAP_SIZE, v)) * POS_SCALE);
export const dqPos = (q: number) => q / POS_SCALE;

/** The same position precision in commands, snapshots and path planning. */
export function quantizePoint(x: number, y: number): [number, number] {
  return [dqPos(qPos(x)), dqPos(qPos(y))];
}
