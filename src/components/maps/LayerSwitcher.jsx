import { useTranslation } from 'react-i18next'
import { BASE_LAYERS, OVERLAYS } from '../../lib/maps/layers.js'
import { updateMapsSettings, useMapsSettings } from '../../lib/maps/mapsSettings.js'
import { MapsIcon, MapsIconButton } from './ui.jsx'

/** Popover for choosing the base map and toggling overlays. */
export default function LayerSwitcher({ onClose }) {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()

  function toggleOverlay(id) {
    updateMapsSettings((current) => ({
      overlays: current.overlays.includes(id)
        ? current.overlays.filter((entry) => entry !== id)
        : [...current.overlays, id],
    }))
  }

  return (
    <div className="maps-popover maps-layers" role="dialog" aria-label={t('layers.title')}>
      <div className="maps-popover__head">
        <strong>{t('layers.title')}</strong>
        <MapsIconButton icon="close" label={t('common.close')} onClick={onClose} />
      </div>

      <div className="maps-layers__grid" role="radiogroup" aria-label={t('layers.base')}>
        {BASE_LAYERS.map((layer) => (
          <button
            key={layer.id}
            type="button"
            role="radio"
            aria-checked={settings.baseLayer === layer.id}
            className={`maps-layer${settings.baseLayer === layer.id ? ' maps-layer--active' : ''} maps-layer--${layer.id}`}
            onClick={() => updateMapsSettings({ baseLayer: layer.id })}
          >
            <span className="maps-layer__preview"><MapsIcon>{layer.icon}</MapsIcon></span>
            <span>{t(`layers.names.${layer.id}`)}</span>
          </button>
        ))}
      </div>

      <h4>{t('layers.overlays')}</h4>
      <ul className="maps-check-list">
        {OVERLAYS.map((layer) => (
          <li key={layer.id}>
            <label className="maps-check">
              <input
                type="checkbox"
                checked={settings.overlays.includes(layer.id)}
                onChange={() => toggleOverlay(layer.id)}
              />
              <MapsIcon>{layer.icon}</MapsIcon>
              <span>{t(`layers.names.${layer.id}`)}</span>
            </label>
          </li>
        ))}
        <li>
          <label className="maps-check">
            <input
              type="checkbox"
              checked={settings.showFavorites}
              onChange={(event) => updateMapsSettings({ showFavorites: event.target.checked })}
            />
            <MapsIcon>favorite</MapsIcon>
            <span>{t('saved.showOnMap')}</span>
          </label>
        </li>
      </ul>
    </div>
  )
}
