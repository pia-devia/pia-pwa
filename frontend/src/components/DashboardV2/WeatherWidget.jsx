import { useState, useEffect, useCallback } from 'react';
import { Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, CloudFog, CloudSun } from 'lucide-react';
import styles from './WeatherWidget.module.css';

const WEATHER_MAP = {
  0:  { icon: Sun,            label: 'Despejado' },
  1:  { icon: CloudSun,       label: 'Poco nublado' },
  2:  { icon: CloudSun,       label: 'Parcial' },
  3:  { icon: Cloud,          label: 'Nublado' },
  45: { icon: CloudFog,       label: 'Niebla' },
  48: { icon: CloudFog,       label: 'Niebla' },
  51: { icon: CloudDrizzle,   label: 'Llovizna' },
  53: { icon: CloudDrizzle,   label: 'Llovizna' },
  55: { icon: CloudDrizzle,   label: 'Llovizna' },
  61: { icon: CloudRain,      label: 'Lluvia' },
  63: { icon: CloudRain,      label: 'Lluvia' },
  65: { icon: CloudRain,      label: 'Lluvia fuerte' },
  71: { icon: CloudSnow,      label: 'Nieve' },
  73: { icon: CloudSnow,      label: 'Nieve' },
  75: { icon: CloudSnow,      label: 'Nieve' },
  80: { icon: CloudRain,      label: 'Chubascos' },
  81: { icon: CloudRain,      label: 'Chubascos' },
  82: { icon: CloudRain,      label: 'Chubascos' },
  95: { icon: CloudLightning, label: 'Tormenta' },
  96: { icon: CloudLightning, label: 'Tormenta' },
  99: { icon: CloudLightning, label: 'Tormenta' },
};

export default function WeatherWidget({ compact }) {
  const [weather, setWeather] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=40.6&longitude=-3.71&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Europe/Madrid&forecast_days=1'
      );
      if (res.ok) {
        const d = await res.json();
        setWeather({
          temp: Math.round(d.current.temperature_2m),
          code: d.current.weather_code,
          min: Math.round(d.daily.temperature_2m_min[0]),
          max: Math.round(d.daily.temperature_2m_max[0]),
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 600000);
    return () => clearInterval(id);
  }, [load]);

  if (!weather) return null;

  const w = WEATHER_MAP[weather.code] || { icon: Sun, label: '—' };
  const Icon = w.icon;

  return (
    <div className={styles.row}>
      <div className={styles.sep} />
      <Icon size={14} strokeWidth={1.5} className={styles.icon} />
      <span className={styles.temp}>{weather.temp}°</span>
      {!compact && <span className={styles.condition}>{w.label}</span>}
      <span className={styles.range}>{weather.min}°/{weather.max}°</span>
    </div>
  );
}
