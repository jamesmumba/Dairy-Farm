import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { getJson, setJson } from '../lib/localDb';
import type { Cattle } from './model';

/**
 * The URI to show for an animal's photo: the local file while it waits to upload, otherwise a
 * short-lived signed URL. The last URL is remembered so expo-image can serve its disk cache
 * (keyed by photo_path) when offline.
 */
export function usePhotoUri(animal: Cattle | undefined) {
  const id = animal?.id;
  const path = animal?.photo_path ?? null;
  const remembered = useMemo(() => (path ? getJson<string>(`photo.${path}`) : null), [path]);
  const [fresh, setFresh] = useState<{ path: string; url: string } | null>(null);

  useEffect(() => {
    if (!path || !id) return;
    api<{ url: string }>(`/v1/cattle/${id}/photo-url`)
      .then(({ url }) => {
        setJson(`photo.${path}`, url);
        setFresh({ path, url });
      })
      .catch(() => {}); // offline: keep the remembered URL
  }, [id, path]);

  if (animal?.local_photo_uri) return { uri: animal.local_photo_uri };
  const url = fresh?.path === path ? fresh.url : remembered;
  return path && url ? { uri: url, cacheKey: path } : null;
}
