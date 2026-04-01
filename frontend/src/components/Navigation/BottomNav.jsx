import { NavLink } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, Activity, Brain } from 'lucide-react';
import styles from './BottomNav.module.css';

const ITEMS = [
  { to: '/panel', icon: LayoutDashboard, label: 'Panel' },
  { to: '/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/pulse', icon: Activity, label: 'Pulse' },
  { to: '/mente', icon: Brain, label: 'Mente' },
];

export default function BottomNav() {
  return (
    <nav className={styles.bottomNav}>
      {ITEMS.map(({ to, icon: Icon, label }) => (
        <NavLink key={to} to={to}
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}>
          <Icon size={18} strokeWidth={1.5} />
          <span className={styles.tabLabel}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
