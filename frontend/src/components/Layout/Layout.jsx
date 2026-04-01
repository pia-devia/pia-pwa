import { useState, useCallback, useContext, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AgentContext } from '../../context/AgentContext';
import Header from './Header/Header';
import NavSidebar from '../Navigation/NavSidebar';
import { useFiles } from '../../hooks/useFiles';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useToast } from '../../hooks/useToast';
import { logout } from '../../api/client';
import FloatingChat from '../FloatingChat/FloatingChat';
import styles from './Layout.module.css';

// Responsive breakpoints for chat mode
// 0-1599: chat in sidebar nav, no bubble
// 1600-2799: bubble + compact mode on panel
// 2800+: bubble, no compact
function useChatMode() {
  const getMode = () => {
    const w = window.innerWidth;
    if (w < 1600) return 'nav';       // chat as nav item
    if (w < 2800) return 'compact';   // bubble + compact panel
    return 'full';                     // bubble, no compact
  };
  const [mode, setMode] = useState(getMode);

  useEffect(() => {
    const onResize = () => setMode(getMode());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return mode; // 'nav' | 'compact' | 'full'
}

export default function Layout() {
  const [navCollapsed, setNavCollapsed] = useState(true);
  const [chatSidebar, setChatSidebar] = useState(false);
  const { agentId, agentName } = useContext(AgentContext);
  const { tree, files, refresh } = useFiles(agentId);
  const { toasts, success, info, error } = useToast();
  
  const chatMode = useChatMode();
  const showBubble = chatMode !== 'nav';
  const compactFromViewport = chatMode === 'compact';
  const location = useLocation();
  const navigate = useNavigate();

  const [forceChatOpen, setForceChatOpen] = useState(false);

  // Track if chat was open as sidebar before mode change
  const chatWasOpen = useRef(false);
  useEffect(() => {
    chatWasOpen.current = chatSidebar;
  }, [chatSidebar]);

  const prevChatMode = useRef(chatMode);
  useEffect(() => {
    const prev = prevChatMode.current;
    prevChatMode.current = chatMode;

    // bubble→nav: if sidebar was open, navigate to /chat
    if (chatMode === 'nav' && prev !== 'nav') {
      if (chatWasOpen.current) {
        setChatSidebar(false);
        navigate('/chat', { replace: true });
      }
    }

    // nav→bubble: if on /chat, go to /panel and open sidebar
    if (chatMode !== 'nav' && prev === 'nav') {
      if (location.pathname === '/chat') {
        navigate('/panel', { replace: true });
        setForceChatOpen(true);
        setTimeout(() => setForceChatOpen(false), 500);
      }
    }
  }, [chatMode]);

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'file_changed') {
      info(`📝 ${msg.path} actualizado`);
      refresh();
    } else if (msg.type === 'file_added') {
      info(`➕ ${msg.path} creado`);
      refresh();
    } else if (msg.type === 'file_deleted') {
      info(`🗑️ ${msg.path} eliminado`);
      refresh();
    }
  }, [info, refresh]);

  const { isConnected } = useWebSocket(handleWsMessage);

  return (
    <div className={`${styles.layout} ${chatSidebar ? styles.chatSidebarOpen : ''}`} data-mode={agentName}>
      {/* Main navigation sidebar (desktop) */}
      <NavSidebar
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed((v) => !v)}
        isConnected={isConnected}
        showChat={chatMode === 'nav'}
      />

      {/* Right side: content */}
      <div className={styles.main}>
        <main className={styles.content}>
          <div key={location.pathname.split('/')[1]} className={styles.pageTransition}>
            <Outlet
              context={{
                files,
                tree,
                refresh,
                success,
                error,
                info,
                basePath: '',
                chatSidebar: chatMode === 'nav' || (chatSidebar && chatMode !== 'full'),
              }}
            />
          </div>
        </main>
      </div>

      {/* Floating Chat — only when viewport allows bubble */}
      {showBubble && <FloatingChat onSidebarChange={setChatSidebar} forceOpen={forceChatOpen} />}

      {/* Toast container */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
