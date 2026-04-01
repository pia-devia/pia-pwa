import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useFiles } from '../../hooks/useFiles';
import FileTree from '../Layout/Sidebar/FileTree';
import SearchBar from '../Layout/Sidebar/SearchBar';
import styles from './Proyectos.module.css';

const AGENT_ID = 'projects';

export default function Proyectos() {
  const { tree, refresh } = useFiles(AGENT_ID);

  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigate  = useNavigate();
  const location  = useLocation();

  const currentPath = location.pathname.startsWith('/proyectos/file/')
    ? decodeURIComponent(location.pathname.slice('/proyectos/file/'.length))
    : null;

  const handleFileClick = (path) => {
    navigate(`/proyectos/file/${encodeURIComponent(path)}`);
    setSidebarOpen(false);
  };

  const toggleExpand = (path) =>
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));

  // Notifications — simple inline state
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const outletContext = {
    tree,
    refresh,
    basePath: '/proyectos',
    agentId: AGENT_ID,
    success: (m) => showToast(m, 'success'),
    info:    (m) => showToast(m, 'info'),
    error:   (m) => showToast(m, 'error'),
  };

  return (
    <div className={styles.wrapper}>
      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.msg}
        </div>
      )}

      {/* Mobile toggle */}
      <button
        className={styles.mobileToggle}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? '✕' : '📁'} Proyectos
      </button>

      {sidebarOpen && (
        <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`${styles.treeSidebar} ${sidebarOpen ? styles.treeOpen : ''}`}>
        <div className={styles.treeHeader}>
          <span className={styles.treeTitle}>Proyectos</span>
          <div className={styles.treeHeaderActions}>
            <button title="Actualizar" onClick={refresh} className={styles.treeHeaderBtn}>
              <i className="fa fa-refresh" />
            </button>
          </div>
        </div>
        <div className={styles.searchWrap}>
          <SearchBar value={search} onChange={setSearch} />
        </div>
        <nav className={styles.treeNav}>
          <FileTree
            items={tree || []}
            search={search}
            expanded={expanded}
            onToggle={toggleExpand}
            onFileClick={handleFileClick}
            currentPath={currentPath}
            agentId={AGENT_ID}
            onRefresh={refresh}
            onError={(m) => showToast(m, 'error')}
          />
        </nav>
      </aside>

      {/* Content */}
      <div className={styles.content}>
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}
