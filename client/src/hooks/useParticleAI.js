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
import { useAuth } from '../context/AuthContext';

const SYSTEM_CONTEXT = [
  'You are Particle, an AI market intelligence assistant inside a professional trading terminal.',
  'Deliver institutional-grade analysis, not generic summaries.',
  'For asset questions: start with [sentiment:bull], [sentiment:bear], or [sentiment:neutral] tag.',
  'Then give a headline insight with specific numbers, followed by price action context, catalysts, and forward outlook.',
  'Format tickers in bold: **AAPL**, **$150.25**, **+2.1%**.',
  'For major assets give thorough 300-400 word analysis. For quick questions keep it at 150-200 words.',
  'Always prioritize real market data: index levels, price moves, sector performance, FX, commodities.',
  'For morning briefs: cover indices, sector rotations, FX, crypto, and macro catalysts.',
  'Never give investment advice. You can reference indicators and data.',
  'If you lack specific data, say so — never pad with generic commentary.',
  'Reference sources with [1], [2] markers when citing data — the terminal renders these as styled badges.',
].join(' ');

export default function useParticleAI() {
  const { token } = useAuth();
  // messages: [{ role: 'user'|'assistant', content: string, streaming?: boolean }]
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const send = useCallback(async (userMessage) => {
    if (!userMessage?.trim() || isStreaming) return;

    setError(null);

    // Add user message + empty assistant placeholder
    // Strip [SCREEN CONTEXT] prefix for display — the full message is still sent to the API
    const trimmed = userMessage.trim();
    const displayContent = trimmed.replace(/^\[SCREEN CONTEXT\].*?\n\nUser question:\s*/s, '');
    const userMsg = { role: 'user', content: displayContent };
    const userMsgForApi = { role: 'user', content: trimmed };
    const assistantMsg = { role: 'assistant', content: '', streaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    // Build conversation history for the API (last 10 messages max)
    // Use userMsgForApi (with screen context) for the current message
    const historyForApi = [...messages, userMsgForApi]
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    // Abort controller for this request
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/api/search/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          messages: historyForApi,
          context: SYSTEM_CONTEXT,
        }),
      });

      if (!res.ok) {
        // Parse the response as JSON when possible so we can translate
        // server error codes into human-readable copy. Falling back to
        // raw text was how users saw `{"error":"ai_chat_disabled",...}`
        // bleed into the chat as an "answer" — never again.
        const errText = await res.text().catch(() => '');
        let serverError = null;
        try { serverError = errText ? JSON.parse(errText) : null; } catch { /* not JSON */ }
        const code = serverError && (serverError.error || serverError.code);
        const friendly = (() => {
          if (res.status === 402) return 'Particle AI needs an active subscription. Upgrade to keep the conversation going.';
          if (res.status === 401) return 'Please sign in again to ask Particle.';
          if (res.status === 429) return 'You have reached your AI quota for now. Give it a minute and try again.';
          if (code === 'ai_chat_disabled') return 'Particle AI is temporarily offline. The team has been notified — try again in a few minutes.';
          if (code === 'vault_disabled')   return 'Vault search is temporarily offline. Try again in a few minutes.';
          if (res.status >= 500)           return 'Particle AI hit a temporary glitch. Please try again in a moment.';
          // Last resort — a human-readable message from the server if it shipped one, otherwise a generic line.
          if (serverError && typeof serverError.message === 'string' && serverError.message.trim() && !serverError.message.startsWith('{')) {
            return serverError.message;
          }
          return 'Particle AI couldn’t reach its brain just now. Please try again.';
        })();
        throw new Error(friendly);
      }

      // Stream the response
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let vaultSources = null;
      let webCitations = null; // Perplexity web citations (URLs)
      let structuredAnalysis = null; // Deep analysis JSON structure
      // P2.6 — per-tool status badges streamed from the tool-use loop.
      // Each entry is `{ name, ok, error, durationMs, truncated }` — the
      // UI renders a pill per entry so the user sees "forward_estimates
      // failed: FMP unavailable" instead of silently getting a degraded
      // answer with no hint why.
      let toolEvents = [];

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
            // Capture vault citation metadata (sent before the AI stream)
            if (parsed.vaultSources) {
              vaultSources = parsed.vaultSources;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, vaultSources };
                }
                return updated;
              });
              continue;
            }
            // Capture structured analysis JSON (sent at end of deep analysis stream)
            if (parsed.structuredAnalysis) {
              structuredAnalysis = parsed.structuredAnalysis;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, structuredAnalysis };
                }
                return updated;
              });
              continue;
            }
            // Phase 2: Capture context completeness metadata (sources, intent, model)
            if (parsed.contextMeta) {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, contextMeta: parsed.contextMeta };
                }
                return updated;
              });
              continue;
            }
            // Phase 2: Handle partial/interrupted stream — show retry prompt
            if (parsed.partial) {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content || '',
                    streaming: false,
                    partial: true,
                    partialError: parsed.error || 'Response interrupted — tap to retry',
                  };
                }
                return updated;
              });
              continue;
            }
            // P2.6 — per-tool status pill update. Append to the running
            // list and re-attach to the current assistant message so the
            // pill paints the instant the dispatch resolves on the server.
            if (parsed.toolEvent && typeof parsed.toolEvent === 'object' && parsed.toolEvent.name) {
              toolEvents = [...toolEvents, parsed.toolEvent];
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, toolEvents };
                }
                return updated;
              });
              continue;
            }
            // Capture web citations from Perplexity (sent as they arrive)
            if (parsed.citations && Array.isArray(parsed.citations)) {
              webCitations = parsed.citations;
              // Update message immediately so citations appear before stream ends
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, webCitations };
                }
                return updated;
              });
              continue;
            }
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

      // Mark streaming complete with all metadata
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: fullText || '(No response)',
            streaming: false,
            vaultSources: vaultSources || last.vaultSources,
            webCitations: webCitations || null,
            structuredAnalysis: structuredAnalysis || last.structuredAnalysis,
            // P2.6 — keep the collected tool status pills on the finalised
            // message so they persist in the conversation log.
            toolEvents: toolEvents.length ? toolEvents : (last.toolEvents || []),
          };
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
