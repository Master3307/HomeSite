import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Empty, LoadError, Loading, fetchJson, useRemote } from './kit.jsx'

/*
 * The full weather for a place (open-meteo.com, no key): now, a 48-hour
 * curve with rain, ten days, and the details (feels like, wind and gusts with
 * their direction, humidity, pressure, UV, visibility, clouds, daylight).
 * Used by the weather widget's detail view.
 */

const SKY = [
  [0, 'clear_day', 'clear_night', 'clear'],
  [2, 'partly_cloudy_day', 'partly_cloudy_night', 'partly'],
  [3, 'cloud', 'cloud', 'cloudy'],
  [48, 'foggy', 'foggy', 'fog'],
  [57, 'rainy_light', 'rainy_light', 'drizzle'],
  [67, 'rainy', 'rainy', 'rain'],
  [77, 'weather_snowy', 'weather_snowy', 'snow'],
  [82, 'rainy_heavy', 'rainy_heavy', 'showers'],
  [86, 'weather_snowy', 'weather_snowy', 'snow'],
  [99, 'thunderstorm', 'thunderstorm', 'storm'],
]
const sky = (code, day = true) => {
  const entry = SKY.find(([max]) => Number(code) <= max) ?? SKY[0]
  return { icon: day ? entry[1] : entry[2], word: entry[3] }
}
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/* Temperatures over the next hours as a smooth line, rain chances as bars under it. */
function HourCurve({ hours, locale, degree }) {
  const width = 960
  const height = 150
  const pad = { top: 24, bottom: 34, side: 14 }
  const temps = hours.map((hour) => hour.temp)
  const low = Math.min(...temps)
  const high = Math.max(...temps)
  const span = Math.max(1, high - low)
  const x = (index) => pad.side + (index / Math.max(1, hours.length - 1)) * (width - pad.side * 2)
  const y = (temp) => pad.top + (1 - (temp - low) / span) * (height - pad.top - pad.bottom)
  const points = hours.map((hour, index) => [x(index), y(hour.temp)])
  // Catmull-Rom → Bézier: a smooth line through every hour.
  let path = `M${points[0][0]},${points[0][1]}`
  for (let index = 0; index < points.length - 1; index++) {
    const [p0, p1, p2, p3] = [points[index - 1] ?? points[index], points[index], points[index + 1], points[index + 2] ?? points[index + 1]]
    path += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
  }
  const area = `${path} L${points.at(-1)[0]},${height - pad.bottom} L${points[0][0]},${height - pad.bottom} Z`
  const every = Math.ceil(hours.length / 12)
  return (
    <svg className="dash-wx-curve" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${Math.round(low)}${degree} – ${Math.round(high)}${degree}`}>
      <defs>
        <linearGradient id="dash-wx-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {hours.map((hour, index) =>
        hour.rain >= 5 ? <rect key={`r${index}`} className="dash-wx-curve__rain" x={x(index) - 3} width="6" y={height - pad.bottom - (hour.rain / 100) * 40} height={(hour.rain / 100) * 40} rx="2" /> : null,
      )}
      <path d={area} fill="url(#dash-wx-fill)" className="dash-wx-curve__area" />
      <path d={path} className="dash-wx-curve__line" fill="none" />
      {hours.map((hour, index) =>
        index % every === 0 ? (
          <g key={hour.time}>
            <text x={x(index)} y={y(hour.temp) - 8} textAnchor="middle" className="dash-wx-curve__temp">
              {Math.round(hour.temp)}°
            </text>
            <text x={x(index)} y={height - 10} textAnchor="middle" className="dash-wx-curve__hour">
              {new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(hour.time))}
            </text>
          </g>
        ) : null,
      )}
    </svg>
  )
}

export default function WeatherPanel({ lat, lon, place, unit = 'c', wind = 'kmh' }) {
  const { t, i18n } = useTranslation('dash')
  const locale = i18n.language
  const fahrenheit = unit === 'f'
  const has = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && lat !== '' && lon !== ''
  const { data, error, reload } = useRemote(
    has ? `weather-full:${lat},${lon},${unit},${wind}` : null,
    (signal) => {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day,precipitation,pressure_msl,uv_index,visibility,cloud_cover,dew_point_2m',
        hourly: 'temperature_2m,weather_code,is_day,precipitation_probability',
        daily: 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max,precipitation_sum,uv_index_max,wind_speed_10m_max',
        timezone: 'auto',
        forecast_days: '10',
        forecast_hours: '48',
        wind_speed_unit: ['kmh', 'mph', 'ms', 'kn'].includes(wind) ? wind : 'kmh',
        ...(fahrenheit ? { temperature_unit: 'fahrenheit' } : {}),
      })
      return fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`, { signal })
    },
    { refresh: 15 * 60, enabled: has },
  )
  const [day, setDay] = useState(0)
  const hours = useMemo(() => (data?.hourly?.time ?? []).map((time, index) => ({ time, temp: data.hourly.temperature_2m[index], code: data.hourly.weather_code[index], isDay: data.hourly.is_day[index] !== 0, rain: data.hourly.precipitation_probability?.[index] ?? 0 })), [data])
  if (!has) return <Empty icon="partly_cloudy_day" setup>{t('widgets.weather.empty')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={8} />
  const now = data.current ?? {}
  const units = data.current_units ?? {}
  const degree = fahrenheit ? '°F' : '°C'
  const current = sky(now.weather_code, now.is_day !== 0)
  const days = (data.daily?.time ?? []).map((date, index) => ({ date, max: data.daily.temperature_2m_max[index], min: data.daily.temperature_2m_min[index], code: data.daily.weather_code[index], rain: data.daily.precipitation_probability_max?.[index] ?? 0, sum: data.daily.precipitation_sum?.[index] ?? 0, sunrise: data.daily.sunrise?.[index], sunset: data.daily.sunset?.[index], uv: data.daily.uv_index_max?.[index], wind: data.daily.wind_speed_10m_max?.[index] }))
  const low = Math.min(...days.map((entry) => entry.min))
  const high = Math.max(...days.map((entry) => entry.max))
  const time = (value) => (value ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '–')
  const today = days[0]
  const daylight = today?.sunrise && today?.sunset ? (new Date(today.sunset) - new Date(today.sunrise)) / 3_600_000 : null
  const chosen = days[day] ?? today
  const facts = [
    ['thermostat', t('widgets.weather.feels'), `${Math.round(now.apparent_temperature)}${degree}`],
    ['humidity_percentage', t('widgets.weather.humidity'), `${Math.round(now.relative_humidity_2m)}%`],
    ['air', t('widgets.weather.wind'), `${Math.round(now.wind_speed_10m)} ${units.wind_speed_10m ?? ''} ${COMPASS[Math.round((now.wind_direction_10m ?? 0) / 45) % 8]}`],
    ['storm', t('widgets.weather.gusts'), `${Math.round(now.wind_gusts_10m ?? 0)} ${units.wind_gusts_10m ?? ''}`],
    ['compress', t('widgets.weather.pressure'), `${Math.round(now.pressure_msl ?? 0)} hPa`],
    ['sunny', 'UV', `${Math.round(now.uv_index ?? 0)}`],
    ['visibility', t('widgets.weather.visibility'), now.visibility !== undefined ? `${(now.visibility / 1000).toFixed(now.visibility < 10_000 ? 1 : 0)} km` : '–'],
    ['cloud', t('widgets.weather.clouds'), `${Math.round(now.cloud_cover ?? 0)}%`],
    ['water_drop', t('widgets.weather.dew'), `${Math.round(now.dew_point_2m ?? 0)}${degree}`],
    ['wb_twilight', t('widgets.weather.daylight'), daylight ? `${time(today.sunrise)} – ${time(today.sunset)} · ${Math.floor(daylight)} h ${Math.round((daylight % 1) * 60)} min` : '–'],
  ]
  return (
    <div className="dash-wx" data-sky={current.word} data-day={now.is_day !== 0 ? 'day' : 'night'}>
      <header className="dash-wx__hero">
        <span className="material-symbols-outlined dash-wx__icon" aria-hidden="true">
          {current.icon}
        </span>
        <div className="dash-wx__now">
          <strong>
            {Math.round(now.temperature_2m)}
            <small>{degree}</small>
          </strong>
          <span>{t(`widgets.weather.codes.${current.word}`)}</span>
        </div>
        <div className="dash-wx__place">
          {place && <strong>{place}</strong>}
          {today && (
            <span>
              ↑ {Math.round(today.max)}° ↓ {Math.round(today.min)}°{today.rain > 0 ? ` · ${today.rain}% ${t('widgets.weather.rainShort')}` : ''}
            </span>
          )}
        </div>
      </header>
      <section className="dash-wx__section">
        <h3>{t('widgets.weather.next48')}</h3>
        <HourCurve hours={hours} locale={locale} degree={degree} />
      </section>
      <div className="dash-wx__columns">
        <section className="dash-wx__section">
          <h3>{t('widgets.weather.tenDays')}</h3>
          <ol className="dash-wx__days">
            {days.map((entry, index) => (
              <li key={entry.date}>
                <button type="button" className={day === index ? 'is-active' : ''} onClick={() => setDay(index)} aria-pressed={day === index}>
                  <span className="dash-wx__day">{index === 0 ? t('widgets.weather.today') : new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' }).format(new Date(`${entry.date}T12:00`))}</span>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {sky(entry.code).icon}
                  </span>
                  <span className="dash-wx__rain">{entry.rain > 0 ? `${entry.rain}%` : ''}</span>
                  <span className="dash-wx__min">{Math.round(entry.min)}°</span>
                  <span className="dash-wx__range" aria-hidden="true">
                    <span style={{ left: `${((entry.min - low) / Math.max(1, high - low)) * 100}%`, right: `${100 - ((entry.max - low) / Math.max(1, high - low)) * 100}%` }} />
                  </span>
                  <span className="dash-wx__max">{Math.round(entry.max)}°</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section className="dash-wx__section">
          <h3>{day === 0 ? t('widgets.weather.rightNow') : new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${chosen.date}T12:00`))}</h3>
          {day === 0 ? (
            <dl className="dash-wx__facts">
              {facts.map(([icon, label, value]) => (
                <div key={label}>
                  <dt>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      {icon}
                    </span>
                    {label}
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <dl className="dash-wx__facts">
              {[
                [sky(chosen.code).icon, t('widgets.weather.sky'), t(`widgets.weather.codes.${sky(chosen.code).word}`)],
                ['device_thermostat', t('widgets.weather.temps'), `${Math.round(chosen.min)}° – ${Math.round(chosen.max)}${degree}`],
                ['rainy', t('widgets.weather.rain'), `${chosen.rain}% · ${chosen.sum} mm`],
                ['air', t('widgets.weather.windMax'), `${Math.round(chosen.wind ?? 0)} ${units.wind_speed_10m ?? ''}`],
                ['sunny', t('widgets.weather.uvMax'), `${Math.round(chosen.uv ?? 0)}`],
                ['wb_twilight', t('widgets.weather.sun'), `${time(chosen.sunrise)} – ${time(chosen.sunset)}`],
              ].map(([icon, label, value]) => (
                <div key={label}>
                  <dt>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      {icon}
                    </span>
                    {label}
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
      <p className="dash-wx__source">
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer noopener">
          Open-Meteo
        </a>
      </p>
    </div>
  )
}
