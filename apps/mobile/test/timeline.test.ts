import { describe, expect, it } from 'vitest';
import { groupStories, type TimelineEvent } from '../src/animals/timeline';

const ev = (at: string, kind: string, title: string, record_id: string | null = null, episode: string | null = null): TimelineEvent => ({ at, kind, title, detail: null, record_id, episode });

describe('history as stories', () => {
  it('groups a health concern with its visit and treatment, oldest first, where its newest event is', () => {
    const events = [
      ev('2026-11-06', 'milk', 'Milk 20 L'),
      ev('2026-11-04', 'treatment', 'Treatment: Cloxacillin', 't1', 'h1'),
      ev('2026-11-04', 'vet_visit', 'Veterinary visit: Dr Banda', 'v1', 'h1'),
      ev('2026-11-03', 'health', 'Clinical mastitis', 'h1', 'h1'),
      ev('2026-10-01', 'audit', 'Registered'),
    ];
    const items = groupStories(events);
    expect(items.map((i) => i.type)).toEqual(['event', 'story', 'event']);
    const story = items[1];
    expect(story).toMatchObject({ type: 'story', kind: 'health', title: 'Clinical mastitis', from: '2026-11-03', to: '2026-11-04' });
    expect(story.type === 'story' && story.events.map((e) => e.kind)).toEqual(['health', 'vet_visit', 'treatment']);
  });

  it('names a breeding story by how it began and where it got to', () => {
    const items = groupStories([
      ev('2026-08-10', 'calving', 'Calved', 'c1', 'b1'),
      ev('2025-12-06', 'pregnancy_check', 'Pregnancy check: pregnant', 'p1', 'b1'),
      ev('2025-11-01', 'breeding', 'Artificial insemination', 'b1', 'b1'),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'story', kind: 'breeding', title: 'Artificial insemination → calved' });
  });

  it('leaves a lone record as it is', () => {
    const items = groupStories([ev('2026-11-02', 'breeding', 'Heat seen', 'b2', null), ev('2026-10-20', 'health', 'Lame', 'h2', 'h2')]);
    expect(items.map((i) => i.type)).toEqual(['event', 'event']);
  });
});
