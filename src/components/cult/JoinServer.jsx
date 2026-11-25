import { useTranslation } from 'react-i18next'

import { discordInviteUrl } from '../../lib/siteConfig.js'

/*
 * For someone logged in who isn't in the Discord server: what's waiting
 * there, and the invite. Used where the community's parts would be (the
 * member list, birthdays, voting). `what`: which part, for the text.
 */
export default function JoinServer({ what = 'general', compact = false }) {
  const { t } = useTranslation('cult')
  return (
    <div className={`members-locked${compact ? ' members-locked--compact' : ''}`}>
      <span className="material-symbols-outlined" aria-hidden="true">
        group_add
      </span>
      <h1>{t('join.title')}</h1>
      <p>{t(`join.${what}`, { defaultValue: t('join.general') })}</p>
      {discordInviteUrl && (
        <a className="members-button" href={discordInviteUrl} target="_blank" rel="noopener noreferrer">
          <span className="material-symbols-outlined" aria-hidden="true">
            open_in_new
          </span>
          {t('join.button')}
        </a>
      )}
      <p className="members-locked__note">{t('join.note')}</p>
    </div>
  )
}
