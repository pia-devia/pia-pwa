import { useState, useEffect, useRef, useCallback } from 'react';
import { Square } from 'lucide-react';
import { getToken } from '../../api/client';
import { marked } from 'marked';
import styles from './Chat.module.css';

const API = '/api/chat';
marked.setOptions({ breaks: true, gfm: true });

function auth() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ── Message bubble ──────────────────────────────────────────────────────
function MessageBubble({ role, content, isStreaming }) {
  const isUser = role === 'user';
  const html = !isUser ? marked.parse(content || '') : null;

  return (
    <div className={`${styles.msgRow} ${isUser ? styles.msgRowUser : styles.msgRowAssistant}`}>
      {!isUser && <div className={styles.avatar}>K</div>}
      <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant}`}>
        {isUser ? (
          <span>{content}</span>
        ) : (
          <div
            className={styles.markdownContent}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        {isStreaming && <span className={styles.cursor} />}
      </div>
    </div>
  );
}

// ── Typing indicator ────────────────────────────────────────────────────
function Typing() {
  return (
    <div className={`${styles.msgRow} ${styles.msgRowAssistant}`}>
      <div className={styles.avatar}>K</div>
      <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
        <div className={styles.typing}>
          <span /><span /><span />
        </div>
      </div>
    </div>
  );
}

// ── Main Chat component ─────────────────────────────────────────────────
export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // ── Scroll to bottom ──────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streaming, streamText, scrollToBottom]);

  // ── Load history on mount ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        // Check connection status
        const statusRes = await fetch(`${API}/status`, { headers: auth() });
        const status = await statusRes.json();
        setConnected(status.connected);

        // Fetch history
        const histRes = await fetch(`${API}/history?limit=80`, { headers: auth() });
        const hist = await histRes.json();
        setMessages(hist.messages || []);
        setLoading(false);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'instant' }), 50);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    })();
  }, []);

  // ── Send message ──────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    // Optimistic: add user message
    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: Date.now() }]);

    setStreaming(true);
    setStreamText('');
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API}/send`, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalContent = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          let event;
          try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }

          if (event.type === 'delta') {
            setStreamText(event.content);
            finalContent = event.content;
          } else if (event.type === 'done') {
            finalContent = event.content || finalContent;
            setMessages(prev => [...prev, { role: 'assistant', content: finalContent, timestamp: Date.now() }]);
            setStreamText('');
            setStreaming(false);
          } else if (event.type === 'aborted') {
            if (finalContent) {
              setMessages(prev => [...prev, { role: 'assistant', content: finalContent + '\n\n*(abortado)*', timestamp: Date.now() }]);
            }
            setStreamText('');
            setStreaming(false);
          } else if (event.type === 'error') {
            throw new Error(event.error);
          }
          // 'ack' and 'agent' events ignored for now
        }
      }

      // If stream ended without done event
      if (streaming) {
        if (finalContent) {
          setMessages(prev => [...prev, { role: 'assistant', content: finalContent, timestamp: Date.now() }]);
        }
        setStreamText('');
        setStreaming(false);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
      setStreamText('');
      setStreaming(false);
    } finally {
      abortRef.current = null;
    }
  }, [input, streaming]);

  // ── Abort ─────────────────────────────────────────────────────────────
  const handleAbort = useCallback(async () => {
    abortRef.current?.abort();
    setStreaming(false);
    setStreamText('');
    try {
      await fetch(`${API}/abort`, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {}
  }, []);

  // ── Input handlers ────────────────────────────────────────────────────
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.centered}>
        <div className={styles.spinner} />
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {/* Connection status */}
      {!connected && (
        <div className={styles.connBanner}>
          No conectado al gateway
        </div>
      )}

      <div className={styles.messages}>
        {messages.length === 0 && !streaming && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>💬</span>
            <p>Escribe algo para empezar</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={`${msg.timestamp || i}-${msg.role}`}
            role={msg.role}
            content={msg.content}
          />
        ))}

        {streaming && !streamText && <Typing />}
        {streaming && streamText && (
          <MessageBubble role="assistant" content={streamText} isStreaming />
        )}

        {error && (
          <div className={styles.errorBanner}>
            <span>{error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className={styles.inputArea}>
        <div className={styles.inputRow}>
          <textarea
            ref={inputRef}
            className={styles.input}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un mensaje..."
            rows={1}
          />

          {streaming ? (
            <button className={styles.stopBtn} onClick={handleAbort} title="Parar">
              <Square size={16} strokeWidth={2} fill="currentColor" />
            </button>
          ) : (
            <button
              className={styles.sendBtn}
              onClick={sendMessage}
              disabled={!input.trim()}
            >
              Enviar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
