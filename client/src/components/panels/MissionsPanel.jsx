/**
 * MissionsPanel.jsx
 * Desktop missions panel showing daily/weekly/one-time missions with progress
 * bars, claim buttons, and streak info.
 */
import { useState, useEffect, useCallback, memo } from 'react';
import { apiFetch } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import './MissionsPanel.css';

function MissionsPanel() {
  const { setUser } = useAuth();
  const { addToast } = useToast();
  const [missions, setMissions] = useState([]);
  const [streak, setStreak] = useState({ current: 0, lastLoginAt: null });
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(null);

  const fetchMissions = useCallback(async () => {
    try {
      const res = await apiFetch('/api/missions');
      if (res.ok) {
        const data = await res.json();
        setMissions(data.missions || []);
        setStreak(data.streak || { current: 0 });
      }
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchMissions(); }, [fetchMissions]);

  const handleClaim = async (missionId) => {
    setClaiming(missionId);
    try {
      const res = await apiFetch('/api/missions/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId }),
      });
      if (res.ok) {
        const data = await res.json();
        setMissions(data.missions || []);
        setStreak(data.streak || streak);
        // Update AuthContext gamification
        if (data.gamification) {
          setUser(prev => prev ? { ...prev, gamification: data.gamification } : prev);
        }
        // Show toast
        if (data.claimed) {
          addToast({
            title: 'Mission Complete!',
            body: `${data.claimed.title} \u00b7 +${data.claimed.xpReward} XP`,
          });
        }
      }
    } catch (_) {}
    setClaiming(null);
  };

  const daily = missions.filter(m => m.kind === 'daily');
  const weekly = missions.filter(m => m.kind === 'weekly');
  const oneTime = missions.filter(m => m.kind === 'one-time');

  if (loading) {
    return (
      <div className="mis-panel">
        <div className="mis-header">
          <span className="mis-title">Missions</span>
        </div>
        <div className="mis-loading">Loading missions...</div>
      </div>
    );
  }

  return (
    <div className="mis-panel">
      <div className="mis-header">
        <span className="mis-title">Missions</span>
        <span className="mis-streak-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          {streak.current}-day streak
        </span>
      </div>

      {daily.length > 0 && (
        <MissionGroup label="DAILY" missions={daily} claiming={claiming} onClaim={handleClaim} />
      )}
      {weekly.length > 0 && (
        <MissionGroup label="WEEKLY" missions={weekly} claiming={claiming} onClaim={handleClaim} />
      )}
      {oneTime.length > 0 && (
        <MissionGroup label="QUESTS" missions={oneTime} claiming={claiming} onClaim={handleClaim} />
      )}
    </div>
  );
}

function MissionGroup({ label, missions, claiming, onClaim }) {
  return (
    <div className="mis-group">
      <div className="mis-group-label">{label}</div>
      {missions.map(m => (
        <MissionCard key={m.id} mission={m} claiming={claiming === m.id} onClaim={() => onClaim(m.id)} />
      ))}
    </div>
  );
}

function MissionCard({ mission, claiming, onClaim }) {
  const pct = mission.progress.target > 0
    ? Math.min(100, Math.round((mission.progress.current / mission.progress.target) * 100))
    : 0;

  return (
    <div className={`mis-card mis-card--${mission.status}`}>
      <div className="mis-card-top">
        <div className="mis-card-info">
          <span className="mis-card-title">{mission.title}</span>
          <span className="mis-card-desc">{mission.description}</span>
        </div>
        <div className="mis-card-right">
          <span className="mis-card-xp">+{mission.xpReward} XP</span>
          {mission.status === 'completed' && (
            <button className="mis-claim-btn" onClick={onClaim} disabled={claiming}>
              {claiming ? '...' : 'CLAIM'}
            </button>
          )}
          {mission.status === 'claimed' && (
            <span className="mis-status-badge mis-status-badge--claimed">CLAIMED</span>
          )}
        </div>
      </div>
      <div className="mis-progress-row">
        <div className="mis-progress-bar">
          <div className="mis-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="mis-progress-text">{mission.progress.current}/{mission.progress.target}</span>
      </div>
    </div>
  );
}

export default memo(MissionsPanel);
