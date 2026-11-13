import { ACCOUNT_API_URL, accountFetch } from "./account";
import { publicPollImage } from "./fdc";

/*
 * FDC recycling bin (server/services/fdcRecycle.cjs): options of ended
 * polls kept by editors for later polls, in optional folders.
 */

async function request(path, body) {
  const response = await accountFetch(path, {
    cache: "no-store",
    ...(body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(data?.error || `Request failed (${response.status}).`), {
      status: response.status,
    });
  }
  return data;
}

/** `{ folders: [{ id, name }], items: [...] }` */
export const loadRecycleBin = () => request("/fdc/recycle");

/** Options of ended polls that are not in the bin. */
export const loadRecycleCandidates = () => request("/fdc/recycle/candidates");

/** `options`: `[{ date, optionNumber }]` */
export const recycleOptions = (options, folderId = null) =>
  request("/fdc/recycle/items", { options, folderId });

export const removeRecycled = (ids) => request("/fdc/recycle/items/remove", { ids });
export const moveRecycled = (ids, folderId) => request("/fdc/recycle/items/move", { ids, folderId });
export const createRecycleFolder = (name) => request("/fdc/recycle/folders", { name });
export const renameRecycleFolder = (id, name) =>
  request(`/fdc/recycle/folders/${encodeURIComponent(id)}/rename`, { name });
export const deleteRecycleFolder = (id) => request(`/fdc/recycle/folders/${encodeURIComponent(id)}/delete`, {});

export function recycledImageUrl(item) {
  return `${ACCOUNT_API_URL}/fdc/recycle/images/${encodeURIComponent(item.id)}`;
}

/** The image of a candidate option (from its archived poll). */
export function candidateImageUrl(candidate) {
  return publicPollImage(
    { imageBase: `/fdc/images/${candidate.date}/`, date: candidate.date },
    { number: candidate.optionNumber, image: `${candidate.optionNumber}.webp`, imageVersion: candidate.imageVersion },
  );
}

export function recyclerAvatarUrl(item) {
  const url = item.recycledBy?.avatarUrl;
  if (!url) return null;
  return /^https?:/.test(url) ? url : `${ACCOUNT_API_URL}${url}`;
}

/** The item's image as a File, ready for the poll form. */
export async function recycledItemFile(item) {
  const response = await fetch(recycledImageUrl(item), { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load the recycled image (${response.status}).`);
  const blob = await response.blob();
  return new File([blob], `recycled-${item.date}-${item.optionNumber}.webp`, { type: blob.type || "image/webp" });
}
