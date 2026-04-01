import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Check, Trash2, Clock, Bell, BellOff, History, Search, MoreVertical, ChevronUp, ChevronsUp, CircleMinus } from 'lucide-react';
import DateTimePicker from '../Pulse/DateTimePicker';
import { getToken } from '../../api/client';
import styles from './TasksWidget.module.css';

const API = '/api/tasks';
function auth() { return { Authorization: `Bearer ${getToken()}` }; }

const TAGS = ['trabajo', 'personal', 'dev', 'boda', 'formación'];
const PRIORITIES = [
  { id: 'baja', label: 'Baja', color: '#F5C518', icon: ChevronUp },
  { id: 'media', label: 'Media', color: '#FFA94D', icon: ChevronsUp },
  { id: 'alta', label: 'Alta', color: '#ff6b6b', icon: CircleMinus },
];
const TAG_COLORS = {
  trabajo: '#F5C518',
  personal: '#845EF7',
  dev: '#71FEC3',
  boda: '#FF6B9D',
  formación: '#8AB502',
};

function timeLeft(dueAt) {
  if (!dueAt) return null;
  const diff = new Date(dueAt) - new Date();
  if (diff < 0) return 'vencida';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatDateForPicker(iso) {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDue(dueAt) {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const day = d.getDate();
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const month = months[d.getMonth()];
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${h}:${m}`;
}

export default function TasksWidget() {
  const [tasks, setTasks] = useState([]);
  const [newText, setNewText] = useState('');
  const [newTags, setNewTags] = useState([]);
  const [newDue, setNewDue] = useState('');
  const [newNotify, setNewNotify] = useState(false);
  const [newPriority, setNewPriority] = useState('baja');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filterTags, setFilterTags] = useState([]);
  const [menuId, setMenuId] = useState(null);
  const [historyMenuId, setHistoryMenuId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyTasks, setHistoryTasks] = useState([]);
  const [historyTags, setHistoryTags] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(API, { headers: auth() });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!menuId && !historyMenuId) return;
    const handler = () => { setMenuId(null); setHistoryMenuId(null); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuId, historyMenuId]);

  const addTask = async () => {
    if (!newText.trim()) return;
    const body = { text: newText.trim(), tag: newTags.length ? newTags.join(',') : null };
    if (newDue) {
      const m = newDue.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})$/);
      if (m) {
        body.due_at = new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]).toISOString();
      } else {
        body.due_at = new Date(newDue).toISOString();
      }
    }
    body.notified = newNotify ? 0 : 1;
    body.priority = newPriority;
    try {
      await fetch(API, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setNewText('');
      setNewTags([]);
      setNewDue('');
      setNewNotify(false);
      setShowForm(false);
      load();
    } catch {}
  };

  const toggleDone = async (task) => {
    try {
      const body = { done: !task.done };
      if (!task.done) body.notified = 1;
      await fetch(`${API}/${task.id}`, {
        method: 'PATCH',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      load();
    } catch {}
  };

  const toggleNotify = async (task) => {
    try {
      await fetch(`${API}/${task.id}`, {
        method: 'PATCH',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ notified: task.notified ? 0 : 1 }),
      });
      load();
    } catch {}
  };

  const deleteTask = async (id) => {
    try {
      await fetch(`${API}/${id}`, { method: 'DELETE', headers: auth() });
      load();
    } catch {}
  };

  const openHistory = async () => {
    setShowHistory(true);
    try {
      const res = await fetch(`${API}?done=1`, { headers: auth() });
      if (res.ok) {
        const data = await res.json();
        setHistoryTasks(data.tasks || []);
      }
    } catch {}
  };

  const filteredHistory = historyTasks.filter(t => {
    if (historyTags.length > 0 && !(t.tag && historyTags.some(f => t.tag.split(',').includes(f)))) return false;
    if (historySearch && !t.text.toLowerCase().includes(historySearch.toLowerCase())) return false;
    if (historyFrom) {
      const m = historyFrom.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
      if (m) {
        const from = new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]);
        if (new Date(t.completed_at) < from) return false;
      }
    }
    if (historyTo) {
      const m = historyTo.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
      if (m) {
        const to = new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]);
        if (new Date(t.completed_at) > to) return false;
      }
    }
    return true;
  });

  const closeHistory = () => {
    setShowHistory(false);
    setHistoryTags([]);
    setHistorySearch('');
    setHistoryFrom('');
    setHistoryTo('');
  };

  const editTask = (task) => {
    setNewText(task.text);
    setNewTags(task.tag ? task.tag.split(',') : []);
    setNewDue(task.due_at ? formatDateForPicker(task.due_at) : '');
    setNewNotify(!task.notified);
    setNewPriority(task.priority || 'baja');
    setEditingId(task.id);
    setShowForm(true);
    setMenuId(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const cloneTask = (task, fromHistory = false) => {
    setNewText(task.text);
    setNewTags(task.tag ? task.tag.split(',') : []);
    setNewDue(task.due_at ? formatDateForPicker(task.due_at) : '');
    setNewNotify(false);
    setNewPriority(task.priority || 'baja');
    setEditingId(null);
    setShowForm(true);
    setMenuId(null);
    setHistoryMenuId(null);
    if (fromHistory) closeHistory();
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const saveEdit = async () => {
    if (!newText.trim() || !editingId) return;
    const body = { text: newText.trim(), tag: newTags.length ? newTags.join(',') : null };
    if (newDue) {
      const m = newDue.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})$/);
      if (m) body.due_at = new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]).toISOString();
      else body.due_at = new Date(newDue).toISOString();
    } else {
      body.due_at = null;
    }
    body.notified = newNotify ? 0 : 1;
    body.priority = newPriority;
    try {
      await fetch(`${API}/${editingId}`, {
        method: 'PATCH',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      resetForm();
      load();
    } catch {}
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setNewText('');
    setNewTags([]);
    setNewDue('');
    setNewNotify(false);
    setNewPriority('baja');
  };

  const PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 };
  const matchesFilter = (t) => filterTags.length === 0 || (t.tag && filterTags.some(f => t.tag.split(',').includes(f)));
  const active = tasks.filter(t => !t.done && matchesFilter(t)).sort((a, b) => (PRIORITY_ORDER[a.priority || 'baja'] ?? 2) - (PRIORITY_ORDER[b.priority || 'baja'] ?? 2));

  return (
    <div className={styles.widget}>
      <div className={styles.header}>
        <h3 className={styles.title}>Tareas</h3>
        <span className={styles.count}>{active.length}</span>
        <button className={styles.historyBtn} onClick={openHistory} title="Historial de completadas">
          <History size={13} />
        </button>
        <div className={styles.filters}>
          {TAGS.map(tag => (
            <button
              key={tag}
              className={`${styles.filterBtn} ${filterTags.includes(tag) ? styles.filterBtnActive : ''}`}
              style={{ '--tag-color': TAG_COLORS[tag] }}
              onClick={() => setFilterTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
            >
              {tag}
            </button>
          ))}
        </div>
        <button className={styles.addBtn} onClick={() => { setShowForm(true); setTimeout(() => inputRef.current?.focus(), 50); }}>
          Nueva tarea
        </button>
      </div>

      {showForm && (
        <div className={styles.form}>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Nueva tarea..."
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') resetForm(); }}
          />
          <div className={styles.tagRow}>
            {TAGS.map(tag => (
              <button
                key={tag}
                className={`${styles.tagBtn} ${newTags.includes(tag) ? styles.tagBtnActive : ''}`}
                style={{ '--tag-color': TAG_COLORS[tag] }}
                onClick={() => setNewTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
              >
                {tag}
              </button>
            ))}
            <div className={styles.priorityGroup}>
              {PRIORITIES.map(p => (
                <button
                  key={p.id}
                  className={`${styles.priorityBtn} ${newPriority === p.id ? styles.priorityBtnActive : ''}`}
                  style={{ '--pri-color': p.color }}
                  onClick={() => setNewPriority(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className={styles.dateInline}>
              <DateTimePicker value={newDue} onChange={setNewDue} placeholder="Fecha..." />
            </div>
            <button
              className={`${styles.notifyBtn} ${newNotify ? styles.notifyBtnActive : ''}`}
              onClick={() => setNewNotify(!newNotify)}
              title={newNotify ? 'Notificación activada' : 'Activar notificación'}
            >
              {newNotify ? <Bell size={13} /> : <BellOff size={13} />}
            </button>
          </div>
          <div className={styles.formActions}>
            <button className={styles.cancelBtn} onClick={resetForm}>Cancelar</button>
            <button className={styles.saveBtn} onClick={editingId ? saveEdit : addTask} disabled={!newText.trim()}>
              {editingId ? 'Guardar cambios' : 'Añadir'}
            </button>
          </div>
        </div>
      )}

      <ul className={styles.list}>
        {active.map(task => {
          const tl = timeLeft(task.due_at);
          const overdue = tl === 'vencida';
          return (
            <li key={task.id} className={styles.item}>
              <button className={styles.check} onClick={() => toggleDone(task)}>
                <div className={styles.checkbox} />
              </button>
              {(() => {
                const pri = PRIORITIES.find(p => p.id === (task.priority || 'baja'));
                const Icon = pri.icon;
                return <Icon size={12} className={styles.priorityIcon} style={{ color: pri.color }} />;
              })()}
              <span className={styles.text}>{task.text}</span>
              {task.due_at && (
                <span className={`${styles.due} ${overdue ? styles.dueOverdue : ''}`}>
                  <Clock size={10} />
                  {formatDue(task.due_at)}
                </span>
              )}
              {task.tag && task.tag.split(',').map(t => (
                <span key={t} className={styles.tag} style={{ '--tag-color': TAG_COLORS[t] || '#fff' }}>
                  {t}
                </span>
              ))}
              <button className={styles.notifyToggle} onClick={() => toggleNotify(task)}>
                {!task.notified ? <Bell size={10} className={styles.bellOn} /> : <BellOff size={10} className={styles.bellOff} />}
              </button>
              <div className={styles.moreWrap}>
                <button className={styles.moreBtn} onClick={e => { e.stopPropagation(); setMenuId(menuId === task.id ? null : task.id); }}>
                  <MoreVertical size={12} />
                </button>
                {menuId === task.id && (
                  <div className={styles.moreMenu}>
                    <button className={styles.menuOption} onClick={() => editTask(task)}>Editar</button>
                    <button className={styles.menuOption} onClick={() => cloneTask(task)}>Clonar</button>
                    <button className={`${styles.menuOption} ${styles.menuDanger}`} onClick={() => { deleteTask(task.id); setMenuId(null); }}>Eliminar</button>
                  </div>
                )}
              </div>
            </li>
          );
        })}


      </ul>

      {showHistory && (
        <div className={styles.historyOverlay} onClick={closeHistory}>
          <div className={styles.historyModal} onClick={e => e.stopPropagation()}>
            <div className={styles.historyHeader}>
              <h3 className={styles.historyTitle}>Tareas completadas</h3>
              <span className={styles.historyCount}>{filteredHistory.length}</span>
            </div>

            <div className={styles.historyFilters}>
              <div className={styles.historySearchWrap}>
                <Search size={12} className={styles.historySearchIcon} />
                <input
                  className={styles.historySearchInput}
                  placeholder="Buscar..."
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                />
              </div>
              <div className={styles.historyTagRow}>
                {TAGS.map(tag => (
                  <button
                    key={tag}
                    className={`${styles.filterBtn} ${historyTags.includes(tag) ? styles.filterBtnActive : ''}`}
                    style={{ '--tag-color': TAG_COLORS[tag] }}
                    onClick={() => setHistoryTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <div className={styles.historyDateRow}>
                <DateTimePicker value={historyFrom} onChange={setHistoryFrom} placeholder="Desde..." />
                <DateTimePicker value={historyTo} onChange={setHistoryTo} placeholder="Hasta..." />
              </div>
            </div>

            <ul className={styles.historyList}>
              {filteredHistory.length === 0 ? (
                <li className={styles.historyEmpty}>Sin tareas completadas</li>
              ) : (
                filteredHistory.map(task => (
                  <li key={task.id} className={styles.historyItem}>
                    <button className={styles.check} onClick={async () => {
                      await fetch(`${API}/${task.id}`, {
                        method: 'PATCH',
                        headers: { ...auth(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ done: false, notified: 1 }),
                      });
                      setHistoryTasks(prev => prev.filter(t => t.id !== task.id));
                      load();
                    }}>
                      <div className={`${styles.checkbox} ${styles.checkboxDone}`}>
                        <Check size={10} />
                      </div>
                    </button>
                    <span className={styles.historyText}>{task.text}</span>
                    {task.tag && task.tag.split(',').map(t => (
                      <span key={t} className={styles.tag} style={{ '--tag-color': TAG_COLORS[t] || '#fff' }}>
                        {t}
                      </span>
                    ))}
                    {task.completed_at && (
                      <span className={styles.historyDate}>
                        {new Date(task.completed_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <div className={styles.moreWrap}>
                      <button className={styles.moreBtn} onClick={e => { e.stopPropagation(); setHistoryMenuId(historyMenuId === task.id ? null : task.id); }}>
                        <MoreVertical size={12} />
                      </button>
                      {historyMenuId === task.id && (
                        <div className={styles.moreMenu}>
                          <button className={styles.menuOption} onClick={() => cloneTask(task, true)}>Duplicar</button>
                        </div>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
