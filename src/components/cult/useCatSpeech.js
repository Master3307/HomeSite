import { useEffect, useMemo, useRef, useState } from "react";

/*
 * LobbyCat's speech queue. Each message stays up for a time based on its
 * length (clicks don't skip it), then the next one in the queue follows.
 * Questions with answer buttons stay until answered (or a timeout).
 *
 *   say(["Hi!", "I'm LobbyCat."], { priority })  priority "low" is dropped
 *                                                 while the cat is talking
 *   ask({ text, choices: [{ id, label, emoji }], onAnswer(id | null) })
 *   busy()                                        talking or about to
 */

const LEAVE_MS = 220;
const GAP_MS = 320;
const ASK_TIMEOUT_MS = 20_000;
const MAX_QUEUE = 6;

function durationFor(text) {
  return Math.min(7000, Math.max(2600, 1800 + text.length * 55));
}

export function useCatSpeech() {
  const [current, setCurrent] = useState(null);

  const queueRef = useRef([]);
  const currentRef = useRef(null);
  const gapRef = useRef(false);
  const idRef = useRef(0);
  const timersRef = useRef(new Set());

  const api = useMemo(() => {
    const later = (fn, ms) => {
      const timer = setTimeout(() => {
        timersRef.current.delete(timer);
        fn();
      }, ms);
      timersRef.current.add(timer);
    };

    function setShown(item) {
      currentRef.current = item;
      setCurrent(item);
    }

    function next() {
      gapRef.current = false;
      const item = queueRef.current.shift();
      if (!item) return setShown(null);

      setShown(item);
      if (item.choices) later(() => answer(item.id, null), ASK_TIMEOUT_MS);
      else later(() => leave(item.id), durationFor(item.text));
    }

    function leave(id) {
      const item = currentRef.current;
      if (!item || item.id !== id || item.leaving) return;

      setShown({ ...item, leaving: true });
      later(() => {
        gapRef.current = true;
        setShown(null);
        later(next, GAP_MS);
      }, LEAVE_MS);
    }

    function answer(id, choice) {
      const item = currentRef.current;
      if (!item || item.id !== id || item.leaving) return;

      leave(id);
      item.onAnswer?.(choice);
    }

    function busy() {
      return Boolean(currentRef.current || gapRef.current || queueRef.current.length);
    }

    function enqueue(items, { priority = "high" } = {}) {
      if (priority === "low" && busy()) return false;

      for (const item of items) {
        queueRef.current.push({ id: ++idRef.current, ...item });
      }
      queueRef.current.splice(MAX_QUEUE);

      if (!currentRef.current && !gapRef.current) next();
      return true;
    }

    return {
      say: (texts, options) => enqueue(texts.map((text) => ({ text })), options),
      ask: ({ text, choices, onAnswer }) => enqueue([{ text, choices, onAnswer }]),
      answer,
      busy,
    };
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  return { current, ...api };
}
