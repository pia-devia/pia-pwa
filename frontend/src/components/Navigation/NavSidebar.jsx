import { NavLink } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, Activity, Brain, Lock, FolderOpen, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import styles from './NavSidebar.module.css';

const NAV_BASE = [
  { to: '/panel',     icon: LayoutDashboard, label: 'Panel' },
  { to: '/pulse',     icon: Activity,        label: 'Pulse' },
  { to: '/mente',     icon: Brain,           label: 'Mente' },
  { to: '/proyectos', icon: FolderOpen,      label: 'Proyectos' },
  { to: '/vault',     icon: Lock,            label: 'Vault' },
];

const CHAT_ITEM = { to: '/chat', icon: MessageSquare, label: 'Chat' };

export default function NavSidebar({ collapsed, onToggle, isConnected, showChat }) {
  const { logout } = useAuth();

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      {/* Logo */}
      <button className={styles.logoBtn} onClick={onToggle} aria-label="Toggle navigation">
        <span className={styles.logoContainer}>
          <img src="/pia-logo.png" alt="Pia" className={styles.logoImg} />
          <span className={`${styles.statusDot} ${isConnected ? styles.online : styles.offline}`} />
        </span>
        <span className={`${styles.logoName} ${styles.text}`}>ia</span>
        <span className={`${styles.statusTag} ${styles.text} ${isConnected ? styles.online : styles.offline}`}>
          {isConnected ? 'online' : 'offline'}
        </span>
      </button>

      {/* Nav */}
      <nav className={styles.nav}>
        {[...(showChat ? [CHAT_ITEM] : []), ...NAV_BASE].map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
            title={collapsed ? label : undefined}
          >
            <span className={styles.icon}>
              <Icon size={18} strokeWidth={1.5} />
            </span>
            <span className={styles.text}>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <button className={styles.logoutBtn} onClick={logout} title="Salir">
        <span className={styles.icon}>
          <LogOut size={18} strokeWidth={1.5} />
        </span>
        <span className={styles.text}>Salir</span>
      </button>
    </aside>
  );
}
