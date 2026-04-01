import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, Square, Send, ImagePlus } from 'lucide-react';
import { marked } from 'marked';
import useChat from '../FloatingChat/useChat';
import styles from './ChatWindow.module.css';

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

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

// ── ChatWindow (main export) ─────────────────────────────────────────────
export default function ChatWindow() {
  const chat = useChat();
  const {
    messages, input, setInput, loading, streaming, streamText,
    error, setError, connected, sendMessage, abort,
  } = chat;

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const [pendingImages, setPendingImages] = useState([]);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  // Load history on mount
  useEffect(() => {
    chat.loadHistory();
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streaming, streamText]);

  // Focus input
  useEffect(() => {
    if (!loading) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [loading]);

  // Cleanup objectURLs
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

  // Drag & drop
  const handleDragEnter = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.types?.includes('Files')) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);
    const files = extractImageFiles(e.dataTransfer);
    if (files.length > 0) addImages(files);
  }, [addImages]);

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
      className={styles.wrapper}
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

      {/* Minimal header */}
      <div className={styles.header}>
        <div className={`${styles.statusDot} ${connected ? styles.dotOn : styles.dotOff}`} />
        <span className={styles.headerTitle}>Pia</span>
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
