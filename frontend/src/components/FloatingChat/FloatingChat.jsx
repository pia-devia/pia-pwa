import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, PanelRightOpen, PanelRightClose, Square, Send, ImagePlus, ExternalLink } from 'lucide-react';
import { marked } from 'marked';
import useChat from './useChat';
import { getToken } from '../../api/client';
import styles from './FloatingChat.module.css';

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// ── Image helpers ─────────────────────────────────────────────────────────
function validateImageFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) return 'Tipo no soportado. Solo JPG, PNG, GIF, WebP.';
  if (file.size > MAX_IMAGE_SIZE) return 'Imagen demasiado grande (máx 5MB).';
  return null;
}

function extractImageFiles(dataTransfer) {
  const files = [];
  if (dataTransfer?.items) {
    for (const item of dataTransfer.items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  } else if (dataTransfer?.files) {
    for (const f of dataTransfer.files) {
      if (f.type.startsWith('image/')) files.push(f);
    }
  }
  return files;
}

// ── Context usage hook ───────────────────────────────────────────────────
function useContextUsage(streaming) {
  const [contextPercent, setContextPercent] = useState(null);
  const timerRef = useRef(null);
  const refreshAfterDoneRef = useRef(false);

  const fetchUsage = useCallback(async () => {
    try {
      const t = getToken();
      const headers = t ? { Authorization: `Bearer ${t}` } : {};
      const res = await fetch('/api/chat/usage', { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (data.contextPercent != null) setContextPercent(data.contextPercent);
    } catch {}
  }, []);

  // Poll every 30s
  useEffect(() => {
    fetchUsage();
    timerRef.current = setInterval(fetchUsage, 30000);
    return () => clearInterval(timerRef.current);
  }, [fetchUsage]);

  // Refresh after streaming ends (done event)
  useEffect(() => {
    if (streaming) {
      refreshAfterDoneRef.current = true;
    } else if (refreshAfterDoneRef.current) {
      refreshAfterDoneRef.current = false;
      // Small delay to let gateway update
      setTimeout(fetchUsage, 2000);
    }
  }, [streaming, fetchUsage]);

  return contextPercent;
}

// ── Chat panel (shared between mini and expanded) ────────────────────────
function ChatPanel({ expanded, onToggleExpand, onClose, onHeaderPointerDown, chat }) {
  const {
    messages, input, setInput, loading, streaming, streamText,
    error, setError, connected, sendMessage, abort,
  } = chat;

  const contextPercent = useContextUsage(streaming);
  const [flushing, setFlushing] = useState(false);

  const handleFlush = useCallback(async () => {
    if (flushing) return;
    setFlushing(true);
    try {
      const t = getToken();
      const res = await fetch('/api/chat/flush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      });
      if (res.ok) {
        // Reload history after compact
        setTimeout(() => chat.loadHistory(), 2000);
      }
    } catch {}
    setFlushing(false);
  }, [flushing, chat]);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const [pendingImages, setPendingImages] = useState([]); // [{ file, preview }]
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streaming, streamText]);

  // Focus input when opened
  useEffect(() => {
    if (!loading) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [loading]);

  // Cleanup objectURLs on unmount
  useEffect(() => {
    return () => {
      pendingImages.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, []);

  const addImages = useCallback((files) => {
    setPendingImages(prev => {
      const remaining = MAX_IMAGES - prev.length;
      if (remaining <= 0) {
        setError(`Máximo ${MAX_IMAGES} imágenes por mensaje`);
        return prev;
      }
      const toAdd = [];
      for (const file of files.slice(0, remaining)) {
        const err = validateImageFile(file);
        if (err) { setError(err); continue; }
        toAdd.push({ file, preview: URL.createObjectURL(file) });
      }
      return [...prev, ...toAdd];
    });
  }, [setError]);

  const removeImage = useCallback((index) => {
    setPendingImages(prev => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Drag & drop handlers
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.types?.includes('Files')) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);
    const files = extractImageFiles(e.dataTransfer);
    if (files.length > 0) addImages(files);
  }, [addImages]);

  // Paste handler
  const handlePaste = useCallback((e) => {
    const files = extractImageFiles(e.clipboardData);
    if (files.length > 0) {
      e.preventDefault();
      addImages(files);
    }
  }, [addImages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    const images = [...pendingImages];
    setPendingImages([]);
    sendMessage(text, images);
  }, [input, setInput, sendMessage, pendingImages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
  };

  return (
    <div
      className={`${styles.panel} ${expanded ? styles.panelExpanded : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {dragging && (
        <div className={styles.dropOverlay}>
          <ImagePlus size={32} />
          <span>Suelta imágenes aquí</span>
        </div>
      )}

      {/* Header (draggable) */}
      <div
        className={styles.header}
        onPointerDown={onHeaderPointerDown}
        style={{ cursor: expanded ? 'default' : 'grab', touchAction: 'none', userSelect: 'none' }}
      >
        <div className={styles.headerLeft}>
          <div className={`${styles.statusDot} ${connected ? styles.dotOn : styles.dotOff}`} />
          <span className={styles.headerTitle}>Pia</span>
          {contextPercent != null && (
            <span className={`${styles.contextBadge} ${
              contextPercent > 90 ? styles.contextDanger :
              contextPercent > 75 ? styles.contextWarn : ''
            }`} style={
              contextPercent < 50 ? { color: 'rgba(255,255,255,0.3)' } :
              contextPercent <= 75 ? { color: 'var(--accent)' } : undefined
            }>
              {Math.round(contextPercent)}%
            </span>
          )}
          {contextPercent > 80 && (
            <button
              className={`${styles.flushBadge} ${flushing ? styles.flushActive : styles.flushAlert}`}
              onClick={(e) => { e.stopPropagation(); handleFlush(); }}
              disabled={flushing || streaming}
            >
              {flushing ? 'flushing...' : 'flush'}
            </button>
          )}
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.headerBtn}
            onClick={() => window.open('/chat-window', 'pia-chat', 'width=500,height=700,resizable=yes,scrollbars=no')}
            title="Abrir en ventana"
          >
            <ExternalLink size={15} />
          </button>
          <button className={styles.headerBtn} onClick={onToggleExpand} title={expanded ? 'Minimizar' : 'Ampliar'}>
            {expanded ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
          <button className={styles.headerBtn} onClick={onClose} title="Cerrar">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className={styles.messages}>
        {loading && (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
          </div>
        )}

        {!loading && messages.length === 0 && !streaming && (
          <div className={styles.emptyState}>
            <MessageCircle size={32} strokeWidth={1.2} />
            <p>Escribe algo para empezar</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={`${msg.timestamp || i}-${msg.role}`} msg={msg} />
        ))}

        {streaming && !streamText && <TypingDots />}
        {streaming && streamText && (
          <MessageBubble msg={{ role: 'assistant', content: streamText }} isStreaming />
        )}

        {flushing && (
          <div className={styles.flushOverlay}>
            <div className={styles.flushLoader} />
            <span>Guardando contexto y compactando...</span>
          </div>
        )}

        {error && (
          <div className={styles.errorMsg}>
            {error}
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Image preview strip */}
      {pendingImages.length > 0 && (
        <div className={styles.imagePreview}>
          {pendingImages.map((img, i) => (
            <div key={i} className={styles.imageThumb}>
              <img src={img.preview} alt={`Adjunto ${i + 1}`} />
              <button className={styles.imageRemove} onClick={() => removeImage(i)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className={styles.inputArea}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={pendingImages.length > 0 ? 'Añade un mensaje (opcional)...' : 'Mensaje...'}
          rows={1}
        />
        {streaming ? (
          <button className={styles.stopBtn} onClick={abort}>
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button className={styles.sendBtn} onClick={handleSend} disabled={!input.trim() && pendingImages.length === 0}>
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Message bubble ───────────────────────────────────────────────────────
function MessageBubble({ msg, isStreaming }) {
  const isUser = msg.role === 'user';
  const html = !isUser ? marked.parse(msg.content || '') : null;
  const images = msg.images || [];

  return (
    <div className={`${styles.msgRow} ${isUser ? styles.msgUser : styles.msgAssistant}`}>
      {!isUser && <div className={styles.avatar}>P</div>}
      <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAi}`}>
        {images.length > 0 && (
          <div className={styles.msgImages}>
            {images.map((src, i) => (
              <img key={i} src={src} alt={`Imagen ${i + 1}`} className={styles.msgImage} />
            ))}
          </div>
        )}
        {isUser ? (
          msg.content !== '(imagen)' && <span>{msg.content}</span>
        ) : (
          <div className={styles.md} dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {isStreaming && <span className={styles.cursor} />}
      </div>
    </div>
  );
}

// ── Typing indicator ─────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className={`${styles.msgRow} ${styles.msgAssistant}`}>
      <div className={styles.avatar}>P</div>
      <div className={`${styles.bubble} ${styles.bubbleAi}`}>
        <div className={styles.dots}><span /><span /><span /></div>
      </div>
    </div>
  );
}

// ── Floating Chat (main export) ──────────────────────────────────────────
export default function FloatingChat({ onSidebarChange, forceOpen }) {
  const chat = useChat();
  const [open, setOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const lastSeenCount = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState(() => {
    try {
      const saved = localStorage.getItem('floatingChatPos');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const dragState = useRef(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  // ── Drag logic (document-level for smooth tracking) ─────────────
  const posRef = useRef(position); // mirror for event handlers
  posRef.current = position;

  const onDocMove = useCallback((e) => {
    const ds = dragState.current;
    if (!ds) return;

    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;

    if (!ds.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    ds.moved = true;

    const newRight = Math.max(8, Math.min(window.innerWidth - 60, ds.origRight - dx));
    const newBottom = Math.max(8, Math.min(window.innerHeight - 60, ds.origBottom - dy));

    setPosition({ right: newRight, bottom: newBottom });
  }, []);

  const onDocUp = useCallback(() => {
    const ds = dragState.current;
    if (!ds) return;
    dragState.current = null;

    document.removeEventListener('pointermove', onDocMove);
    document.removeEventListener('pointerup', onDocUp);

    if (ds.moved && posRef.current) {
      localStorage.setItem('floatingChatPos', JSON.stringify(posRef.current));
    } else if (!ds.wasOpen) {
      setOpen(true);
      chat.loadHistory();
    }
  }, [onDocMove]);

  const startDrag = useCallback((e, wasOpen) => {
    // Get position of the element being dragged
    const el = wasOpen ? panelRef.current : btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origRight: window.innerWidth - rect.right,
      origBottom: window.innerHeight - rect.bottom,
      moved: false,
      wasOpen,
    };

    e.preventDefault();
    document.addEventListener('pointermove', onDocMove);
    document.addEventListener('pointerup', onDocUp);
  }, [onDocMove, onDocUp]);

  const handlePointerDown = useCallback((e) => {
    startDrag(e, false);
  }, [startDrag]);

  const handlePanelHeaderPointerDown = useCallback((e) => {
    if (expanded) return;
    if (e.target.closest('button')) return;
    startDrag(e, true);
  }, [expanded, startDrag]);

  // Force open as sidebar (e.g. when switching from /chat to bubble mode)
  useEffect(() => {
    if (forceOpen && !open) {
      setOpen(true);
      setExpanded(true);
      onSidebarChange?.(true);
      chat.loadHistory();
    }
  }, [forceOpen]);

  // Track unread messages
  useEffect(() => {
    if (open) {
      // When open, mark as read
      setHasUnread(false);
      lastSeenCount.current = chat.messages.length;
    } else if (chat.messages.length > lastSeenCount.current) {
      // New messages arrived while closed
      const newMsgs = chat.messages.slice(lastSeenCount.current);
      if (newMsgs.some(m => m.role === 'assistant')) {
        setHasUnread(true);
      }
    }
  }, [open, chat.messages.length]);

  const defaultPos = { right: 20, bottom: 20 };
  const [fabReappear, setFabReappear] = useState(false);

  const handleClose = useCallback(() => {
    if (expanded) {
      onSidebarChange?.(false);
    }
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setExpanded(false);
      setClosing(false);
      // Reset position and trigger FAB fade-in
      setPosition(defaultPos);
      localStorage.setItem('floatingChatPos', JSON.stringify(defaultPos));
      setFabReappear(true);
      setTimeout(() => setFabReappear(false), 400);
    }, expanded ? 250 : 200);
  }, [expanded, onSidebarChange]);

  const toggleExpand = useCallback(() => {
    setExpanded(v => {
      const next = !v;
      onSidebarChange?.(next);
      return next;
    });
  }, [onSidebarChange]);

  // Position styles for the button
  const posStyle = position
    ? { right: position.right, bottom: position.bottom }
    : { right: 20, bottom: 20 };

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          ref={btnRef}
          className={`${styles.fab} ${fabReappear ? styles.fabIn : ''} ${hasUnread ? styles.fabUnread : ''}`}
          style={posStyle}
          onPointerDown={handlePointerDown}
          title="Chat con Pia"
        >
          <MessageCircle size={22} />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          ref={panelRef}
          className={`${styles.panelWrap} ${expanded ? styles.panelWrapExpanded : ''} ${closing ? styles.panelClosing : ''}`}
          style={!expanded ? posStyle : undefined}
        >
          <ChatPanel
            expanded={expanded}
            onToggleExpand={toggleExpand}
            onClose={handleClose}
            onHeaderPointerDown={handlePanelHeaderPointerDown}
            chat={chat}
          />
        </div>
      )}
    </>
  );
}
