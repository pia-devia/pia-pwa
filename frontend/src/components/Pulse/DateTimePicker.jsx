import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './DateTimePicker.module.css';

const DAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfMonth(year, month) {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1; // Monday = 0
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatDisplay(value) {
  if (!value) return '';
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return value;
  return `${pad(m[1])}/${pad(m[2])}/${m[3]} ${pad(m[4] || '0')}:${pad(m[5] || '0')}`;
}

export default function DateTimePicker({ value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const inputRef = useRef(null);

  // Parse current value or default to now
  const parsed = (() => {
    if (!value) return null;
    const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (!m) return null;
    return { day: +m[1], month: +m[2] - 1, year: +m[3], hour: +(m[4] || 0), minute: +(m[5] || 0) };
  })();

  const now = new Date();
  const [viewYear, setViewYear] = useState(parsed?.year || now.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? now.getMonth());
  const [selectedDay, setSelectedDay] = useState(parsed?.day || null);
  const [hour, setHour] = useState(parsed?.hour ?? 0);
  const [minute, setMinute] = useState(parsed?.minute ?? 0);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const emit = (d, mo, y, h, mi) => {
    onChange(`${pad(d)}/${pad(mo + 1)}/${y} ${pad(h)}:${pad(mi)}`);
  };

  const handleDayClick = (day) => {
    setSelectedDay(day);
    emit(day, viewMonth, viewYear, hour, minute);
  };

  const handleTimeChange = (newH, newM) => {
    setHour(newH);
    setMinute(newM);
    if (selectedDay) emit(selectedDay, viewMonth, viewYear, newH, newM);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const handleClear = () => {
    onChange('');
    setSelectedDay(null);
    setHour(0);
    setMinute(0);
    setOpen(false);
  };

  const days = daysInMonth(viewYear, viewMonth);
  const offset = firstDayOfMonth(viewYear, viewMonth);

  return (
    <div className={styles.wrapper} ref={ref}>
      <input
        type="text"
        className={styles.input}
        value={formatDisplay(value)}
        placeholder={placeholder || 'dd/mm/aaaa hh:mm'}
        ref={inputRef}
        readOnly
        onClick={() => {
          if (!open && inputRef.current) {
            const rect = inputRef.current.getBoundingClientRect();
            setDropPos({ top: rect.bottom + 6, left: rect.left });
          }
          setOpen(!open);
        }}
      />
      {open && (
        <div className={styles.dropdown} style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, transform: 'none' }}>
          {/* Month nav */}
          <div className={styles.header}>
            <button className={styles.navBtn} onClick={prevMonth}><ChevronLeft size={14} /></button>
            <span className={styles.monthLabel}>{MONTHS[viewMonth]} {viewYear}</span>
            <button className={styles.navBtn} onClick={nextMonth}><ChevronRight size={14} /></button>
          </div>

          {/* Day names */}
          <div className={styles.dayNames}>
            {DAYS.map(d => <span key={d} className={styles.dayName}>{d}</span>)}
          </div>

          {/* Day grid */}
          <div className={styles.dayGrid}>
            {Array.from({ length: offset }).map((_, i) => (
              <span key={`empty-${i}`} className={styles.dayEmpty} />
            ))}
            {Array.from({ length: days }).map((_, i) => {
              const d = i + 1;
              const isSelected = selectedDay === d && parsed?.month === viewMonth && parsed?.year === viewYear;
              const isToday = d === now.getDate() && viewMonth === now.getMonth() && viewYear === now.getFullYear();
              return (
                <button
                  key={d}
                  className={`${styles.day} ${isSelected ? styles.daySelected : ''} ${isToday && !isSelected ? styles.dayToday : ''}`}
                  onClick={() => handleDayClick(d)}
                >
                  {d}
                </button>
              );
            })}
          </div>

          {/* Time */}
          <div className={styles.timeRow}>
            <span className={styles.timeLabel}>Hora</span>
            <input
              type="number"
              className={styles.timeInput}
              min={0} max={23}
              value={pad(hour)}
              onChange={e => handleTimeChange(Math.min(23, Math.max(0, +e.target.value || 0)), minute)}
            />
            <span className={styles.timeSep}>:</span>
            <input
              type="number"
              className={styles.timeInput}
              min={0} max={59}
              value={pad(minute)}
              onChange={e => handleTimeChange(hour, Math.min(59, Math.max(0, +e.target.value || 0)))}
            />
          </div>

          {/* Actions */}
          <div className={styles.actions}>
            <button className={styles.clearBtn} onClick={handleClear}>Limpiar</button>
          </div>
        </div>
      )}
    </div>
  );
}
