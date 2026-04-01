import { useState, useEffect, useCallback, useContext } from 'react';
import { getEvents, createEvent, updateEvent, deleteEvent } from '../../api/client';
import { AgentContext } from '../../context/AgentContext';
import EventModal from './EventModal';
import styles from './Events.module.css';

const STATUS_STYLES = {
  FINALIZADO:  { bg: '#4ade8022', color: 'var(--success)', border: '#4ade8044' },
  PROCESANDO:  { bg: '#8AAD1822', color: '#8AAD18',        border: '#8AAD1844' },
  PAUSADO:     { bg: '#6b728022', color: '#9ca3af',        border: '#6b728044' },
  ERRORES:     { bg: '#f8717122', color: 'var(--danger)',   border: '#f8717144' },
};

const STATUS_ICONS = {
  FINALIZADO: '✅',
  PROCESANDO: '⚙️',
  PAUSADO:    '⏸️',
  ERRORES:    '❌',
};

function timeAgo(str) {
  if (!str) return null;
  const diff = Date.now() - new Date(str).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

export default function EventsPanel() {
  const { agentName } = useContext(AgentContext);
  const mode = agentName; // 'CORE' | 'PO'

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // null | { event? }

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await getEvents(mode);
      setEvents(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    if (modal?.event) {
      const updated = await updateEvent(modal.event.id, form);
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } else {
      const created = await createEvent(form, mode);
      setEvents((prev) => [created, ...prev]);
    }
    setModal(null);
  };

  const handleDelete = async (id) => {
    await deleteEvent(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setModal(null);
  };

  if (loading) return <div className={styles.centered}><div className={styles.spinner} /><p>Cargando...</p></div>;
  if (error) return <div className={styles.centered}><p className={styles.errorText}>⚠️ {error}</p><button className={styles.retryBtn} onClick={load}>Reintentar</button></div>;

  return (
    <div className={styles.listWrapper}>
      {/* Header */}
      <div className={styles.listHeader}>
        <h1 className={styles.listTitle}>⚡ Pulsos</h1>
        <button className={styles.newBtn} onClick={() => setModal({ event: null })}>
          + Nuevo
        </button>
      </div>

      {/* List */}
      {events.length === 0 ? (
        <div className={styles.empty}>
          <p>No hay pulsos registrados.</p>
          <button className={styles.newBtn} onClick={() => setModal({ event: null })}>
            + Crear primer pulso
          </button>
        </div>
      ) : (
        <ul className={styles.list}>
          {events.map((event) => {
            const ss = STATUS_STYLES[event.status] || STATUS_STYLES.PAUSADO;
            const icon = STATUS_ICONS[event.status] || '⏸️';
            const ago = timeAgo(event.last_run);
            return (
              <li
                key={event.id}
                className={styles.listItem}
                onClick={() => setModal({ event })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setModal({ event })}
              >
                <span className={styles.statusIcon}>{icon}</span>
                <div className={styles.itemMain}>
                  <span className={styles.itemTitle}>{event.name}</span>
                  <div className={styles.itemMeta}>
                    {event.schedule && <span className={styles.metaChip}>{event.schedule}</span>}
                    {ago && <span className={styles.metaTime}>{ago}</span>}
                  </div>
                </div>
                <span
                  className={styles.statusChip}
                  style={{ background: ss.bg, color: ss.color, borderColor: ss.border }}
                >
                  {event.status}
                </span>
                <span className={styles.chevron}>›</span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal */}
      {modal !== null && (
        <EventModal
          event={modal.event}
          onSave={handleSave}
          onClose={() => setModal(null)}
          onDelete={modal.event ? () => handleDelete(modal.event.id) : null}
        />
      )}
    </div>
  );
}
