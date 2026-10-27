-- Stage 3: animals.

-- Animals entered by mistake (no linked records) are soft-deleted so the deletion
-- reaches other devices through sync. Animals with history are retired via status instead.
alter table public.cattle add column deleted_at timestamptz;

-- A deleted animal's ear tag may be reused.
drop index public.cattle_owner_ear_tag_uq;
create unique index cattle_owner_ear_tag_uq on public.cattle (owner_id, ear_tag)
  where ear_tag is not null and deleted_at is null;

create index cattle_breeds_owner_updated_idx on public.cattle_breeds (owner_id, updated_at);

-- Private bucket for animal photos. No storage policies: only the API (service key) can
-- issue short-lived signed upload/download URLs. Size and type are enforced by the bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('animal-photos', 'animal-photos', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
