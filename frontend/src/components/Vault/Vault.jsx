import { useState, useEffect, useCallback, useContext } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Pencil, Check, X, KeyRound, ShieldCheck } from 'lucide-react';
import { getToken } from '../../api/client';
import { AgentContext } from '../../context/AgentContext';
import styles from './Vault.module.css';

const API = '/api/vault';

async function vaultFetch(endpoint, options = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error desconocido');
  return data;
}

// PIN is kept in sessionStorage per mode so navigating away and back doesn't require re-entering
function sessionKey(mode) { return `vault-pin-session-${mode}`; }

export default function Vault() {
  const { agentName } = useContext(AgentContext);
  const mode = agentName; // 'CORE' | 'PO'
  const SK = sessionKey(mode);

  const [status, setStatus] = useState('loading'); // loading | setup | locked | unlocked
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [entries, setEntries] = useState([]);
  const [revealed, setRevealed] = useState({}); // { key: realValue }
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [pinVisible, setPinVisible] = useState(false);
  const [lockHovered, setLockHovered] = useState(false);
  const [pinShake, setPinShake] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Re-check vault when mode changes
  useEffect(() => {
    setStatus('loading');
    setEntries([]);
    setRevealed({});
    setEditingKey(null);
    setPin('');

    (async () => {
      try {
        const { pinConfigured } = await vaultFetch(`/status?mode=${mode}`);
        if (!pinConfigured) {
          setStatus('setup');
        } else {
          const sessionPin = sessionStorage.getItem(SK);
          if (sessionPin) {
            const { valid } = await vaultFetch('/verify-pin', {
              method: 'POST',
              body: JSON.stringify({ pin: sessionPin, mode }),
            });
            if (valid) {
              setPin(sessionPin);
              setStatus('unlocked');
              loadEntries();
              return;
            } else {
              sessionStorage.removeItem(SK);
            }
          }
          setStatus('locked');
        }
      } catch {
        setStatus('locked');
      }
    })();

    return () => { sessionStorage.removeItem(SK); };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadEntries = useCallback(async () => {
    try {
      const { entries } = await vaultFetch(`/entries?mode=${mode}`);
      setEntries(entries || []);
    } catch {}
  }, [mode]);

  const handleSetupPin = async () => {
    if (pin.length < 4) return setPinError('Mínimo 4 dígitos');
    setLoading(true);
    setPinError('');
    try {
      await vaultFetch('/setup-pin', {
        method: 'POST',
        body: JSON.stringify({ pin, mode }),
      });
      sessionStorage.setItem(SK, pin);
      setStatus('unlocked');
      loadEntries();
    } catch (err) {
      setPinError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    setLoading(true);
    setPinError('');
    try {
      const { valid } = await vaultFetch('/verify-pin', {
        method: 'POST',
        body: JSON.stringify({ pin, mode }),
      });
      if (valid) {
        sessionStorage.setItem(SK, pin);
        setStatus('unlocked');
        loadEntries();
      } else {
        setPinError('PIN incorrecto');
      }
    } catch (err) {
      setPinError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLock = () => {
    sessionStorage.removeItem(SK);
    setPin('');
    setRevealed({});
    setEditingKey(null);
    setStatus('locked');
  };

  const handleReveal = async (key) => {
    if (revealed[key]) {
      setRevealed(prev => { const n = { ...prev }; delete n[key]; return n; });
      return;
    }
    try {
      const sessionPin = sessionStorage.getItem(SK);
      const { value } = await vaultFetch('/reveal', {
        method: 'POST',
        body: JSON.stringify({ key, pin: sessionPin, mode }),
      });
      setRevealed(prev => ({ ...prev, [key]: value }));
    } catch (err) {
      console.error('Reveal error:', err);
    }
  };

  const handleEditStart = async (key) => {
    const sessionPin = sessionStorage.getItem(SK);
    try {
      const { value } = await vaultFetch('/reveal', {
        method: 'POST',
        body: JSON.stringify({ key, pin: sessionPin, mode }),
      });
      setEditValue(value);
      setEditingKey(key);
      setSaveError('');
    } catch {}
  };

  const handleEditSave = async (key) => {
    setSaveError('');
    const sessionPin = sessionStorage.getItem(SK);
    try {
      await vaultFetch(`/entries/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        body: JSON.stringify({ value: editValue, pin: sessionPin, mode }),
      });
      setEditingKey(null);
      setRevealed(prev => { const n = { ...prev }; delete n[key]; return n; });
      loadEntries();
    } catch (err) {
      setSaveError(err.message);
    }
  };

  // ── Screens ────────────────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div className={styles.centered}>
        <div className={styles.spinner} />
      </div>
    );
  }

  if (status === 'setup') {
    return (
      <div className={styles.pinScreen}>
        <div className={styles.pinCard}>
          <ShieldCheck size={32} className={styles.pinIcon} />
          <h2 className={styles.pinTitle}>Configurar PIN del Vault</h2>
          <p className={styles.pinHint}>
            Este PIN protege la visualización y edición de tus credenciales. Mínimo 4 dígitos.
          </p>
          <input
            className={styles.pinInput}
            type="password"
            inputMode="numeric"
            placeholder="PIN (min. 4 dígitos)"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetupPin()}
            autoFocus
          />
          {pinError && <p className={styles.pinError}>{pinError}</p>}
          <button className={styles.pinBtn} onClick={handleSetupPin} disabled={loading}>
            {loading ? 'Guardando...' : 'Establecer PIN'}
          </button>
        </div>
      </div>
    );
  }

  const handlePinChange = async (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 8);
    setPin(value);
    setPinShake(false);

    if (value.length >= 4) {
      try {
        const { valid } = await vaultFetch('/verify-pin', {
          method: 'POST',
          body: JSON.stringify({ pin: value, mode }),
        });
        if (valid) {
          sessionStorage.setItem(SK, value);
          setStatus('unlocked');
          loadEntries();
        } else {
          setPinShake(true);
          setTimeout(() => { setPin(''); setPinShake(false); }, 700);
        }
      } catch {
        setPinShake(true);
        setTimeout(() => { setPin(''); setPinShake(false); }, 700);
      }
    }
  };

  const handleVaultCardClick = () => {
    if (!pinVisible) {
      setPinVisible(true);
    }
  };

  const handleVaultOutsideClick = () => {
    if (pinVisible) {
      setPinVisible(false);
      setPin('');
      setLockHovered(false);
    }
  };

  if (status === 'locked') {
    return (
      <div className={styles.pinScreen} onMouseDown={handleVaultOutsideClick}>
        <div
          className={`${styles.vaultCard} ${pinVisible ? styles.vaultCardExpanded : ''}`}
          onMouseDown={e => e.stopPropagation()}
          onClick={handleVaultCardClick}
          onMouseEnter={() => !pinVisible && setLockHovered(true)}
          onMouseLeave={() => !pinVisible && setLockHovered(false)}
        >
          {!pinVisible && (
            <div className={styles.lockWrap}>
              <Lock size={48} strokeWidth={1.2} className={`${styles.lockClosed} ${lockHovered ? styles.lockHide : ''}`} />
              <LockOpen size={48} strokeWidth={1.2} className={`${styles.lockOpen} ${lockHovered ? styles.lockShow : ''}`} />
            </div>
          )}

          {pinVisible && (
            <div className={styles.pinInputZone}>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                autoFocus
                value={pin}
                onChange={handlePinChange}
                placeholder="· · · ·"
                className={`${styles.vaultPinInput} ${pinShake ? styles.inputError : ''}`}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Unlocked — show entries ────────────────────────────────────────────────

  // Group entries by sections (comments that precede entries)
  const sections = [];
  let currentSection = { label: null, entries: [] };

  for (const item of entries) {
    if (item.type === 'comment') {
      if (currentSection.entries.length > 0 || currentSection.label) {
        sections.push(currentSection);
      }
      currentSection = { label: item.text, entries: [] };
    } else if (item.type === 'entry') {
      currentSection.entries.push(item);
    }
    // blanks are ignored in display
  }
  if (currentSection.entries.length > 0 || currentSection.label) {
    sections.push(currentSection);
  }

  return (
    <div className={styles.vault}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <KeyRound size={18} />
          <span>Vault de secretos</span>
        </div>
        <button className={styles.lockBtn} onClick={handleLock} title="Bloquear vault">
          <Lock size={16} />
          Bloquear
        </button>
      </div>

      <div className={styles.sections}>
        {sections.map((section, si) => (
          section.entries.length > 0 && (
            <div key={si} className={styles.section}>
              {section.label && (
                <p className={styles.sectionLabel}>{section.label}</p>
              )}
              <div className={styles.entriesList}>
                {section.entries.map((entry) => (
                  <div key={entry.key} className={styles.entryRow}>
                    <span className={styles.entryKey}>{entry.key}</span>

                    {editingKey === entry.key ? (
                      <div className={styles.editRow}>
                        <input
                          className={styles.editInput}
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          autoFocus
                        />
                        {saveError && <span className={styles.saveError}>{saveError}</span>}
                        <button
                          className={styles.iconBtn}
                          onClick={() => handleEditSave(entry.key)}
                          title="Guardar"
                        >
                          <Check size={15} />
                        </button>
                        <button
                          className={styles.iconBtn}
                          onClick={() => setEditingKey(null)}
                          title="Cancelar"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ) : (
                      <div className={styles.valueRow}>
                        <span className={`${styles.entryValue} ${revealed[entry.key] ? styles.revealed : ''}`}>
                          {revealed[entry.key] || entry.masked}
                        </span>
                        <button
                          className={styles.iconBtn}
                          onClick={() => handleReveal(entry.key)}
                          title={revealed[entry.key] ? 'Ocultar' : 'Mostrar'}
                        >
                          {revealed[entry.key] ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                        <button
                          className={styles.iconBtn}
                          onClick={() => handleEditStart(entry.key)}
                          title="Editar"
                        >
                          <Pencil size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}
