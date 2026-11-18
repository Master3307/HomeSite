import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import EmojiPicker from '../cult/EmojiPicker.jsx'
import { toEmojiIcon, useFloatingPanel } from './kit.jsx'
import '../../styles/fdc.css'

/*
 * The cult's emoji picker as an icon picker on the dash: Twemoji, the
 * server's and the bot's emojis, favourites and recent ones. Gives an icon
 * value (kit.jsx toEmojiIcon). The panel floats free of the dialog it sits
 * in, so it's never cut off.
 */
export default function EmojiIconButton({ onPick, label = null }) {
  const { t } = useTranslation('dash')
  const ref = useRef(null)
  useFloatingPanel(ref, '.emoji-picker__panel')
  // Escape closes the open picker only, not a dialog around it (the picker closes itself on Escape).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && ref.current?.querySelector('.emoji-picker__panel')) event.preventDefault()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])
  return (
    <span ref={ref} className="dash-emoji-button">
      <EmojiPicker variant="insert" label={label ?? t('fields.emojiPick')} onChange={(picked) => picked && onPick(toEmojiIcon(picked), picked)} />
    </span>
  )
}
