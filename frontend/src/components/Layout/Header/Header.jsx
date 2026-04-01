import { useContext } from 'react';
import { AgentContext } from '../../../context/AgentContext';
import styles from './Header.module.css';
import LiveBadge from './LiveBadge';
import { useAuth } from '../../../hooks/useAuth';

export default function Header({ isConnected, onLogout }) {
  const { logout } = useAuth();
  const handleLogout = onLogout || logout;

  return (
    <header className={styles.header}>
      <div className={styles.titleSection}>
        <span className={styles.logoK}>K</span>
        <span className={styles.logoText}>ai</span>
        <span className={styles.logoOs}>OS</span>
      </div>

      <div className={styles.actions}>
        <LiveBadge isConnected={isConnected} />
        <button
          className={styles.logoutBtn}
          onClick={handleLogout}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          Salir
        </button>
      </div>
    </header>
  );
}
