import { useState, useRef, useEffect, useCallback } from 'react';
import './mobilev2.css';
import { useMarketData } from '../../../hooks/useMarketData';
import { useWatchlist } from '../../../context/WatchlistContext';
import { apiFetch } from '../../../utils/api';
import { useParticleChat } from '../../../context/ParticleChatContext';

const I = ({d, w=22}) => (<svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>);
const icons = {
  search:<><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></>,
  bell:<><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/></>,
  chev:<path d="M9 5l7 7-7 7"/>,
  arrow:<path d="M5 12h14M13 6l6 6-6 6"/>,
  spark:<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>,
  chart:<><path d="M3 17l6-6 4 4 8-9"/><path d="M21 6v5h-5"/></>,
  vault:<><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></>,
  back:<path d="M15 5l-7 7 7 7"/>,
  star:<path d="M12 3l2.5 6 6.5.5-5 4.2 1.6 6.3L12 17l-5.6 3 1.6-6.3-5-4.2 6.5-.5z"/>,
  send:<path d="M4 12l16-8-6 16-3-7-7-1z"/>,
  doc:<><path d="M6 2h9l3 3v17H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
  cite:<><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  up:<path d="M4 16l6-6 4 4 6-8"/>,
};

/* ---- interactive chart (line default, candles/area, scrub crosshair) ---- */
function renderRich(text){
  if(text==null) return null;
  const str=String(text).replace(/\r/g,'');
  // Inline tokeniser: **bold**, $TICKER, [sentiment:x], [action:...], [N] cites.
  const inline=(txt,keybase)=>{
    const parts=txt.split(/(\*\*[^*]+\*\*|\$[A-Z]{1,5}(?:\.[A-Z]{1,2})?|\[sentiment:(?:bull|bear|neutral)\]|\[action:[a-z_]+(?::[^\]]+)?\]|\[\d{1,2}\])/gi);
    return parts.map((pt,i)=>{
      if(!pt) return null; let m;
      if((m=pt.match(/^\*\*([^*]+)\*\*$/))) return <b key={keybase+'-'+i}>{m[1]}</b>;
      if((m=pt.match(/^\$([A-Z]{1,5}(?:\.[A-Z]{1,2})?)$/))) return <span key={keybase+'-'+i} style={{color:'#ff8a2a',fontWeight:600}}>{'$'+m[1]}</span>;
      if((m=pt.match(/^\[sentiment:(bull|bear|neutral)\]$/i))){const c=m[1].toLowerCase()==='bull'?'#37d67a':m[1].toLowerCase()==='bear'?'#ff5d5d':'#9aa0aa';return <span key={keybase+'-'+i} style={{display:'inline-block',width:7,height:7,borderRadius:4,background:c,marginRight:6,verticalAlign:'middle'}}/>;}
      if(/^\[action:/.test(pt)) return null;
      if((m=pt.match(/^\[(\d{1,2})\]$/))) return <sup key={keybase+'-'+i} style={{color:'var(--mut)',fontSize:'0.7em',fontWeight:600}}>{m[1]}</sup>;
      return <span key={keybase+'-'+i}>{pt}</span>;
    });
  };
  const lines=str.split(/\n/);
  const out=[]; let bullets=null; let k=0;
  const flush=()=>{ if(bullets){ out.push(<ul key={'u'+(k++)} style={{margin:'6px 0 6px 2px',paddingLeft:16}}>{bullets}</ul>); bullets=null; } };
  lines.forEach((ln,idx)=>{
    const t=ln.trim();
    if(!t){ flush(); return; }
    let m;
    if((m=t.match(/^(#{1,6})\s+(.*)$/))){ flush(); out.push(<div key={'h'+(k++)} style={{fontSize:12.5,fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',color:'var(--orange2)',margin:(out.length?'16px':'2px')+' 0 7px'}}>{inline(m[2],'h'+idx)}</div>); return; }
    if((m=t.match(/^[-*•]\s+(.*)$/))){ if(!bullets)bullets=[]; bullets.push(<li key={'li'+(k++)} style={{fontSize:13.5,lineHeight:1.5,color:'rgba(255,255,255,.86)',marginBottom:5}}>{inline(m[1],'li'+idx)}</li>); return; }
    flush(); out.push(<p key={'p'+(k++)} style={{margin:(out.length?'8px':0)+' 0 0',fontSize:13.5,lineHeight:1.55,color:'rgba(255,255,255,.86)'}}>{inline(t,'p'+idx)}</p>);
  });
  flush();
  return out;
}

function saToText(sa){
  if(!sa||typeof sa!=='object') return '';
  const L=[];
  if(sa.headline) L.push(sa.headline);
  if(sa.type==='scenario_analysis'&&Array.isArray(sa.scenarios)){
    sa.scenarios.forEach(x=>{L.push('• '+(x.name||'')+(x.probability?(' ('+x.probability+')'):'')+(x.outcome?(' — '+x.outcome):''));});
  }
  if(Array.isArray(sa.strengths)&&sa.strengths.length) L.push('Strengths: '+sa.strengths.join('; '));
  if(Array.isArray(sa.weaknesses)&&sa.weaknesses.length) L.push('Weaknesses: '+sa.weaknesses.join('; '));
  if(Array.isArray(sa.counterArguments)&&sa.counterArguments.length) L.push('Counter-arguments: '+sa.counterArguments.join('; '));
  if(Array.isArray(sa.riskFactors)&&sa.riskFactors.length) L.push('Risks: '+sa.riskFactors.join('; '));
  if(Array.isArray(sa.recommendations)&&sa.recommendations.length) L.push('Recommendations: '+sa.recommendations.map(r=>(r.action||'')+' '+(r.ticker||'')+(r.reason?(' — '+r.reason):'')).join('; '));
  if(sa.metrics&&typeof sa.metrics==='object'){const m=Object.entries(sa.metrics).map(([k,v])=>k+': '+v);if(m.length)L.push(m.join(' · '));}
  if(sa.bottomLine) L.push('Bottom line: '+sa.bottomLine);
  return L.join('\n\n').trim();
}

function ChartV2({bars,onScrub,tf,onTf}){
  const [kind,setKind]=useState('line');
  const hostRef=useRef(null); const dataRef=useRef(null);
  const G={W:352,pT:20,pH:206,vT:236,vH:30,rPad:38,x0:6};
  const build=useCallback(()=>{
    if(bars&&bars.length){return bars.map(b=>({o:b.o??b.open,c:b.c??b.close,hi:b.h??b.high,lo:b.l??b.low,vol:(b.v??b.volume)||1,dt:new Date(b.t)}));}
    return []; // no synthetic data — real bars or an honest empty state
  },[bars]);
  const fmtD=(d)=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
  const render=useCallback((k)=>{
    const host=hostRef.current; if(!host) return;
    const cs=build(); const N=cs.length;
    host.querySelectorAll('.m2-noc').forEach(e=>e.remove());
    if(!N){ host.querySelectorAll('svg').forEach(e=>e.remove()); const ohh=host.querySelector('.m2-ohlc'); if(ohh)ohh.innerHTML=''; const msg=(bars==null)?'Loading chart…':'Chart data unavailable for this instrument.'; host.insertAdjacentHTML('beforeend','<div class="m2-noc">'+msg+'</div>'); return; }
    const {W,pT,pH,vT,vH,rPad,x0}=G; const x1=W-rPad; const H=vT+vH+18;
    const his=Math.max(...cs.map(d=>d.hi)),los=Math.min(...cs.map(d=>d.lo)); const pd=(his-los)*0.08,mx=his+pd,mn=los-pd;
    const Y=v=>pT+(1-(v-mn)/(mx-mn))*pH; const step=(x1-x0)/N,bw=step*0.6;
    cs.forEach((d,i)=>{d.cx=x0+step*i+step/2;d.yc=Y(d.c);});
    dataRef.current={cs,N,step,x0};
    const maxVol=Math.max(...cs.map(d=>d.vol));
    let s=`<svg id="m2csvg" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="m2ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a00" stop-opacity=".32"/><stop offset="1" stop-color="#ff6a00" stop-opacity="0"/></linearGradient></defs>`;
    for(let g=0;g<=4;g++){const yy=pT+pH*g/4;const val=mx-(mx-mn)*g/4;s+=`<line x1="${x0}" y1="${yy.toFixed(1)}" x2="${x1}" y2="${yy.toFixed(1)}" stroke="rgba(255,255,255,.05)"/><text x="${x1+4}" y="${(yy+3).toFixed(1)}" fill="rgba(255,255,255,.38)" font-size="9" font-family="monospace">${val.toFixed(0)}</text>`;}
    for(let i=0;i<N;i+=11){const d=cs[i];s+=`<text x="${d.cx.toFixed(1)}" y="${(vT+vH+13).toFixed(1)}" fill="rgba(255,255,255,.35)" font-size="8.5" font-family="monospace" text-anchor="middle">${fmtD(d.dt)}</text>`;}
    if(k==='candles'){cs.forEach(d=>{const up=d.c>=d.o;const col=up?'#25d0a0':'#ff5a6a';s+=`<line x1="${d.cx.toFixed(1)}" y1="${Y(d.hi).toFixed(1)}" x2="${d.cx.toFixed(1)}" y2="${Y(d.lo).toFixed(1)}" stroke="${col}"/>`;const yO=Y(d.o),yC=Y(d.c),tp=Math.min(yO,yC),h=Math.max(1.3,Math.abs(yO-yC));s+=`<rect x="${(d.cx-bw/2).toFixed(1)}" y="${tp.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" rx="1"/>`;});}
    else{const pts=cs.map(d=>`${d.cx.toFixed(1)} ${d.yc.toFixed(1)}`);const path='M'+pts.join(' L');if(k==='area')s+=`<path d="${path} L${x1} ${pT+pH} L${x0} ${pT+pH} Z" fill="url(#m2ag)"/>`;s+=`<path d="${path}" fill="none" stroke="#ff8a2a" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>`;}
    const ma=[];for(let i=0;i<N;i++){const kk=Math.max(0,i-9),sg=cs.slice(kk,i+1),m=sg.reduce((a,b)=>a+b.c,0)/sg.length;ma.push(`${cs[i].cx.toFixed(1)} ${Y(m).toFixed(1)}`);}
    s+=`<path d="M${ma.join(' L')}" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.1" stroke-dasharray="3 3"/>`;
    cs.forEach(d=>{const up=d.c>=d.o;const h=(d.vol/maxVol)*vH;s+=`<rect x="${(d.cx-bw/2).toFixed(1)}" y="${(vT+vH-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${up?'rgba(37,208,160,.4)':'rgba(255,90,106,.4)'}" rx="1"/>`;});
    const last=cs[N-1].c;s+=`<line x1="${x0}" y1="${Y(last).toFixed(1)}" x2="${x1}" y2="${Y(last).toFixed(1)}" stroke="#ff8a2a" stroke-dasharray="2 3" opacity=".6"/>`;
    s+=`<g id="m2xh" style="display:none"><line id="m2xv" y1="${pT}" y2="${vT+vH}" stroke="rgba(255,255,255,.4)" stroke-dasharray="3 3"/><circle id="m2xd" r="4" fill="#ff8a2a" stroke="#fff" stroke-width="1.5"/></g></svg>`;
    const oh=host.querySelector('.m2-ohlc');
    host.querySelectorAll('svg').forEach(e=>e.remove());
    host.insertAdjacentHTML('beforeend',s);
    setLegend(cs[N-1]);
    attach();
  },[build,bars]);
  const setLegend=(d)=>{const host=hostRef.current;if(!host)return;const el=host.querySelector('.m2-ohlc');if(!el)return;const up=d.c>=d.o;const col=up?'#25d0a0':'#ff5a6a';el.innerHTML=`<b>${fmtD(d.dt)}</b>O <s>${d.o.toFixed(2)}</s> H <s style="color:#25d0a0">${d.hi.toFixed(2)}</s> L <s style="color:#ff5a6a">${d.lo.toFixed(2)}</s> C <s style="color:${col}">${d.c.toFixed(2)}</s>`;};
  const attach=()=>{const host=hostRef.current;if(!host)return;const svg=host.querySelector('#m2csvg');if(!svg)return;const xh=svg.querySelector('#m2xh');
    const at=(cx)=>{const dd=dataRef.current;if(!dd)return;const r=svg.getBoundingClientRect();let vb=(cx-r.left)/r.width*G.W;let i=Math.round((vb-dd.x0)/dd.step-0.5);i=Math.max(0,Math.min(dd.N-1,i));const d=dd.cs[i];xh.style.display='';svg.querySelector('#m2xv').setAttribute('x1',d.cx);svg.querySelector('#m2xv').setAttribute('x2',d.cx);svg.querySelector('#m2xd').setAttribute('cx',d.cx);svg.querySelector('#m2xd').setAttribute('cy',d.yc);setLegend(d);if(onScrub)onScrub({c:d.c,o:d.o,hi:d.hi,lo:d.lo,dt:d.dt});};
    const mv=(e)=>{e.preventDefault();at(e.touches?e.touches[0].clientX:e.clientX);};
    const end=()=>{xh.style.display='none';const dd=dataRef.current;if(dd)setLegend(dd.cs[dd.N-1]);if(onScrub)onScrub(null);};
    svg.addEventListener('pointerdown',mv);svg.addEventListener('pointermove',(e)=>{if(e.buttons)mv(e);});svg.addEventListener('pointerup',end);svg.addEventListener('pointerleave',end);
    svg.addEventListener('touchstart',mv,{passive:false});svg.addEventListener('touchmove',mv,{passive:false});svg.addEventListener('touchend',end);};
  useEffect(()=>{render(kind);},[kind,render]);
  return (<>
    <div className="m2-ctabs"><div className="m2-cgroup">
      {['line','candles','area'].map(k=>(<button key={k} className={'m2-ct'+(kind===k?' on':'')} onClick={()=>setKind(k)}>{k[0].toUpperCase()+k.slice(1)}</button>))}
    </div><span className="m2-cind">drag to inspect</span></div>
    <div className="m2-charthost" ref={hostRef}><div className="m2-ohlc"></div></div>
    <div className="m2-tf">{['1D','1M','3M','6M','1Y','5Y'].map(t=>(<button key={t} className={'t'+(tf===t?' on':'')} onClick={()=>onTf&&onTf(t)}>{t}</button>))}</div>
  </>);
}

/* ---------- intro ---------- */
function Intro({onDone}){
  const cvRef=useRef(null); const rootRef=useRef(null); const doneRef=useRef(onDone);
  doneRef.current=onDone;
  useEffect(()=>{
    const root=rootRef.current; let raf; let t1,t2;
    try{
      root.querySelector('.m2-iorb').classList.add('go');root.querySelector('.m2-iword').classList.add('go');root.querySelector('.m2-isub').classList.add('go');
      const cv=cvRef.current; const ctx=cv&&cv.getContext('2d');
      if(ctx){const dpr=Math.min(window.devicePixelRatio||1,2);const r=root.getBoundingClientRect();cv.width=r.width*dpr;cv.height=r.height*dpr;ctx.scale(dpr,dpr);
        const cx=r.width/2,cy=r.height/2;let parts=[];let burst=false;const t0=performance.now();
        const loop=(now)=>{const t=(now-t0)/1000;ctx.clearRect(0,0,r.width,r.height);
          if(t<0.6){const p=t/0.6;const rr=2+p*14;const g=ctx.createRadialGradient(cx,cy,0,cx,cy,rr*4);g.addColorStop(0,'rgba(255,180,90,'+(0.9*p)+')');g.addColorStop(.4,'rgba(255,106,0,'+(0.5*p)+')');g.addColorStop(1,'rgba(255,106,0,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,rr*4,0,7);ctx.fill();}
          if(!burst&&t>=0.55){burst=true;for(let i=0;i<110;i++){const a=Math.random()*7;const sp=1.4+Math.random()*4.6;parts.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,rr:1+Math.random()*2.4,life:1});}}
          parts.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=0.965;p.vy*=0.965;p.life-=0.016;if(p.life>0){ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=Math.random()>.4?'#ff9243':'#ffd8a8';ctx.beginPath();ctx.arc(p.x,p.y,p.rr,0,7);ctx.fill();}});
          ctx.globalAlpha=1; if(t<3.0)raf=requestAnimationFrame(loop);
        };
        raf=requestAnimationFrame(loop);
      }
    }catch(e){}
    // Dismissal is driven by fixed timers so a re-render or a canvas error can never leave it stuck.
    t1=setTimeout(()=>{try{root.classList.add('gone');}catch(e){}},2700);
    t2=setTimeout(()=>{const fn=doneRef.current;if(fn)fn();},3400);
    return ()=>{if(raf)cancelAnimationFrame(raf);clearTimeout(t1);clearTimeout(t2);};
  },[]);
  return (<div className="m2-intro" ref={rootRef}><canvas ref={cvRef}></canvas><div className="m2-iorb"></div><div className="m2-iword">PARTICLE</div><div className="m2-isub">MARKET INTELLIGENCE</div></div>);
}

/* ---------- tour ---------- */
const TOUR=[
  {tab:'term',ti:'YOUR MARKETS',h:'The Terminal',p:'Your multi-asset command center — watchlist, FX, commodities, countries, credit and your morning brief. Tap any name for the in-depth view.'},
  {tab:'ai',ti:'ASK ANYTHING',h:'Particle AI',p:'Ask about any market or position. Answers are grounded in live data and your own research vault, always with sources.'},
  {tab:'vault',ti:'YOUR RESEARCH',h:'The Vault',p:'Every note, PDF and model you save — private and searchable. Particle reads it all to answer you.'},
];
function Tour({tabRefs,onEnd}){
  const [si,setSi]=useState(0); const [box,setBox]=useState(null);
  useEffect(()=>{const el=tabRefs.current[TOUR[si].tab];if(el){const r=el.getBoundingClientRect();setBox({left:r.left-8,top:r.top-8,w:r.width+16,h:r.height+16,cardBottom:window.innerHeight-r.top+16});}},[si,tabRefs]);
  if(!box)return null;
  return (<div className="m2-tour">
    <div className="m2-tourdim"></div>
    <div className="m2-spot" style={{left:box.left,top:box.top,width:box.w,height:box.h}}></div>
    <button className="m2-tskip" onClick={onEnd}>Skip</button>
    <div className="m2-tcard" style={{bottom:box.cardBottom}}>
      <div className="ti">{TOUR[si].ti}</div><h4>{TOUR[si].h}</h4><p>{TOUR[si].p}</p>
      <div className="m2-tnav"><div className="m2-dots">{TOUR.map((_,i)=>(<i key={i} className={i===si?'on':''}/>))}</div>
      <button className="m2-tnext" onClick={()=>{si<TOUR.length-1?setSi(si+1):onEnd();}}>{si===TOUR.length-1?'Done':'Next'}</button></div>
    </div>
  </div>);
}

function DetailView({sym,quote,name,fmtP,fmtC,cls,onClose,onAsk,watching,onToggleWatch}){
  const [bars,setBars]=useState(null);
  const [funds,setFunds]=useState(null);
  const [logo,setLogo]=useState(null);
  const [prof,setProf]=useState(null);
  const [scrub,setScrub]=useState(null);
  const [tf,setTf]=useState('1M');
  const TFMAP={'1D':{mult:5,span:'minute',days:1,label:'1 day'},'1M':{mult:1,span:'day',days:31,label:'1 month'},'3M':{mult:1,span:'day',days:93,label:'3 months'},'6M':{mult:1,span:'day',days:186,label:'6 months'},'1Y':{mult:1,span:'day',days:372,label:'1 year'},'5Y':{mult:1,span:'week',days:1830,label:'5 years'}};
  const FXSET=new Set(['EURUSD','USDBRL','USDJPY','GBPUSD','USDCAD','AUDUSD','USDCHF','USDMXN','USDCNY']);
  const CRYSET=new Set(['BTCUSD','ETHUSD','SOLUSD','BNBUSD','XRPUSD','ADAUSD','DOGEUSD']);
  const equityish=/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(sym)&&!FXSET.has(sym)&&!CRYSET.has(sym);
  const DESC={SPY:'SPDR S&P 500 ETF — tracks the 500 largest US companies.',QQQ:'Invesco QQQ — tracks the tech-heavy Nasdaq-100.',DIA:'SPDR Dow Jones ETF — 30 US blue-chip industrials.',IWM:'iShares Russell 2000 — US small-cap equities.',EWZ:'iShares MSCI Brazil ETF — Brazilian large caps (Ibovespa proxy).',EFA:'iShares MSCI EAFE — developed markets ex-US & Canada.',EWJ:'iShares MSCI Japan — Japanese equities.',EEM:'iShares MSCI Emerging Markets.',FXI:'iShares China Large-Cap.',GLD:'SPDR Gold Shares — tracks spot gold bullion.',SLV:'iShares Silver Trust — tracks spot silver.',USO:'United States Oil Fund — tracks WTI crude futures.',UNG:'US Natural Gas Fund — tracks Henry Hub gas futures.',CORN:'Teucrium Corn Fund — corn futures.',CPER:'US Copper Index Fund.',BTCUSD:'Bitcoin — the largest cryptocurrency by market value.',ETHUSD:'Ethereum — smart-contract blockchain, 2nd-largest crypto.',SOLUSD:'Solana — high-throughput layer-1 crypto.',EURUSD:'Euro vs US Dollar — the world\'s most-traded FX pair.',USDBRL:'US Dollar vs Brazilian Real.',USDJPY:'US Dollar vs Japanese Yen.',GBPUSD:'British Pound vs US Dollar.'};
  useEffect(()=>{let m=true;
    setFunds(null);setLogo(null);setProf(null);setScrub(null);setTf('1M');
    apiFetch(`/api/fundamentals/${encodeURIComponent(sym)}`).then(r=>r&&r.ok?r.json():null).then(d=>{if(m)setFunds(d);}).catch(()=>{});
    if(equityish){
      apiFetch(`/api/market/td/logo/${encodeURIComponent(sym)}`).then(r=>r&&r.ok?r.json():null).then(d=>{if(m&&d&&d.url)setLogo(d.url);}).catch(()=>{});
      apiFetch(`/api/market/td/profile/${encodeURIComponent(sym)}`).then(r=>r&&r.ok?r.json():null).then(d=>{if(m&&d&&d.data)setProf(d.data);}).catch(()=>{});
    }
    return()=>{m=false;};},[sym]);
  useEffect(()=>{let m=true;const cfg=TFMAP[tf]||TFMAP['1M'];const ds=d=>d.toISOString().slice(0,10);const to=new Date();const from=new Date(Date.now()-cfg.days*864e5);
    setBars(null);
    apiFetch(`/api/chart/${encodeURIComponent(sym)}?multiplier=${cfg.mult}&timespan=${cfg.span}&from=${ds(from)}&to=${ds(to)}`).then(r=>r&&r.ok?r.json():null).then(d=>{if(m)setBars(d&&Array.isArray(d.results)?d.results:[]);}).catch(()=>{if(m)setBars([]);});
    return()=>{m=false;};},[sym,tf]);
  const _lb=bars&&bars.length?bars[bars.length-1]:null, _pb=bars&&bars.length>1?bars[bars.length-2]:null;
  const _lbc=_lb?(_lb.c??_lb.close):null, _pbc=_pb?(_pb.c??_pb.close):null;
  const price=(quote&&quote.price!=null)?quote.price:_lbc;
  const chg=(quote&&quote.changePct!=null)?quote.changePct:((_lbc!=null&&_pbc)?((_lbc-_pbc)/_pbc*100):null);
  const fmtBig=(v)=>{if(v==null)return '—';const a=Math.abs(v);if(a>=1e12)return (v/1e12).toFixed(2)+'T';if(a>=1e9)return (v/1e9).toFixed(2)+'B';if(a>=1e6)return (v/1e6).toFixed(1)+'M';return v.toLocaleString();};
  const gv=(...ks)=>{if(!funds)return null;for(const k of ks){if(funds[k]!=null)return funds[k];}return null;};
  const mc=gv('market_cap','marketCap'),pe=gv('pe_ratio','peRatio','pe'),eps=gv('eps'),beta=gv('beta'),dvd=gv('dividend_yield','dividend','dividendYield'),rev=gv('revenue','total_revenue');
  const lows=bars&&bars.length?Math.min(...bars.map(b=>b.l??b.low)):null,highs=bars&&bars.length?Math.max(...bars.map(b=>b.h??b.high)):null;
  const pos=(price!=null&&lows!=null&&highs!=null&&highs>lows)?Math.max(0,Math.min(100,((price-lows)/(highs-lows))*100)):50;
  const F=[['Mkt cap',fmtBig(mc)],['P/E',pe!=null?(+pe).toFixed(1):'—'],['EPS',eps!=null?(+eps).toFixed(2):'—'],['Div yield',dvd!=null?(+dvd).toFixed(2)+'%':'—'],['Beta',beta!=null?(+beta).toFixed(2):'—'],['Revenue',fmtBig(rev)]];
  const fmtD=(d)=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
  const desc=(prof&&prof.description)?prof.description:(DESC[sym]||'');
  const descShort=desc&&desc.length>210?desc.slice(0,207).trim()+'…':desc;
  const metaBits=[prof&&prof.sector,prof&&prof.industry,prof&&(prof.exchange||prof.mic_code)].filter(Boolean);
  const initials=(name||sym).replace(/[^A-Za-z0-9]/g,'').slice(0,3).toUpperCase();
  return (
    <div className="m2-screen">
      <div className="m2-dhead">
        <button className="m2-back" onClick={onClose}><I d={icons.back} w={18}/></button>
        <div className="m2-dlogo">{logo? <img src={logo} alt="" onError={e=>{e.target.style.display='none';}}/> : <span>{initials}</span>}</div>
        <div className="m2-dtitle"><b>{name}</b><br/><span>{sym} · {equityish?'live':(CRYSET.has(sym)?'crypto · live':(FXSET.has(sym)?'FX · live':'live'))}</span></div>
        <button className={"m2-star"+(watching?" on":"")} onClick={(e)=>{e.stopPropagation();onToggleWatch&&onToggleWatch(sym);}}><I d={icons.star} w={18}/></button>
      </div>
      <div className="m2-dprice">
        <div className="v">{scrub? fmtP(scrub.c) : (price!=null?fmtP(price):'—')}</div>
        {scrub ? (
          <div className="m2-scrub"><b>{fmtD(scrub.dt)}</b> O {scrub.o.toFixed(2)} · H <s style={{color:'#25d0a0'}}>{scrub.hi.toFixed(2)}</s> · L <s style={{color:'#ff5a6a'}}>{scrub.lo.toFixed(2)}</s> · C {scrub.c.toFixed(2)}</div>
        ) : (chg!=null&&(<div className="c" style={{color:chg<0?'#ff5a6a':'#25d0a0',background:chg<0?'rgba(255,90,106,.12)':'rgba(37,208,160,.12)',borderColor:'transparent'}}><I d={icons.up} w={12}/>{fmtC(chg)}</div>))}
      </div>
      <ChartV2 bars={bars} onScrub={setScrub} tf={tf} onTf={setTf}/>
      {lows!=null&&(<div className="m2-range"><div className="rt">Range · {(TFMAP[tf]||{}).label||tf}</div><div className="rl"><span>{fmtP(lows)}</span><span>{fmtP(highs)}</span></div><div className="m2-bar"><i style={{left:pos+'%'}}></i></div></div>)}
      {(descShort||metaBits.length>0)&&(<div className="m2-about"><h3>About</h3>{metaBits.length>0&&(<div className="m2-metarow">{metaBits.map((b,i)=>(<span key={i}>{b}</span>))}</div>)}{descShort&&<p>{descShort}</p>}</div>)}
      <div className="m2-sec"><h3>Fundamentals</h3><a>{funds?'live':(bars?'—':'loading…')}</a></div>
      <div className="m2-fgrid">{F.map(x=>(<div className="m2-fg" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b></div>))}</div>
      <div className="m2-aitake" onClick={()=>onAsk(sym,name)} style={{cursor:'pointer'}}><div className="h"><span className="o2"></span>Particle AI take</div><p style={{display:'flex',alignItems:'center',gap:6}}>Ask Particle for a full view on {name} — valuation, momentum and risks <I d={icons.chev} w={14}/></p></div>
    </div>
  );
}

/* ---------- Morning Brief card: ambient particles + pressable orb ---------- */
function BriefCard({label,onOpen}){
  const wrapRef=useRef(null); const cvRef=useRef(null);
  const S=useRef({parts:[],bparts:[],orb:{x:0,y:0,r:24},raf:0,fired:false});
  useEffect(()=>{
    const wrap=wrapRef.current, cv=cvRef.current; if(!wrap||!cv) return;
    const ctx=cv.getContext('2d'); if(!ctx) return;
    const dpr=Math.min(window.devicePixelRatio||1,2); let W=0,H=0;
    const st=S.current;
    const size=()=>{const r=wrap.getBoundingClientRect();W=r.width;H=r.height;if(!W||!H)return;cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
      st.orb={x:W-54,y:H/2,r:24};
      if(!st.parts.length){for(let i=0;i<24;i++)st.parts.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-0.5)*0.22,vy:(Math.random()-0.5)*0.22,r:0.6+Math.random()*1.7,a:0.12+Math.random()*0.4,o:Math.random()>0.4});}
    };
    size();
    let ro; try{ro=new ResizeObserver(size);ro.observe(wrap);}catch(e){}
    const loop=(now)=>{
      if(!W||!H){size();}
      const orb=st.orb; const pulse=0.5+0.5*Math.sin(now/720);
      ctx.clearRect(0,0,W,H);
      // orb glow halo
      const g=ctx.createRadialGradient(orb.x,orb.y,0,orb.x,orb.y,orb.r*2.8);
      g.addColorStop(0,'rgba(255,190,110,.85)');g.addColorStop(.34,'rgba(255,106,0,'+(0.5+0.22*pulse)+')');g.addColorStop(1,'rgba(255,106,0,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(orb.x,orb.y,orb.r*2.8,0,7);ctx.fill();
      // ambient particles drifting, faint attraction to the orb
      st.parts.forEach(p=>{const dx=orb.x-p.x,dy=orb.y-p.y,d=Math.hypot(dx,dy)||1;p.vx+=(dx/d)*0.006;p.vy+=(dy/d)*0.006;p.vx*=0.98;p.vy*=0.98;p.x+=p.vx;p.y+=p.vy;
        if(p.x<-4)p.x=W+4;if(p.x>W+4)p.x=-4;if(p.y<-4)p.y=H+4;if(p.y>H+4)p.y=-4;
        ctx.globalAlpha=p.a*(0.55+0.45*pulse);ctx.fillStyle=p.o?'#ff9a4d':'#ffe3c2';ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,7);ctx.fill();});
      ctx.globalAlpha=1;
      // orb core
      const c=ctx.createRadialGradient(orb.x-orb.r*0.32,orb.y-orb.r*0.32,1,orb.x,orb.y,orb.r*(1+0.04*pulse));
      c.addColorStop(0,'#fff');c.addColorStop(.16,'#ffd8a8');c.addColorStop(.62,'#ff8a2a');c.addColorStop(1,'#ff5a00');
      ctx.fillStyle=c;ctx.beginPath();ctx.arc(orb.x,orb.y,orb.r*(1+0.04*pulse),0,7);ctx.fill();
      // burst
      if(st.bparts.length){st.bparts.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=0.93;p.vy*=0.93;p.life-=0.022;if(p.life>0){ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=p.o?'#ff9a4d':'#ffd8a8';ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,7);ctx.fill();}});st.bparts=st.bparts.filter(p=>p.life>0);ctx.globalAlpha=1;}
      st.raf=requestAnimationFrame(loop);
    };
    st.raf=requestAnimationFrame(loop);
    return ()=>{cancelAnimationFrame(st.raf);if(ro)try{ro.disconnect();}catch(e){}};
  },[]);
  const press=()=>{const st=S.current;if(st.fired)return;st.fired=true;const orb=st.orb;
    for(let i=0;i<64;i++){const a=Math.random()*7,sp=1+Math.random()*4.4;st.bparts.push({x:orb.x,y:orb.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r:1+Math.random()*2.2,life:1,o:Math.random()>0.4});}
    setTimeout(()=>{st.fired=false;onOpen&&onOpen();},430);};
  return (<button className="m2-briefcard" ref={wrapRef} onClick={press}>
    <canvas ref={cvRef} className="m2-briefcv"></canvas>
    <div className="m2-briefinner">
      <span className="lbl">MORNING BRIEF</span>
      <p>{label}</p>
      <span className="go">Tap the particle to open <I d={icons.arrow} w={13}/></span>
    </div>
  </button>);
}

export default function MobileAppV2(){
  const [tab,setTab]=useState('term');
  const [detail,setDetail]=useState(null);
  const [detailName,setDetailName]=useState(null);
  const [intro,setIntro]=useState(true);
  const [tour,setTour]=useState(false);
  const tabRefs=useRef({});
  const go=(t)=>{setDetail(null);setTab(t);const sc=document.querySelector('.m2-screen');if(sc)sc.scrollTop=0;};
  const endIntro=()=>{setIntro(false);let seen=false;try{seen=localStorage.getItem('m2tour')==='1';}catch(e){}if(!seen)setTimeout(()=>setTour(true),250);};
  const endTour=()=>{setTour(false);try{localStorage.setItem('m2tour','1');}catch(e){}};

  const { data } = useMarketData();
  const { watchlist, addTicker, removeTicker, isWatching } = useWatchlist();
  const look=(sym)=>data?.stocks?.[sym]||data?.forex?.[sym]||data?.crypto?.[sym]||data?.indices?.[sym]||null;
  const NAMES={SPY:'S&P 500',QQQ:'Nasdaq 100',DIA:'Dow Jones',IWM:'Russell 2000',EWZ:'Ibovespa',EFA:'EAFE',EWJ:'Japan',EEM:'Emerging Mkts',FXI:'China',AAPL:'Apple',NVDA:'Nvidia',MSFT:'Microsoft',TSLA:'Tesla',AMZN:'Amazon',GOOGL:'Alphabet',META:'Meta',GLD:'Gold',SLV:'Silver',USO:'WTI crude',UNG:'Nat gas',CORN:'Corn',CPER:'Copper',EURUSD:'EUR / USD',USDBRL:'USD / BRL',USDJPY:'USD / JPY',GBPUSD:'GBP / USD',BTCUSD:'Bitcoin',ETHUSD:'Ethereum',SOLUSD:'Solana',VALE:'Vale',PBR:'Petrobras','GC=F':'Gold','CL=F':'WTI Crude','SI=F':'Silver','NG=F':'Nat Gas','HG=F':'Copper','BZ=F':'Brent','ZC=F':'Corn','ES=F':'S&P Futures'};
  const fmtP=(v)=>{if(v==null)return '—';const a=Math.abs(v);if(a>=1000)return v.toLocaleString('en-US',{maximumFractionDigits:0});if(a>=10)return v.toFixed(2);return v.toFixed(4);};
  const fmtC=(c)=>c==null?'—':(c>=0?'+':'')+c.toFixed(2)+'%';
  const tkBadge=(sym)=>{const b=(sym||'').split(/[=.]/)[0].replace(/USD$/,'');return (b||sym||'').slice(0,4).toUpperCase();};
  const cls=(c)=>c==null?'m2-flat':(c>0?'m2-u':c<0?'m2-d':'m2-flat');
  const PULSE=[['SPY','S&P 500'],['QQQ','Nasdaq'],['EWZ','Ibovespa'],['EFA','EAFE'],['EWJ','Japan']];
  const FX=[['EURUSD','EUR / USD'],['USDBRL','USD / BRL'],['USDJPY','USD / JPY'],['GBPUSD','GBP / USD']];
  const COMM=[['GLD','Gold'],['USO','WTI crude'],['SLV','Silver'],['UNG','Nat gas'],['CORN','Corn']];
  const wl=((watchlist&&watchlist.length)?watchlist:['SPY','QQQ','AAPL','NVDA','GLD','BTCUSD','EWZ']).slice(0,8);
  const [vaultDocs,setVaultDocs]=useState(null);
  useEffect(()=>{let m=true;apiFetch('/api/vault/documents').then(r=>r&&r.ok?r.json():null).then(d=>{if(m&&d&&Array.isArray(d.documents))setVaultDocs(d.documents);}).catch(()=>{});return()=>{m=false;};},[]);
  const relTime=(iso)=>{if(!iso)return '';const t=(Date.now()-new Date(iso).getTime())/1000;if(t<3600)return Math.max(1,Math.round(t/60))+'m ago';if(t<86400)return Math.round(t/3600)+'h ago';return Math.round(t/86400)+'d ago';};
  const docTitle=(f)=>f?f.replace(/\.[^.]+$/,''):'Untitled';
  const docType=(f)=>{const m=/\.([^.]+)$/.exec(f||'');return m?m[1].toUpperCase():'DOC';};
  const chat=useParticleChat();
  const [q,setQ]=useState('');
  const chatEndRef=useRef(null);
  const submitAI=()=>{const t=q.trim();if(!t||chat.isStreaming)return;chat.send(t);setQ('');};
  const askAI=(sym,name)=>{setDetail(null);setTab('ai');chat.send('Give me your full view on '+(name||sym)+' ('+sym+') — valuation, momentum and key risks.');};
  useEffect(()=>{if(tab==='ai'&&chatEndRef.current)chatEndRef.current.scrollIntoView({block:'end'});},[chat.messages,tab]);
  const SUGG=["What's moving my watchlist today?","Summarise the macro picture","Any risks I should watch?"];
  const [curves,setCurves]=useState(null);
  const [greeting,setGreeting]=useState(null);
  useEffect(()=>{let m=true;
    apiFetch('/api/yield-curves').then(r=>r&&r.ok?r.json():null).then(d=>{if(m&&d&&!d.error)setCurves(d);}).catch(()=>{});
    apiFetch('/api/brief/greeting').then(r=>r&&r.ok?r.json():null).then(d=>{if(m&&d&&d.ok&&d.greeting)setGreeting(d.greeting);}).catch(()=>{});
    apiFetch('/api/brief/').then(r=>r&&r.ok?r.json():null).then(d=>{if(!m)return;if(d&&d.data)setBrief(d.data);else if(d&&d.ok===false)setBrief({__pending:d.message||'Your brief is being prepared.'});else setBrief({__pending:'Brief unavailable right now.'});}).catch(()=>{if(m)setBrief({__pending:'Brief unavailable right now.'});}).finally(()=>{if(m)setBriefLoading(false);});
    return()=>{m=false;};},[]);
  const y10=(cc)=>{const c=curves&&curves[cc]&&curves[cc].curve;const p=c&&c.find(x=>x.tenor==='10Y');return p?(p.rate!=null?p.rate:(p.yield!=null?p.yield:null)):null;};
  const CTRY=[{name:'United States',risk:'lo',eq:'SPY',cc:'US',fx:null},{name:'Brazil',risk:'md',eq:'EWZ',cc:'BR',fx:'USDBRL'},{name:'Eurozone',risk:'lo',eq:'EFA',cc:'EU',fx:'EURUSD'}];

  // ── Navigation: open in-depth for any symbol (search results carry C:/X:/I: prefixes) ──
  const normSym=(x)=>String(x||'').replace(/^[A-Z]:/,'').replace(/[\s]/g,'').toUpperCase();
  const openDetail=(x,nm)=>{const sym=normSym(x);if(!sym)return;setDetailName(nm||null);setDetail(sym);setTab('term');setShowSearch(false);const sc=document.querySelector('.m2-screen');if(sc)sc.scrollTop=0;};

  // ── Universal search (same registry the desktop uses) ──
  const [showSearch,setShowSearch]=useState(false);
  const [sq,setSq]=useState('');
  const [sres,setSres]=useState([]);
  const [sloading,setSloading]=useState(false);
  const searchAbort=useRef(null);
  useEffect(()=>{
    if(!showSearch)return;
    const t=setTimeout(()=>{
      const qq=sq.trim();
      if(qq.length<1){setSres([]);setSloading(false);return;}
      setSloading(true);
      if(searchAbort.current)searchAbort.current.abort();
      const ac=new AbortController();searchAbort.current=ac;
      apiFetch(`/api/instruments/search?q=${encodeURIComponent(qq)}&limit=25&noPolygon=1`,{signal:ac.signal})
        .then(r=>r&&r.ok?r.json():null).then(d=>{if(!ac.signal.aborted)setSres((d&&d.results)||[]);}).catch(()=>{}).finally(()=>{if(!ac.signal.aborted)setSloading(false);});
    },220);
    return ()=>clearTimeout(t);
  },[sq,showSearch]);

  // ── Morning brief (full content) ──
  const [showBrief,setShowBrief]=useState(false);
  const [brief,setBrief]=useState(null);
  const [briefLoading,setBriefLoading]=useState(true);
  const openBrief=()=>setShowBrief(true);

  // ── Watchlist classification + grouping (mirrors desktop's asset-class order) ──
  const classify=(x)=>{const u=(x||'').toUpperCase();
    const IDX=new Set(['SPY','QQQ','DIA','IWM','EWZ','EFA','EWJ','EEM','FXI','VTI','VOO','IVV','ACWI','AGG','TLT']);
    const COMMS=new Set(['GLD','SLV','USO','UNG','CORN','CPER','WEAT','SOYB','PALL','PPLT','DBA','DBC','USG','UGA']);
    if(/^(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|DOT|MATIC|LTC|LINK|TRX)USD$/.test(u))return 'Crypto';
    if(u.length===6&&/^[A-Z]{6}$/.test(u)&&/(USD|BRL|JPY|EUR|GBP|CHF|CAD|AUD|CNY|MXN|SEK|NOK)$/.test(u))return 'FX';
    if(/=F$/.test(u))return 'Commodities';
    if(COMMS.has(u))return 'Commodities';
    if(IDX.has(u))return 'Indices & ETFs';
    return 'Equities';
  };
  const WL_ORDER=['Indices & ETFs','Equities','FX','Commodities','Crypto'];
  const wlFull=(watchlist&&watchlist.length)?watchlist:['SPY','QQQ','AAPL','NVDA','GLD','BTCUSD','EWZ'];
  const wlGroups=(()=>{const g={};wlFull.forEach(s=>{const k=classify(s);(g[k]=g[k]||[]).push(s);});return WL_ORDER.filter(k=>g[k]&&g[k].length).map(k=>[k,g[k]]);})();


  const _goodGreeting=(greeting&&!/loading|prepar/i.test(greeting))?greeting:null;
  const briefPreview=(brief&&brief.oneThing)?brief.oneThing:(_goodGreeting||'Your market brief is ready — tap to open.');

  return (
    <div className="m2-root">
      <div className="m2-aura"><b className="a1"></b><b className="a2"></b></div>
      <div className="m2-tex"></div>

      {/* TERMINAL */}
      {tab==='term' && !detail && (
        <div className="m2-screen">
          <div className="m2-top"><div className="m2-av"></div>
            <button className="m2-search" onClick={()=>{setShowSearch(true);setSq('');setSres([]);}}><I d={icons.search} w={15}/>Search any market or ticker…</button>
          </div>
          <div className="m2-h1">Terminal</div>
          <div className="m2-sub"><span className="m2-dot"></span>Live · {new Date().toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})}</div>
          <BriefCard label={briefPreview} onOpen={openBrief}/>
          <div className="m2-sec"><h3>Global pulse</h3></div>
          <div className="m2-strip">
            {PULSE.map(([sym,label])=>{const q=look(sym);return (
              <button className="m2-chip" key={sym} onClick={()=>openDetail(sym,label)}><div className="n">{label}</div><div className="v">{fmtP(q&&q.price)}</div><div className={'c '+cls(q&&q.changePct)}>{fmtC(q&&q.changePct)}</div></button>);})}
          </div>
          <div className="m2-sec"><h3>Watchlist</h3></div>
          <div className="m2-card">
            {wlGroups.flatMap(([grp,syms])=>[
              <div className="m2-wlgrp2" key={'g-'+grp}>{grp}</div>,
              ...syms.map(sym=>{const q=look(sym);const nm=NAMES[sym]||sym;return (
                <div className="m2-row" key={sym} onClick={()=>openDetail(sym,nm)}>
                  <div className="m2-tk">{tkBadge(sym)}</div><div className="nm"><b>{nm}</b>{nm!==sym&&(<span>{sym}</span>)}</div>
                  <div className="pr"><b>{fmtP(q&&q.price)}</b><small className={cls(q&&q.changePct)}>{fmtC(q&&q.changePct)}</small></div><span className="m2-chev"><I d={icons.chev} w={15}/></span>
                </div>);})
            ])}
          </div>
          <div className="m2-sec"><h3>FX</h3></div>
          <div className="m2-g2">
            {FX.map(([sym,label])=>{const q=data&&data.forex&&data.forex[sym];return (
              <button className="m2-cell" key={sym} onClick={()=>openDetail(sym,label)}><div className="n">{label}</div><div className="v">{fmtP(q&&q.price)}</div><div className={'c '+cls(q&&q.changePct)}>{fmtC(q&&q.changePct)}</div></button>);})}
          </div>
          <div className="m2-sec"><h3>Commodities</h3></div>
          <div className="m2-strip">
            {COMM.map(([sym,label])=>{const q=data&&data.stocks&&data.stocks[sym];return (
              <button className="m2-chip" key={sym} onClick={()=>openDetail(sym,label)}><div className="n">{label}</div><div className="v">{fmtP(q&&q.price)}</div><div className={'c '+cls(q&&q.changePct)}>{fmtC(q&&q.changePct)}</div></button>);})}
          </div>
          <div className="m2-sec"><h3>Countries</h3></div>
          <div className="m2-strip">
            {CTRY.map(c=>{const eq=look(c.eq);const yy=y10(c.cc);const fx=c.fx?(data&&data.forex&&data.forex[c.fx]):null;return (
              <button className="m2-cty" key={c.name} onClick={()=>openDetail(c.eq,c.name)}>
                <div className="ch"><span className="cn">{c.name}</span><span className={'risk '+c.risk}>{c.risk==='lo'?'RISK LOW':'RISK MED'}</span></div>
                <div className="kv"><span>Equity</span><b className={cls(eq&&eq.changePct)}>{fmtC(eq&&eq.changePct)}</b></div>
                <div className="kv"><span>10Y</span><b>{yy!=null?yy.toFixed(2)+'%':'—'}</b></div>
                {c.fx&&(<div className="kv"><span>{c.fx.slice(0,3)}/{c.fx.slice(3)}</span><b className={cls(fx&&fx.changePct)}>{fmtP(fx&&fx.price)}</b></div>)}
              </button>);})}
          </div>
        </div>
      )}

      {/* DETAIL */}
      {detail && (<DetailView sym={detail} quote={look(detail)} name={detailName||NAMES[detail]||detail} fmtP={fmtP} fmtC={fmtC} cls={cls} onClose={()=>setDetail(null)} onAsk={askAI} watching={isWatching&&isWatching(detail)} onToggleWatch={(sy)=>{if(!isWatching)return; isWatching(sy)?removeTicker(sy):addTicker(sy);}}/>)}

      {/* PARTICLE AI */}
      {tab==='ai' && !detail && (<>
        <div className="m2-screen">
          <div style={{height:'8px'}}></div>
          <div className="m2-aihead"><div className="m2-orb"></div><div><b>Particle AI</b><br/><span><span className="m2-dot"></span>Grounded in markets + your vault</span></div></div>
          {chat.messages.length===0 ? (
            <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:'0 32px',gap:14}}>
              <div className="m2-orb" style={{width:58,height:58}}></div>
              <div style={{fontSize:18,fontWeight:600}}>Ask Particle anything</div>
              <div style={{fontSize:13,color:'var(--mut)',lineHeight:1.5}}>Grounded in live markets and your research vault — always with sources.</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8,justifyContent:'center',marginTop:4}}>
                {SUGG.map(p=>(<button key={p} onClick={()=>chat.send(p)} style={{background:'rgba(255,255,255,.07)',border:'1px solid rgba(255,255,255,.09)',borderRadius:14,padding:'9px 13px',fontSize:12.5,color:'#fff',fontFamily:'inherit'}}>{p}</button>))}
              </div>
            </div>
          ) : (
            <div className="m2-chat">
              {chat.messages.map((m,i)=>(
                <div key={i} className={'m2-msg '+(m.role==='user'?'me':'ai')}>
                  {(()=>{
                    if(m.role!=='assistant') return m.content;
                    if(m.streaming&&!m.content) return <span style={{color:'var(--mut)'}}>Particle is thinking…</span>;
                    if((m.content||'').trim()) return renderRich(m.content);
                    const sa=saToText(m.structuredAnalysis);
                    if(sa) return sa;
                    const prevUser=[...chat.messages.slice(0,i)].reverse().find(x=>x.role==='user');
                    return (<span style={{color:'var(--mut)'}}>{m.partialError||'That one came back empty.'}{prevUser? <> · <a onClick={()=>chat.send(prevUser.content)} style={{color:'#ff8a2a',cursor:'pointer',fontWeight:600}}>retry</a></> : null}</span>);
                  })()}
                  {m.role==='assistant'&&!m.streaming&&m.vaultSources&&m.vaultSources.length>0 && (<div className="m2-cite"><I d={icons.cite} w={12}/>{m.vaultSources.length} vault source{m.vaultSources.length>1?'s':''}</div>)}
                </div>))}
              <div ref={chatEndRef}></div>
            </div>
          )}
        </div>
        <div className="m2-composer"><div className="m2-cbox"><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submitAI();}} placeholder="Ask Particle anything…"/><button className="m2-send" onClick={submitAI}><I d={icons.send} w={18}/></button></div></div>
      </>)}

      {/* VAULT */}
      {tab==='vault' && !detail && (
        <div className="m2-screen">
          <div className="m2-h1" style={{paddingTop:'6px'}}>Vault</div>
          <div className="m2-sub">Your private research · {vaultDocs?vaultDocs.length:0} document{(vaultDocs&&vaultDocs.length===1)?'':'s'}</div>
          <button className="m2-askvault" onClick={()=>go('ai')} style={{width:'100%',textAlign:'left',fontFamily:'inherit',cursor:'pointer'}}><b>Ask your vault <I d={icons.arrow} w={13}/></b><p>Particle searches every document you’ve saved and answers with citations. Tap to ask.</p></button>
          <div className="m2-sec"><h3>Recent</h3><a>All</a></div>
          {(vaultDocs&&vaultDocs.length?vaultDocs.slice(0,10):[]).map(doc=>(
            <div className="m2-vcard" key={doc.id}><div className="m2-vico"><I d={icons.doc} w={19}/></div><div className="nm"><b>{docTitle(doc.filename)}</b><span>{docType(doc.filename)}{doc.chunk_count?(' · '+doc.chunk_count+' chunks'):''} · {relTime(doc.created_at)}</span></div></div>))}
          {vaultDocs&&!vaultDocs.length && (<div className="m2-vcard"><div className="nm"><b>No documents yet</b><span>Email or upload research to build your vault</span></div></div>)}
          {!vaultDocs && (<div className="m2-vcard"><div className="nm"><span>Loading your vault…</span></div></div>)}
        </div>
      )}

      {/* SEARCH OVERLAY */}
      {showSearch && (
        <div className="m2-searchov">
          <div className="m2-searchbar">
            <I d={icons.search} w={16}/>
            <input autoFocus value={sq} onChange={e=>setSq(e.target.value)} placeholder="Ticker, company, FX, crypto…" onKeyDown={e=>{if(e.key==='Enter'&&sres[0])openDetail(sres[0].symbol||sres[0].symbolKey,sres[0].name);}}/>
            <button className="m2-scancel" onClick={()=>setShowSearch(false)}>Cancel</button>
          </div>
          <div className="m2-sresults">
            {sloading && sres.length===0 && <div className="m2-sempty">Searching…</div>}
            {!sloading && sq.trim().length>0 && sres.length===0 && <div className="m2-sempty">No matches for “{sq.trim()}”.</div>}
            {sq.trim().length===0 && <div className="m2-sempty">Search stocks, ETFs, FX, crypto and indices across every market we cover.</div>}
            {sres.map((r,i)=>{const sym=normSym(r.symbol||r.symbolKey);const ac=(r.assetClass||r.type||'').toString().replace(/_/g,' ');return (
              <button className="m2-sitem" key={(r.symbolKey||r.symbol||'')+i} onClick={()=>openDetail(r.symbol||r.symbolKey,r.name)}>
                <div className="m2-stk">{tkBadge(sym)}</div>
                <div className="m2-sinfo"><b>{r.name||sym}</b><span>{sym}{ac?(' · '+ac):''}</span></div>
                <span className="m2-chev"><I d={icons.chev} w={15}/></span>
              </button>);})}
          </div>
        </div>
      )}

      {/* BRIEF OVERLAY */}
      {showBrief && (
        <div className="m2-briefov">
          <div className="m2-dhead" style={{paddingTop:'max(12px,env(safe-area-inset-top))'}}>
            <button className="m2-back" onClick={()=>setShowBrief(false)}><I d={icons.back} w={18}/></button>
            <div className="m2-dtitle"><b>Morning Brief</b><br/><span>{brief&&brief.__pending?'Preparing…':'Today · grounded in live data'}</span></div>
          </div>
          <div className="m2-bovbody">
            {briefLoading && <div className="m2-sempty">Loading your brief…</div>}
            {!briefLoading && brief && brief.__pending && <div className="m2-sempty">{brief.__pending}</div>}
            {!briefLoading && brief && !brief.__pending && (<>
              {brief.oneThing && (<div className="m2-bone"><span className="lbl">The one thing</span><p>{brief.oneThing}</p></div>)}
              {Array.isArray(brief.buckets)&&brief.buckets.map((bk,bi)=>(
                <div key={bi} className="m2-bsec"><h3>{bk.name}</h3>
                  {(bk.items||[]).map((it,ii)=>(
                    <div key={ii} className="m2-bitem" onClick={()=>it.symbol&&openDetail(it.symbol,it.symbol)} style={it.symbol?{cursor:'pointer'}:undefined}>
                      {it.symbol&&<b>{it.symbol}</b>}<span>{it.line||it.text||''}</span>
                    </div>))}
                </div>))}
              {Array.isArray(brief.macro)&&brief.macro.length>0&&(<div className="m2-bsec"><h3>Macro</h3>{brief.macro.map((m,mi)=>(<div key={mi} className="m2-bitem"><b>{m.label}</b><span>{m.line||''}</span></div>))}</div>)}
              {Array.isArray(brief.vaultCheck)&&brief.vaultCheck.length>0&&(<div className="m2-bsec"><h3>From your vault</h3>{brief.vaultCheck.map((v,vi)=>(<div key={vi} className="m2-bitem"><b className="doc">{v.docName}</b><span>{v.line||''}</span></div>))}</div>)}
            </>)}
            {!briefLoading && !brief && <div className="m2-sempty">Brief unavailable right now — try again shortly.</div>}
          </div>
        </div>
      )}

      {/* TAB BAR */}
      <div className="m2-tabs"><div className="m2-tabbar">
        <button className={'m2-tab'+(tab==='ai'&&!detail?' on':'')} ref={el=>tabRefs.current.ai=el} onClick={()=>go('ai')}><span className="glow"></span><I d={icons.spark} w={23}/><span className="lb">Particle AI</span></button>
        <button className={'m2-tab'+(tab==='term'?' on':'')} ref={el=>tabRefs.current.term=el} onClick={()=>go('term')}><span className="glow"></span><I d={icons.chart} w={23}/><span className="lb">Terminal</span></button>
        <button className={'m2-tab'+(tab==='vault'&&!detail?' on':'')} ref={el=>tabRefs.current.vault=el} onClick={()=>go('vault')}><span className="glow"></span><I d={icons.vault} w={23}/><span className="lb">Vault</span></button>
      </div></div>

      {tour && <Tour tabRefs={tabRefs} onEnd={endTour}/>}
      {intro && <Intro onDone={endIntro}/>}
    </div>
  );
}
