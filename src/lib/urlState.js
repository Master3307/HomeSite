import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router'

/*
 * UI state kept in the address (?fdc=archive&poll=…&manage=edit), so a
 * copied link or a reload lands on the same view, dialog or editor.
 * `push`: a new history entry (Back returns); otherwise the current entry
 * is replaced (sub-views, dialogs). Unknown values are the caller's to
 * ignore: the address is user input.
 */
export function useUrlParam(name, { push = false } = {}) {
  const [params, setParams] = useSearchParams()
  const value = params.get(name)
  const set = useCallback(
    (next, { clear = [], push: pushThis = push } = {}) =>
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          if (next === null || next === undefined || next === false || next === '') updated.delete(name)
          else updated.set(name, next === true ? '1' : String(next))
          for (const key of clear) updated.delete(key)
          return updated
        },
        { replace: !pushThis, preventScrollReset: true },
      ),
    [name, setParams, push],
  )
  return [value, set]
}

/** Scrolls the element with `id` into view once, when the page was opened with any of `params` set. */
export function useScrollToParam(id, params) {
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    if (!params.some((key) => search.has(key))) return
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 300)
    return () => clearTimeout(timer)
    // Only on the first render: later changes come from the user being there already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
