import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import FileTree from './FileTree';
import SearchBar from './SearchBar';
import styles from './Sidebar.module.css';

export default function Sidebar({ tree, isOpen, onClose, onLogout }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({ memory: true, 'memory/contexts': true });
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.pathname.startsWith('/file/')
    ? decodeURIComponent(location.pathname.slice(6))
    : null;

  const handleFileClick = (path) => {
    navigate(`/file/${encodeURIComponent(path)}`);
    onClose?.();
  };

  const toggleExpand = (path) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const handleDashboard = () => {
    navigate('/panel');
    onClose?.();
  };

  const handleNav = (path) => {
    navigate(path);
    onClose?.();
  };

  return (
    <>
      {isOpen && <div className={styles.overlay} onClick={onClose} />}
      <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
        <div className={styles.top}>
          <button className={styles.dashboardBtn} onClick={handleDashboard}>
            🏠 Panel
          </button>

          <SearchBar value={search} onChange={setSearch} />
        </div>
        
        <nav className={styles.nav}>
          <FileTree
            items={tree}
            search={search}
            expanded={expanded}
            onToggle={toggleExpand}
            onFileClick={handleFileClick}
            currentPath={currentPath}
          />
        </nav>
        
        <div className={styles.bottom}>
          <button className={styles.logoutBtn} onClick={onLogout}>
            🚪 Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  );
}
