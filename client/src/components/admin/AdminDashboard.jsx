/**
 * AdminDashboard.jsx — Admin analytics dashboard
 * Displays usage metrics, performance monitoring, and system health
 * Only accessible to admin users (user.id === 1 or in ADMIN_USER_IDS)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../utils/api';
import './AdminDashboard.css';

// ── Overview Card Component ────────────────────────────────────────────────
function OverviewCard({ label, value, trend = null, icon = '' }) {
  return (
    <div className="admin-overview-card">
      <div className="admin-overview-card-header">
        {icon && <span className="admin-overview-card-icon">{icon}</span>}
        <span className="admin-overview-card-label">{label}</span>
      </div>
      <div className="admin-overview-card-value">{value}</div>
      {trend !== null && (
        <div className={`admin-overview-card-trend ${trend > 0 ? 'positive' : 'negative'}`}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
        </div>
      )}
    </div>
  );
}

// ── Simple SVG Line Chart ──────────────────────────────────────────────────
function SimpleLineChart({ data, label, height = 200 }) {
  if (!data || data.length === 0) {
    return <div className="admin-chart-empty">No data available</div>;
  }

  const values = data.map(d => d.signups || d.queries || 0);
  const maxValue = Math.max(...values, 1);
  const minValue = 0;
  const range = maxValue - minValue;

  const padding = 20;
  const width = 800;
  const svgHeight = height;

  // Build path
  let pathData = '';
  values.forEach((val, i) => {
    const x = (i / (values.length - 1)) * (width - padding * 2) + padding;
    const y = svgHeight - padding - ((val - minValue) / range) * (svgHeight - padding * 2);

    if (i === 0) {
      pathData += `M ${x} ${y}`;
    } else {
      pathData += ` L ${x} ${y}`;
    }
  });

  return (
    <div className="admin-chart-container">
      <h4 className="admin-chart-title">{label}</h4>
      <svg width={width} height={svgHeight} className="admin-chart-svg">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = svgHeight - padding - pct * (svgHeight - padding * 2);
          return (
            <line
              key={i}
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              className="admin-chart-grid"
            />
          );
        })}

        {/* Path */}
        <path d={pathData} className="admin-chart-path" />

        {/* Data points */}
        {values.map((val, i) => {
          const x = (i / (values.length - 1)) * (width - padding * 2) + padding;
          const y = svgHeight - padding - ((val - minValue) / range) * (svgHeight - padding * 2);
          return (
            <circle key={i} cx={x} cy={y} r={3} className="admin-chart-point" />
          );
        })}
      </svg>
    </div>
  );
}

// ── Heatmap Component ──────────────────────────────────────────────────────
function UsageHeatmap({ heatmap }) {
  if (!heatmap || heatmap.length === 0) {
    return <div className="admin-chart-empty">No heatmap data available</div>;
  }

  const maxVal = Math.max(...heatmap.flat(), 1);
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cellSize = 24;
  const cellGap = 2;

  return (
    <div className="admin-heatmap-container">
      <h4 className="admin-chart-title">Query Density (Last 30 Days)</h4>
      <div className="admin-heatmap-wrapper">
        <div className="admin-heatmap-hours">
          {Array.from({ length: 24 }, (_, i) => (
            <div key={i} className="admin-heatmap-hour-label">
              {String(i).padStart(2, '0')}
            </div>
          ))}
        </div>
        <div className="admin-heatmap-grid">
          {heatmap.map((dayData, dayIdx) => (
            <div key={dayIdx} className="admin-heatmap-day">
              <div className="admin-heatmap-day-label">{daysOfWeek[dayIdx]}</div>
              <div className="admin-heatmap-cells">
                {dayData.map((count, hourIdx) => {
                  const intensity = maxVal > 0 ? count / maxVal : 0;
                  return (
                    <div
                      key={`${dayIdx}-${hourIdx}`}
                      className="admin-heatmap-cell"
                      style={{
                        opacity: Math.max(0.2, intensity),
                        backgroundColor: `rgba(0, 255, 136, ${intensity * 0.7})`,
                      }}
                      title={`${daysOfWeek[dayIdx]} ${String(hourIdx).padStart(2, '0')}:00 - ${count} queries`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Top Tickers Table ──────────────────────────────────────────────────────
function TopTickersTable({ tickers }) {
  if (!tickers || tickers.length === 0) {
    return <div className="admin-chart-empty">No ticker data available</div>;
  }

  return (
    <div className="admin-tickers-container">
      <h4 className="admin-chart-title">Top Queried Tickers (Last 30 Days)</h4>
      <table className="admin-tickers-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Queries</th>
          </tr>
        </thead>
        <tbody>
          {tickers.slice(0, 15).map((ticker, i) => (
            <tr key={i}>
              <td className="admin-tickers-ticker">{ticker.ticker}</td>
              <td className="admin-tickers-count">{ticker.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Users Table ────────────────────────────────────────────────────────────
function UsersTable({ users, total, limit, offset, onPageChange, onSearch, searchQuery }) {
  const pageCount = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="admin-users-container">
      <div className="admin-users-header">
        <h4 className="admin-chart-title">User Engagement</h4>
        <input
          type="text"
          placeholder="Search users..."
          className="admin-users-search"
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      {users.length === 0 ? (
        <div className="admin-chart-empty">No users found</div>
      ) : (
        <>
          <div className="admin-users-table-wrapper">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Plan</th>
                  <th>Vaults</th>
                  <th>Memories</th>
                  <th>Last Active</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id}>
                    <td className="admin-users-id">{user.id}</td>
                    <td className="admin-users-username">{user.username}</td>
                    <td className="admin-users-email">{user.email || '-'}</td>
                    <td className="admin-users-plan">
                      <span className={`admin-users-plan-badge ${user.isPaid ? 'paid' : 'trial'}`}>
                        {user.planTier.toUpperCase()}
                      </span>
                    </td>
                    <td className="admin-users-count">{user.vaultDocCount}</td>
                    <td className="admin-users-count">{user.memoryCount}</td>
                    <td className="admin-users-last-active">
                      {user.lastActive ? new Date(user.lastActive).toLocaleDateString() : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="admin-pagination">
            <button
              className="admin-pagination-btn"
              disabled={currentPage === 1}
              onClick={() => onPageChange(offset - limit)}
            >
              ← Previous
            </button>
            <span className="admin-pagination-info">
              Page {currentPage} of {pageCount} ({total} total)
            </span>
            <button
              className="admin-pagination-btn"
              disabled={currentPage >= pageCount}
              onClick={() => onPageChange(offset + limit)}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── System Health Panel ────────────────────────────────────────────────────
function HealthPanel({ health }) {
  if (!health) {
    return <div className="admin-chart-empty">Loading health data...</div>;
  }

  return (
    <div className="admin-health-container">
      <h4 className="admin-chart-title">System Health</h4>
      <div className="admin-health-grid">
        <div className="admin-health-item">
          <span className="admin-health-label">Database</span>
          <span className={`admin-health-value ${health.database?.status === 'connected' ? 'ok' : 'error'}`}>
            {health.database?.status || 'unknown'}
          </span>
          <span className="admin-health-detail">
            Query time: {health.database?.queryTimeMs}ms
          </span>
        </div>

        <div className="admin-health-item">
          <span className="admin-health-label">Uptime</span>
          <span className="admin-health-value">
            {Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m
          </span>
        </div>

        <div className="admin-health-item">
          <span className="admin-health-label">Node Version</span>
          <span className="admin-health-value">{health.system?.nodeVersion || 'unknown'}</span>
        </div>

        <div className="admin-health-item">
          <span className="admin-health-label">Heap Used</span>
          <span className="admin-health-value">
            {health.system?.memoryUsage?.heapUsedMB || '0'} MB
          </span>
          <span className="admin-health-detail">
            of {health.system?.memoryUsage?.heapTotalMB || '0'} MB
          </span>
        </div>
      </div>

      {/* Table Sizes */}
      {health.database?.tables && Object.keys(health.database.tables).length > 0 && (
        <div className="admin-health-tables">
          <h5 className="admin-health-tables-title">Database Tables</h5>
          <div className="admin-health-tables-grid">
            {Object.entries(health.database.tables).map(([name, count]) => (
              <div key={name} className="admin-health-table-item">
                <span className="admin-health-table-name">{name}</span>
                <span className="admin-health-table-count">
                  {count !== null ? count.toLocaleString() : 'N/A'} rows
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main AdminDashboard Component ──────────────────────────────────────────
export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [usage, setUsage] = useState(null);
  const [users, setUsers] = useState([]);
  const [health, setHealth] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userOffset, setUserOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [userTotal, setUserTotal] = useState(0);
  const refreshIntervalRef = useRef(null);

  const limit = 50;

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      // Fetch all dashboard data in parallel
      const [statsRes, usageRes, usersRes, healthRes, heatmapRes] = await Promise.all([
        apiFetch('/api/admin/stats', { method: 'GET' }),
        apiFetch('/api/admin/usage', { method: 'GET' }),
        apiFetch(`/api/admin/users?limit=${limit}&offset=${userOffset}&search=${encodeURIComponent(searchQuery)}`, {
          method: 'GET',
        }),
        apiFetch('/api/admin/health', { method: 'GET' }),
        apiFetch('/api/admin/heatmap', { method: 'GET' }),
      ]);

      setStats(statsRes);
      setUsage(usageRes);
      setUsers(usersRes.users || []);
      setUserTotal(usersRes.total || 0);
      setHealth(healthRes);
      setHeatmap(heatmapRes.heatmap);
    } catch (err) {
      console.error('[AdminDashboard] fetch error:', err);
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [userOffset, searchQuery]);

  // Fetch on mount and set up auto-refresh
  useEffect(() => {
    fetchData();

    // Auto-refresh every 60 seconds
    refreshIntervalRef.current = setInterval(fetchData, 60000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [fetchData]);

  const handlePageChange = (newOffset) => {
    setUserOffset(Math.max(0, newOffset));
  };

  const handleSearch = (query) => {
    setSearchQuery(query);
    setUserOffset(0);
  };

  if (loading && !stats) {
    return (
      <div className="admin-dashboard">
        <div className="admin-loading">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-dashboard">
        <div className="admin-error">Error: {error}</div>
        <button className="admin-error-retry" onClick={fetchData}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-dashboard-header">
        <h1>Admin Dashboard</h1>
        <div className="admin-dashboard-meta">
          <span className="admin-dashboard-updated">
            Updated: {new Date().toLocaleTimeString()}
          </span>
          <button className="admin-dashboard-refresh" onClick={fetchData}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <section className="admin-overview-section">
        <h2 className="admin-section-title">Overview</h2>
        <div className="admin-overview-grid">
          <OverviewCard
            label="Total Users"
            value={stats?.totalUsers || 0}
            icon="👥"
          />
          <OverviewCard
            label="Active Users (7d)"
            value={stats?.activeUsers || 0}
            icon="⚡"
          />
          <OverviewCard
            label="Paid Users"
            value={stats?.paidUsers || 0}
            icon="💳"
          />
          <OverviewCard
            label="Vault Documents"
            value={stats?.vaultDocs || 0}
            icon="📄"
          />
          <OverviewCard
            label="Vault Chunks"
            value={stats?.vaultChunks || 0}
            icon="🗂️"
          />
          <OverviewCard
            label="Storage (GB)"
            value={stats?.storageEstimateGB || '0'}
            icon="💾"
          />
          <OverviewCard
            label="AI Queries"
            value={stats?.totalQueries || 0}
            icon="🤖"
          />
          <OverviewCard
            label="Memories"
            value={stats?.totalMemories || 0}
            icon="🧠"
          />
        </div>
      </section>

      {/* User Growth Chart */}
      {stats?.userGrowth && (
        <section className="admin-charts-section">
          <h2 className="admin-section-title">User Growth</h2>
          <SimpleLineChart
            data={stats.userGrowth}
            label="Daily Signups (Last 30 Days)"
            height={250}
          />
        </section>
      )}

      {/* Usage Heatmap */}
      {heatmap && (
        <section className="admin-charts-section">
          <h2 className="admin-section-title">Usage Patterns</h2>
          <UsageHeatmap heatmap={heatmap} />
        </section>
      )}

      {/* Top Tickers */}
      {usage?.topTickers && (
        <section className="admin-charts-section">
          <TopTickersTable tickers={usage.topTickers} />
        </section>
      )}

      {/* Users Engagement Table */}
      <section className="admin-users-section">
        <h2 className="admin-section-title">User Engagement</h2>
        <UsersTable
          users={users}
          total={userTotal}
          limit={limit}
          offset={userOffset}
          onPageChange={handlePageChange}
          onSearch={handleSearch}
          searchQuery={searchQuery}
        />
      </section>

      {/* System Health */}
      {health && (
        <section className="admin-health-section">
          <h2 className="admin-section-title">System Health</h2>
          <HealthPanel health={health} />
        </section>
      )}
    </div>
  );
}
