/**
 * LeaderboardPanel.jsx — Global, persona, and weekly competition leaderboards.
 * Shows ranked user rows with avatars, persona labels, stats, and level badges.
 * Y-032: Added pagination (50 per page) with Load More button.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import UserAvatar from '../common/UserAvatar';
import ShareModal from '../common/ShareModal';
import { getPersona } from '../../config/avatars';
import './LeaderboardPanel.css';

const VIEWS = [
  { key: 'global',  label: 'Global' },
  { key: 'persona', label: 'My Persona' },
  { key: 'weekly',  label: 'Weekly' },
];

const PAGE_SIZE = 50;

function formatPct(v) {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function formatCountdown(endsAt) {
  if (!endsAt) return '';
  const diff = new Date(endsAt) - Date.now();
  if (diff <= 0) return 'Ended';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  return `${d}d ${h}h`;
}

function RankBadge({ rank }) {
  const cls =
    rank === 1 ? 'lb-rank lb-rank--gold' :
    rank === 2 ? 'lb-rank lb-rank--silver' :
    rank === 3 ? 'lb-rank lb-rank--bronze' :
    'lb-rank';
  return <span className={cls}>{rank}</span>;
}

export default function LeaderboardPanel({ mobile = false }) {
  const { user } = useAuth();
  const [view, setView] = useState('global');
  const [entries, setEntries] = useState([]);
  const [userRank, setUserRank] = useState(null);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState({ title: 'Global Leaderboard', endsAt: null, generatedAt: null });
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareType, setShareType] = useState('leaderboard');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchBoard = useCallback(async (v, pageNum = 0, append = false) => {
    setLoading(true);
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    let url;
    if (v === 'global') url = '/api/leaderboard/global';
    else if (v === 'persona') url = `/api/leaderboard/persona/${user?.persona?.type || 'value_investor'}`;
    else url = '/api/leaderboard/weekly';

    // Add pagination params
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}limit=${PAGE_SIZE}&offset=${pageNum * PAGE_SIZE}`;

    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      const newEntries = data.leaderboard || [];

      if (append) {
        setEntries(prev => [...prev, ...newEntries]);
      } else {
        setEntries(newEntries);
      }

      setUserRank(data.userRank ?? null);
      setTotal(data.total ?? 0);
      setHasMore(newEntries.length >= PAGE_SIZE);
      setMeta({
        title: v === 'weekly' ? (data.title || 'Weekly Challenge') : v === 'persona' ? 'Persona Leaderboard' : 'Global Leaderboard',
        endsAt: data.endsAt || null,
        generatedAt: data.generatedAt || null,
      });
    } catch {
      if (!append) setEntries([]);
      setUserRank(null);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [user?.persona?.type]);

  useEffect(() => {
    setPage(0);
    fetchBoard(view, 0, false);
  }, [view, fetchBoard]);

  const loadMore = useCallback(() => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchBoard(view, nextPage, true);
  }, [page, view, fetchBoard]);

  const currentUserId = user?.id;

  return (
    <div className={`lb-panel ${mobile ? 'lb-panel--mobile' : ''}`}>
      {/* Header */}
      <div className="lb-header">
        <div className="lb-title">LEADERBOARD</div>
        <div className="lb-tabs">
          {VIEWS.map(v => (
            <button
              key={v.key}
              className={`lb-tab ${view === v.key ? 'lb-tab--active' : ''}`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Weekly countdown */}
      {view === 'weekly' && meta.endsAt && (
        <div className="lb-countdown">
          Challenge ends in <strong>{formatCountdown(meta.endsAt)}</strong>
        </div>
      )}

      {/* Content */}
      <div className="lb-body">
        {loading && entries.length === 0 ? (
          <div className="lb-loading">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="lb-empty">No entries yet. Start trading to appear here!</div>
        ) : (
          <div className="lb-list">
            {entries.map((e, i) => {
              const rank = i + 1;
              const persona = getPersona(e.personaType);
              const isMe = e.userId === currentUserId;
              const mainMetric = view === 'weekly' ? e.stats.weeklyReturn : e.stats.totalReturn;
              return (
                <div key={e.userId} className={`lb-row ${isMe ? 'lb-row--me' : ''}`}>
                  <RankBadge rank={rank} />
                  <UserAvatar
                    user={{ persona: { type: e.personaType }, username: e.username }}
                    size="small"
                  />
                  <div className="lb-row-info">
                    <span className="lb-row-name">{e.username}</span>
                    <span className="lb-row-persona">{persona?.label || '—'}</span>
                  </div>
                  <div className="lb-row-metrics">
                    <span className={`lb-row-return ${mainMetric >= 0 ? 'lb-row-return--up' : 'lb-row-return--down'}`}>
                      {formatPct(mainMetric)}
                    </span>
                    {view !== 'weekly' && (
                      <span className="lb-row-sharpe">SR {(e.stats.sharpeRatio ?? 0).toFixed(2)}</span>
                    )}
                  </div>
                  <span className="lb-row-score">{e.score}</span>
                </div>
              );
            })}

            {/* Load more button */}
            {hasMore && (
              <button
                className="lb-load-more"
                onClick={loadMore}
                disabled={loading}
              >
                {loading ? 'Loading...' : `Load more (showing ${entries.length} of ${total})`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {userRank != null && (
        <div className="lb-footer">
          Your rank: <strong>#{userRank}</strong> of {total}
          <button
            className="lb-share-btn"
            onClick={() => { setShareType(view === 'weekly' ? 'weekly' : 'leaderboard'); setShareOpen(true); }}
          >SHARE</button>
        </div>
      )}

      {/* Share modal */}
      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        cardType={shareType}
        cardData={{ board: view }}
      />
    </div>
  );
}
