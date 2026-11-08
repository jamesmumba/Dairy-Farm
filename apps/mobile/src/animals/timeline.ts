// The animal's history, as stories: a health concern with its vet visits, treatments and the milk alert
// that led to it; a mating with its pregnancy check and calving. Pure, so it can be tested.

import type { CareKind } from '../care/model';

export interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  /** The record behind the event (none for daily milk and changes to the animal). */
  record_id?: string | null;
  /** Events of one story share this. */
  episode?: string | null;
}

export type TimelineItem =
  | { type: 'event'; event: TimelineEvent }
  | { type: 'story'; episode: string; title: string; kind: 'health' | 'breeding'; events: TimelineEvent[]; from: string; to: string };

/** Which record screen an event opens. */
export const EVENT_KIND: Record<string, CareKind> = {
  health: 'health',
  vet_visit: 'vet-visit',
  treatment: 'treatment',
  breeding: 'breeding',
  pregnancy_check: 'pregnancy-check',
  calving: 'calving',
  vaccination: 'vaccination',
  alert_action: 'action',
};

/**
 * Newest first, as the server sends them. A story of two or more events becomes one item, placed where
 * its newest event is, with its events oldest first so it reads as it happened.
 */
export function groupStories(events: TimelineEvent[]): TimelineItem[] {
  const byEpisode = new Map<string, TimelineEvent[]>();
  for (const e of events) if (e.episode) byEpisode.set(e.episode, [...(byEpisode.get(e.episode) ?? []), e]);

  const items: TimelineItem[] = [];
  const placed = new Set<string>();
  for (const e of events) {
    const group = e.episode ? byEpisode.get(e.episode)! : null;
    if (!group || group.length < 2) {
      items.push({ type: 'event', event: e });
      continue;
    }
    if (placed.has(e.episode!)) continue;
    placed.add(e.episode!);
    const ordered = [...group].reverse();
    const root = ordered.find((x) => x.record_id === e.episode) ?? ordered[0];
    const health = ordered.some((x) => x.kind === 'health');
    items.push({
      type: 'story',
      episode: e.episode!,
      kind: health ? 'health' : 'breeding',
      title: health ? root.title : storyTitle(ordered),
      events: ordered,
      from: ordered[0].at,
      to: ordered[ordered.length - 1].at,
    });
  }
  return items;
}

/** "Artificial insemination → calved": how a breeding story began and where it has got to. */
function storyTitle(events: TimelineEvent[]) {
  const first = events[0].title;
  const last = events[events.length - 1];
  if (last === events[0]) return first;
  const end = last.kind === 'calving' ? last.title.toLowerCase() : last.title.replace(/^Pregnancy check: /, '').toLowerCase();
  return `${first} → ${end}`;
}
