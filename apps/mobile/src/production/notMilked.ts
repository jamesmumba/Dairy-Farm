// Cows the farmer marked "not milked" at one milking (sick, kept with her calf), kept on this phone so
// that milking is not reported as a missing record. No milk entry is made: a cow not milked gave no
// figure, which is different from 0 L.

import { localSet } from '../lib/localSet';
import type { Session } from './calc';

const notMilked = localSet('milk.notMilked');
export const notMilkedKey = (date: string, session: Session, cattleId: string) => `${date}:${session}:${cattleId}`;
export const useNotMilked = notMilked.use;
export const markNotMilked = notMilked.add;
export const undoNotMilked = notMilked.remove;
