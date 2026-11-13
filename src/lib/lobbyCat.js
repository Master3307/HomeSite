/*
 * Lets anything on the page make the lobby cat speak:
 *
 *   import { catSay } from "/src/lib/lobbyCat";
 *   catSay("Meow!");                  // default duration
 *   catSay("New lobby code!", 6000);  // shown for 6 s
 *
 * components/cult/LobbyCat.jsx listens for the event and shows a bubble.
 */

export const CAT_SAY_EVENT = "homesite:lobby-cat-say";

export function catSay(text, duration) {
  window.dispatchEvent(
    new CustomEvent(CAT_SAY_EVENT, { detail: { text: String(text), duration } }),
  );
}

/*
 * Tells LobbyCat that something happened on the page, so it can react:
 *   catNotice("lobby-copied")
 *   catNotice("lobby-submitted", { status: "posted" | "pending" })
 *   catNotice("fdc-voted", { removed: false })
 * Reactions are modules in lib/lobbyCatBrain/modules.js (event "notice").
 */
export const CAT_NOTICE_EVENT = "homesite:lobby-cat-notice";

export function catNotice(type, detail = {}) {
  window.dispatchEvent(new CustomEvent(CAT_NOTICE_EVENT, { detail: { type, detail } }));
}
