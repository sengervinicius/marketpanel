/**
 * useParticleAI.js — Streams AI responses for the Particle screen.
 *
 * Reuses the existing /api/search/chat SSE endpoint (Perplexity sonar-pro).
 * Manages conversation history, streaming state, and abort handling.
 *
 * Usage:
 *   const { messages, isStreaming, send, clear } = useParticleAI();
 *   send('What is moving in tech today?');
 */
import { useState, useCallback, useRef } from 'react';
import { API_BASE } from '../utils/api';

const SYSTEM_CONTEXT = [
  'You are Particle, an AI market intelligence assistant.',
  'Be concise (under 200 words unless the user asks for detail).',
  'Format tickers in bold like **AAPL**. Format prices like **$150.25**.',
  'Use short paragraphs, not bullet lists, unless ranking items.',
  'Never give investment advice. You can reference indicators and data.',
  'If you don\'t know something, say so briefly.',
].join(' ');

export default function useParticleAI() {
  // messages: [{ role: 'user'|'assistant', content: string, streaming?: boolean }]
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const send = useCallback(async (userMessage) => {
    if (!userMessage?.trim() || isStreaming) return;

    setError(null);

    // Add user message + empty assistant placeholder
    const userMsg = { role: 'user', content: userMessage.trim() };
    const assistantMsg = { role: 'assistant', content: '', streaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    // Build conversation history for the API (last 10 messages max)
    const historyForApi = [...messages, userMsg]
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    // Abort controller for this request
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/api/search/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          messages: historyForApi,
          context: SYSTEM_CONTEXT,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        throw new Error(res.status === 402 ? 'Subscription required' : errText);
      }

      // Stream the response
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const payload = trimmed.slice(6);
          if (payload === '[DONE]') break;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.chunk) {
              fullText += parsed.chunk;
              // Update the last (assistant) message in-place
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: fullText };
                }
                return updated;
              });
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Mark streaming complete
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: fullText || '(No response)', streaming: false };
        }
        return updated;
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        // User cancelled — mark the message as stopped
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content || '(Cancelled)', streaming: false };
          }
          return updated;
        });
      } else {
        setError(err.message);
        // Remove the empty assistant placeholder on error
        setMessages(prev => {
          const updated = [...prev];
          if (updated[updated.length - 1]?.role === 'assistant' && !updated[updated.length - 1].content) {
            updated.pop();
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages, isStreaming]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setIsStreaming(false);
  }, []);

  return { messages, isStreaming, error, send, stop, clear };
}
