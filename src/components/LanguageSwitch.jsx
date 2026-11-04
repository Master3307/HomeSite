import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import twemoji from '@twemoji/api'
import { supportedLngs } from '../lib/i18n'
import { useAccountSettings } from '../lib/accountSettings.jsx'

const twemojiOptions = {
  base: '/twemoji/',
  folder: 'svg',
  ext: '.svg',
  className: 'discord-emoji',
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }

    return entities[character]
  })
}

function EmojiText({ text }) {
  return (
    <span
      dangerouslySetInnerHTML={{
        __html: twemoji.parse(escapeHtml(text), twemojiOptions),
      }}
    />
  )
}

export default function LanguageSwitch() {
  const { t } = useTranslation('language')
  const { language, setLanguage } = useAccountSettings()
  const pickerRef = useRef(null)

  const languageLabel = t('label', {
    defaultValue: 'Language',
  })

  function getLanguageName(code) {
    return t(`languages.${code}`, {
      defaultValue: code.toUpperCase(),
    })
  }

  function closePicker() {
    if (pickerRef.current) {
      pickerRef.current.open = false
    }
  }

  function selectLanguage(code) {
    setLanguage(code)
    closePicker()
    pickerRef.current?.querySelector('summary')?.focus()
  }

  useEffect(() => {
    function handlePointerDown(event) {
      if (!pickerRef.current?.contains(event.target)) {
        closePicker()
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape' && pickerRef.current?.open) {
        closePicker()
        pickerRef.current.querySelector('summary')?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div className="picker language-picker">
      <details ref={pickerRef} className="picker-dropdown">
        <summary
          className="picker-trigger"
          aria-label={`${languageLabel}: ${getLanguageName(language)}`}
        >
          <EmojiText text={getLanguageName(language)} />

          <span
            className="material-symbols-outlined"
            aria-hidden="true"
          >
            language
          </span>
        </summary>

        <div
          className="picker-options"
          role="group"
          aria-label={languageLabel}
        >
          {supportedLngs.map((code) => (
            <button
              key={code}
              type="button"
              className="picker-option"
              aria-pressed={language === code}
              onClick={() => selectLanguage(code)}
            >
              <EmojiText text={getLanguageName(code)} />

              {language === code && (
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                >
                  check
                </span>
              )}
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}
