import { useState, useRef, useCallback } from 'react';
import { getToken } from '../../api/client';
import { marked } from 'marked';

const API = '/api/chat';
marked.setOptions({ breaks: true, gfm: true });

function auth() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function useChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const abortRef = useRef(null);

  const loadHistory = useCallback(async () => {
    // Don't reload while streaming
    if (streaming) return;
    setLoading(true);
    try {
      const statusRes = await fetch(`${API}/status`, { headers: auth() });
      const status = await statusRes.json();
      setConnected(status.connected);

      const histRes = await fetch(`${API}/history?limit=80`, { headers: auth() });
      const hist = await histRes.json();
      setMessages(hist.messages || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [streaming]);

  const sendMessage = useCallback(async (text, attachments = []) => {
    if ((!text?.trim() && attachments.length === 0) || streaming) return;

    const msgText = text?.trim() || '(imagen)';
    // Build user message with inline image previews for display
    const userMsg = {
      role: 'user',
      content: msgText,
      images: attachments.map(a => a.preview), // objectURLs for display
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamText('');
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    // Convert attachments to base64 for the backend
    let base64Attachments = [];
    if (attachments.length > 0) {
      base64Attachments = await Promise.all(
        attachments.map(a => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve({ type: 'image', data: base64, mimeType: a.file.type });
          };
          reader.onerror = reject;
          reader.readAsDataURL(a.file);
        }))
      );
    }

    try {
      const body = { message: msgText };
      if (base64Attachments.length > 0) {
        body.attachments = base64Attachments;
      }
      const res = await fetch(`${API}/send`, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
        }
      }

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
  }, [streaming]);

  const abort = useCallback(async () => {
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

  return {
    messages, input, setInput, loading, streaming, streamText,
    error, setError, connected, loadHistory, sendMessage, abort,
  };
}
