import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Heart, Plus, Trash2, Bell, BellOff } from 'lucide-react';
import { getToken } from '../../api/client';
import styles from './CalendarWidget.module.css';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DAYS_HEADER = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];
const WEDDING = new Date(2026, 5, 26);
const EVENT_COLORS = ['#F5C518', '#71FEC3', '#FF6B9D', '#845EF7', '#FFA94D', '#FF6B6B'];

function auth() { return { Authorization: `Bearer ${getToken()}` }; }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function firstDay(y, m) { const d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; }
function daysUntilWedding() { const n = new Date(); n.setHours(0,0,0,0); return Math.max(0, Math.ceil((WEDDING - n) / 86400000)); }
function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }

export default function CalendarWidget() {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(now.getDate());
  const [rangeEnd, setRangeEnd] = useState(null);
  const [dayEvents, setDayEvents] = useState([]);
  const [monthEvents, setMonthEvents] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newColor, setNewColor] = useState('');
  const [newNotify, setNewNotify] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const numDays = daysInMonth(viewYear, viewMonth);
  const offset = firstDay(viewYear, viewMonth);
  const today = now.getDate();
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();
  const isWeddingMonth = viewYear === 2026 && viewMonth === 5;
  const daysLeft = daysUntilWedding();
  const monthKey = `${viewYear}-${pad(viewMonth + 1)}`;

  const rangeStart = selectedDay && rangeEnd ? Math.min(selectedDay, rangeEnd) : null;
  const rangeEndDay = selectedDay && rangeEnd ? Math.max(selectedDay, rangeEnd) : null;
  const isRange = rangeStart !== null && rangeStart !== rangeEndDay;
  const selectedDate = selectedDay ? dateStr(viewYear, viewMonth, selectedDay) : null;

  const loadMonthEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/events?month=${monthKey}`, { headers: auth() });
      if (res.ok) { const data = await res.json(); setMonthEvents(data.events || []); }
    } catch {}
  }, [monthKey]);

  const loadUpcoming = useCallback(async () => {
    try {
      const res = await fetch('/api/events/upcoming?limit=5', { headers: auth() });
      if (res.ok) { const data = await res.json(); setUpcomingEvents(data.events || []); }
    } catch {}
  }, []);

  useEffect(() => { loadMonthEvents(); loadUpcoming(); }, [loadMonthEvents, loadUpcoming]);

  const loadDayEvents = useCallback(async () => {
    if (!selectedDate) return;
    try {
      const res = await fetch(`/api/events?date=${selectedDate}`, { headers: auth() });
      if (res.ok) { const data = await res.json(); setDayEvents(data.events || []); }
    } catch {}
  }, [selectedDate]);

  useEffect(() => { if (selectedDay) loadDayEvents(); }, [selectedDay, loadDayEvents]);

  const addEvent = async () => {
    if (!newTitle.trim()) return;
    const body = { title: newTitle.trim(), time: newTime || null, color: newColor || null, notify: newNotify };
    if (isRange) {
      body.date = dateStr(viewYear, viewMonth, rangeStart);
      body.end_date = dateStr(viewYear, viewMonth, rangeEndDay);
    } else {
      body.date = selectedDate;
    }
    await fetch('/api/events', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setNewTitle(''); setNewTime(''); setNewColor(''); setNewNotify(false);
    if (isRange) setRangeEnd(null);
    loadDayEvents(); loadMonthEvents(); loadUpcoming();
  };

  const deleteEvent = async (id) => {
    await fetch(`/api/events/${id}`, { method: 'DELETE', headers: auth() });
    loadDayEvents(); loadMonthEvents(); loadUpcoming();
  };

  const toggleNotify = async (event) => {
    await fetch(`/api/events/${event.id}`, {
      method: 'PATCH', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify: event.notify ? 0 : 1 }),
    });
    loadDayEvents();
  };

  const prev = () => { setRangeEnd(null); if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); setSelectedDay(1); } else { setViewMonth(m => m - 1); setSelectedDay(1); } };
  const next = () => { setRangeEnd(null); if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); setSelectedDay(1); } else { setViewMonth(m => m + 1); setSelectedDay(1); } };

  const handleDayClick = (d, e) => {
    if (e.shiftKey && selectedDay && selectedDay !== d) {
      setRangeEnd(d);
      setShowPanel(true);
    } else {
      if (d === selectedDay && showPanel) {
        setShowPanel(false);
      } else {
        setSelectedDay(d);
        setRangeEnd(null);
        setShowPanel(true);
      }
    }
  };

  // Range event map
  const rangeMap = {};
  monthEvents.filter(e => e.end_date).forEach(e => {
    for (let d = 1; d <= numDays; d++) {
      const dk = dateStr(viewYear, viewMonth, d);
      if (dk >= e.date && dk <= e.end_date) {
        if (!rangeMap[d]) rangeMap[d] = [];
        rangeMap[d].push(e);
      }
    }
  });

  const singleMap = {};
  monthEvents.filter(e => !e.end_date).forEach(e => {
    if (e.date.startsWith(monthKey)) {
      const d = parseInt(e.date.substring(8), 10);
      if (!singleMap[d]) singleMap[d] = [];
      singleMap[d].push(e);
    }
  });

  const formatRange = (e) => {
    const sd = parseInt(e.date.substring(8), 10);
    const sm = parseInt(e.date.substring(5, 7), 10) - 1;
    const ed = parseInt(e.end_date.substring(8), 10);
    const em = parseInt(e.end_date.substring(5, 7), 10) - 1;
    return `${sd} ${MONTHS_SHORT[sm]} → ${ed} ${MONTHS_SHORT[em]}`;
  };

  return (
    <div className={styles.widget}>
      <div className={styles.split}>
        {/* Left: Calendar + Upcoming */}
        <div className={styles.calendarSide}>
          <div className={styles.header}>
            <button className={styles.navBtn} onClick={prev}><ChevronLeft size={14} /></button>
            <span className={styles.monthLabel}>{MONTHS[viewMonth]} {viewYear}</span>
            <button className={styles.navBtn} onClick={next}><ChevronRight size={14} /></button>
          </div>
          <div className={styles.dayNames}>
            {DAYS_HEADER.map(d => <span key={d} className={styles.dayName}>{d}</span>)}
          </div>
          <div className={styles.dayGrid}>
            {Array.from({ length: offset }).map((_, i) => <span key={`e-${i}`} className={styles.dayEmpty} />)}
            {Array.from({ length: numDays }).map((_, i) => {
              const d = i + 1;
              const isToday = isCurrentMonth && d === today;
              const isWedding = isWeddingMonth && d === 26;
              const isSelected = d === selectedDay && !rangeEnd;
              const inSelRange = isRange && d >= rangeStart && d <= rangeEndDay;
              const hasRangeEvt = !!rangeMap[d];
              const hasSingleEvt = !!singleMap[d];
              const rangeColor = rangeMap[d]?.[0]?.color;

              return (
                <span key={d}
                  className={`${styles.day} ${isToday ? styles.dayToday : ''} ${isWedding ? styles.dayWedding : ''} ${isSelected ? styles.daySelected : ''} ${inSelRange ? styles.dayInRange : ''}`}
                  style={{
                    ...(isSelected && !isToday ? { background: 'rgba(245, 197, 24,0.2)', color: 'var(--accent)' } : {}),
                    ...(hasRangeEvt && !isToday && !isSelected ? { borderBottom: `2px solid ${rangeColor || 'var(--accent)'}` } : {}),
                  }}
                  onClick={(e) => handleDayClick(d, e)}
                >
                  {d}
                  {isWedding && <Heart size={8} className={styles.heartIcon} />}
                  {hasSingleEvt && <span className={styles.eventDot} />}
                </span>
              );
            })}
            {Array.from({ length: 42 - offset - numDays }).map((_, i) => (
              <span key={`t-${i}`} className={styles.dayEmpty} />
            ))}
          </div>

          {/* Upcoming events */}
          <div className={styles.upcoming}>
            <div className={styles.upcomingTitle}>Próximos eventos</div>
            {upcomingEvents.length === 0 ? (
              <div className={styles.upcomingEmpty}>Sin eventos planificados</div>
            ) : upcomingEvents.map(event => {
                const d = parseInt(event.date.substring(8), 10);
                const m = parseInt(event.date.substring(5, 7), 10) - 1;
                return (
                  <div key={event.id} className={styles.upcomingItem}>
                    <span className={styles.upcomingColor} style={{ background: event.color || 'var(--accent)' }} />
                    <span className={styles.upcomingDate}>{d} {MONTHS_SHORT[m]}</span>
                    {event.time && <span className={styles.upcomingTime}>{event.time.substring(0, 5)}</span>}
                    <span className={styles.upcomingName}>{event.title}</span>
                    {event.end_date && <span className={styles.upcomingRange}>→ {parseInt(event.end_date.substring(8), 10)} {MONTHS_SHORT[parseInt(event.end_date.substring(5, 7), 10) - 1]}</span>}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Right: Day events panel */}
        <div className={`${styles.dayPanel} ${showPanel ? styles.dayPanelOpen : ''}`}>
          <div className={styles.dayPanelHeader}>
            <span className={styles.dayPanelTitle}>
              {isRange ? `${rangeStart} → ${rangeEndDay} ${MONTHS_SHORT[viewMonth]}` : `${selectedDay} ${MONTHS_SHORT[viewMonth]}`}
            </span>
          </div>

          <div className={styles.eventForm}>
            <div className={styles.sectionLabel}>Nuevo evento</div>
            <div className={styles.eventInputRow}>
              {!isRange && (
                <input type="text" className={styles.timeField} placeholder="HH:MM" maxLength={5}
                  value={newTime} onChange={e => setNewTime(e.target.value)} />
              )}
              <input className={styles.dayInput} placeholder={isRange ? 'Nombre del evento...' : 'Nuevo evento...'}
                value={newTitle} onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addEvent(); }} />
            </div>
            <div className={styles.eventFormRow}>
              <div className={styles.eventColors}>
                {EVENT_COLORS.map(c => (
                  <button key={c} className={`${styles.eventColorDot} ${newColor === c ? styles.eventColorDotActive : ''}`}
                    style={{ background: c }} onClick={() => setNewColor(newColor === c ? '' : c)} />
                ))}
              </div>
              <button className={`${styles.notifyBtn} ${newNotify ? styles.notifyBtnActive : ''}`}
                onClick={() => setNewNotify(!newNotify)}>
                {newNotify ? <Bell size={12} /> : <BellOff size={12} />}
              </button>
              <button className={styles.dayAddBtn} onClick={addEvent} disabled={!newTitle.trim()}><Plus size={12} /></button>
            </div>
          </div>

          <ul className={styles.dayList}>
            {dayEvents.length === 0 && !isRange ? (
              <li className={styles.dayEmpty2}>Sin eventos</li>
            ) : (
              dayEvents.map(event => (
                <li key={event.id} className={styles.eventItem}>
                  <span className={styles.eventColor} style={{ background: event.color || 'var(--accent)' }} />
                  {event.end_date ? (
                    <span className={styles.eventRange}>{formatRange(event)}</span>
                  ) : (
                    event.time && <span className={styles.eventTime}>{event.time.substring(0, 5)}</span>
                  )}
                  <span className={styles.eventTitle}>{event.title}</span>
                  <button className={styles.notifyToggle} onClick={() => toggleNotify(event)}>
                    {event.notify ? <Bell size={10} className={styles.eventBellOn} /> : <BellOff size={10} className={styles.eventBellOff} />}
                  </button>
                  <button className={styles.eventDeleteBtn} onClick={() => deleteEvent(event.id)}><Trash2 size={10} /></button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

    </div>
  );
}
