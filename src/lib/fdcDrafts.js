import { useCallback, useEffect, useState } from "react";

/*
 * FDC polls prepared while the server is unreachable (or by a local admin
 * session) are kept in this browser's IndexedDB, images included, until
 * they can be sent through the account API.
 */

const DB_NAME = "homesite-fdc";
const STORE = "drafts";
const CHANGE_EVENT = "homesite:fdc-drafts";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, run) {
  const db = await openDb();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const result = run(transaction.objectStore(STORE));

      transaction.oncomplete = () => resolve(result?.result ?? result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Saves a draft: `{ endsAt, options: [{ file, description, emoji }] }`. */
export async function saveFdcDraft({ endsAt, options }) {
  const draft = {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    endsAt,
    options: options.map((option) => ({
      description: option.description,
      emoji: option.emoji,
      edit: option.edit ?? null,
      // Blobs are stored as-is; File names live alongside.
      file: option.file,
      name: option.file.name,
      type: option.file.type,
    })),
    lastError: null,
  };

  await withStore("readwrite", (store) => store.put(draft));
  notify();
  return draft;
}

export async function listFdcDrafts() {
  if (!("indexedDB" in window)) return [];

  const drafts = await withStore("readonly", (store) => store.getAll());
  return [...(drafts ?? [])].sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteFdcDraft(id) {
  await withStore("readwrite", (store) => store.delete(id));
  notify();
}

export async function updateFdcDraft(id, patch) {
  const drafts = await listFdcDrafts();
  const draft = drafts.find((item) => item.id === id);
  if (!draft) return;

  await withStore("readwrite", (store) => store.put({ ...draft, ...patch }));
  notify();
}

/** Turns a stored draft back into `createFdc` input. */
export function draftToPayload(draft) {
  return {
    endsAt: draft.endsAt,
    options: draft.options.map((option) => ({
      description: option.description,
      emoji: option.emoji,
      edit: option.edit ?? null,
      file:
        option.file instanceof File
          ? option.file
          : new File([option.file], option.name || "image", {
              type: option.type || option.file.type,
            }),
    })),
  };
}

export function useFdcDrafts() {
  const [drafts, setDrafts] = useState([]);

  const refresh = useCallback(() => {
    listFdcDrafts()
      .then(setDrafts)
      .catch((error) => console.warn("Could not read FDC drafts:", error));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => window.removeEventListener(CHANGE_EVENT, refresh);
  }, [refresh]);

  return drafts;
}
