import { useState, useEffect } from 'react';

export default function PasswordGate({ children }) {
  const [auth, setAuth] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('arc_auth') === '1') setAuth(true);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (password === 'ARCScreen') {
      sessionStorage.setItem('arc_auth', '1');
      setAuth(true);
    } else {
      setError('ACCESS DENIED — INVALID CREDENTIALS');
      setShake(true);
      setPassword('');
      setTimeout(() => { setError(''); setShake(false); }, 2500);
    }
  };

  if (auth) return children;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0a0a0f',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace"
    }}>
      {/* Background grid lines */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.04,
        backgroundImage: 'linear-gradient(#e55a00 1px, transparent 1px), linear-gradient(90deg, #e55a00 1px, transparent 1px)',
        backgroundSize: '40px 40px', pointerEvents: 'none'
      }} />

      <div style={{position:'relative', width:'100%', maxWidth:420, padding:'0 20px'}}>
        {/* Logo / branding */}
        <div style={{textAlign:'center', marginBottom:40}}>
          <div style={{color:'#e55a00', fontSize:11, letterSpacing:'0.25em', marginBottom:6, textTransform:'uppercase'}}>
            ARC CAPITAL
          </div>
          <div style={{color:'#e8e8e8', fontSize:20, fontWeight:600, letterSpacing:'0.15em', marginBottom:4}}>
            SENGER MARKET SCREEN
          </div>
          <div style={{color:'#444', fontSize:8, letterSpacing:'0.3em', textTransform:'uppercase'}}>
            Professional Market Data Terminal
          </div>
          <div style={{width:60, height:1, background:'#e55a00', margin:'16px auto 0'}} />
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} style={{
          background: '#0d0d14', border: '1px solid #1a1a2e',
          borderRadius: 2, padding: '24px 28px',
          animation: shake ? 'shake 0.4s ease' : 'none'
        }}>
          <div style={{color:'#555', fontSize:8, letterSpacing:'0.2em', marginBottom:12, textTransform:'uppercase'}}>
            Authentication Required
          </div>

          <div style={{marginBottom:16}}>
            <div style={{color:'#666', fontSize:8, letterSpacing:'0.1em', marginBottom:6, textTransform:'uppercase'}}>
              Access Code
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter access code"
              autoFocus
              style={{
                width: '100%', background: '#06060a', border: '1px solid #222',
                borderRadius: 1, color: '#e8e8e8', fontFamily: 'inherit',
                fontSize: 12, padding: '10px 12px', outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = '#e55a00'}
              onBlur={e => e.target.style.borderColor = '#222'}
            />
          </div>

          {error && (
            <div style={{
              color: '#f44336', fontSize: 8, letterSpacing: '0.1em',
              marginBottom: 12, textTransform: 'uppercase'
            }}>
              ⚠ {error}
            </div>
          )}

          <button
            type="submit"
            style={{
              width: '100%', background: 'linear-gradient(135deg, #1a0800, #2a1000)',
              border: '1px solid #e55a00', color: '#e55a00',
              fontFamily: 'inherit', fontSize: 9, fontWeight: 600,
              letterSpacing: '0.15em', padding: '10px 16px',
              textTransform: 'uppercase', cursor: 'pointer',
              transition: 'background 0.2s, color 0.2s',
              borderRadius: 1
            }}
            onMouseEnter={e => { e.target.style.background = '#e55a00'; e.target.style.color = '#000'; }}
            onMouseLeave={e => { e.target.style.background = 'linear-gradient(135deg, #1a0800, #2a1000)'; e.target.style.color = '#e55a00'; }}
          >
            ACCESS TERMINAL
          </button>
        </form>

        <div style={{textAlign:'center', marginTop:20, color:'#333', fontSize:7, letterSpacing:'0.1em'}}>
          AUTHORIZED USERS ONLY · CONFIDENTIAL
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-8px)}
          40%{transform:translateX(8px)}
          60%{transform:translateX(-6px)}
          80%{transform:translateX(6px)}
        }
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&display=swap');
      `}</style>
    </div>
  );
}
