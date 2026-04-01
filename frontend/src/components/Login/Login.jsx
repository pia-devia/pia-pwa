import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestOtp, verifyOtp, setToken } from '../../api/client';
import styles from './Login.module.css';

export default function Login() {
  const [phase, setPhase] = useState('idle');
  const [code, setCode] = useState('');
  const [shake, setShake] = useState(false);
  const navigate = useNavigate();

  const handleOutsideClick = () => {
    if (phase === 'input') {
      setPhase('shrinking');
      setCode('');
      setTimeout(() => setPhase('idle'), 350);
    }
  };

  const handleCardClick = async () => {
    if (phase === 'idle') {
      setPhase('expanding');
      await requestOtp().catch(() => {});
      setTimeout(() => setPhase('input'), 600);
    }
  };

  const handleChange = async (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(val);

    if (val.length === 6) {
      try {
        const { token } = await verifyOtp(val);
        setToken(token);
        navigate('/');
      } catch {
        setShake(true);
        setTimeout(() => {
          setShake(false);
          setCode('');
        }, 700);
      }
    }
  };

  return (
    <div className={styles.container} onMouseDown={handleOutsideClick}>
      <div
        className={`${styles.card} ${(phase === 'expanding' || phase === 'input') ? styles.cardExpanded : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleCardClick}
      >

        {phase === 'idle' && (
          <div className={styles.logoWrap}>
            <img src="/pia-logo.png" alt="Pia" className={`${styles.logoImg} ${styles.logoK}`} />
            <svg
              className={styles.logoPower}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#F5C518"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          </div>
        )}

        {phase === 'input' && (
          <div className={styles.inputZone}>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              value={code}
              onChange={handleChange}
              placeholder="· · · · · ·"
              className={`${styles.codeInput} ${shake ? styles.inputError : ''}`}
            />
          </div>
        )}

      </div>
    </div>
  );
}
