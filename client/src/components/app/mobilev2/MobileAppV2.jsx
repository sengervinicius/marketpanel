import { useState, useRef, useEffect, useCallback } from 'react';
import './mobilev2.css';
import { useMarketData } from '../../../hooks/useMarketData';
import { useWatchlist } from '../../../context/WatchlistContext';
import { apiFetch } from '../../../utils/api';

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
function ChartV2(){
  const [kind,setKind]=useState('line');
  const hostRef=useRef(null); const dataRef=useRef(null);
  const G={W:352,pT:20,pH:206,vT:236,vH:30,rPad:38,x0:6};
  const build=useCallback(()=>{
    let seed=42; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
    const N=44; let px=150; const cs=[]; const today=new Date(2026,6,24);
    for(let i=0;i<N;i++){const o=px;const drift=0.7+(i/N);const ch=(rnd()-0.42)*3.6*drift;const c=o+ch;const hi=Math.max(o,c)+rnd()*2;const lo=Math.min(o,c)-rnd()*2;const vol=0.4+rnd();const dt=new Date(today);dt.setDate(dt.getDate()-(N-1-i));cs.push({o,c,hi,lo,vol,dt});px=c;}
    return cs;
  },[]);
  const fmtD=(d)=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
  const render=useCallback((k)=>{
    const host=hostRef.current; if(!host) return;
    const cs=build(); const N=cs.length; const {W,pT,pH,vT,vH,rPad,x0}=G; const x1=W-rPad; const H=vT+vH+18;
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
  },[build]);
  const setLegend=(d)=>{const host=hostRef.current;if(!host)return;const el=host.querySelector('.m2-ohlc');if(!el)return;const up=d.c>=d.o;const col=up?'#25d0a0':'#ff5a6a';el.innerHTML=`<b>${fmtD(d.dt)}</b>O <s>${d.o.toFixed(2)}</s> H <s style="color:#25d0a0">${d.hi.toFixed(2)}</s> L <s style="color:#ff5a6a">${d.lo.toFixed(2)}</s> C <s style="color:${col}">${d.c.toFixed(2)}</s>`;};
  const attach=()=>{const host=hostRef.current;if(!host)return;const svg=host.querySelector('#m2csvg');if(!svg)return;const xh=svg.querySelector('#m2xh');
    const at=(cx)=>{const dd=dataRef.current;if(!dd)return;const r=svg.getBoundingClientRect();let vb=(cx-r.left)/r.width*G.W;let i=Math.round((vb-dd.x0)/dd.step-0.5);i=Math.max(0,Math.min(dd.N-1,i));const d=dd.cs[i];xh.style.display='';svg.querySelector('#m2xv').setAttribute('x1',d.cx);svg.querySelector('#m2xv').setAttribute('x2',d.cx);svg.querySelector('#m2xd').setAttribute('cx',d.cx);svg.querySelector('#m2xd').setAttribute('cy',d.yc);setLegend(d);};
    const mv=(e)=>{e.preventDefault();at(e.touches?e.touches[0].clientX:e.clientX);};
    const end=()=>{xh.style.display='none';const dd=dataRef.current;if(dd)setLegend(dd.cs[dd.N-1]);};
    svg.addEventListener('pointerdown',mv);svg.addEventListener('pointermove',(e)=>{if(e.buttons)mv(e);});svg.addEventListener('pointerup',end);svg.addEventListener('pointerleave',end);
    svg.addEventListener('touchstart',mv,{passive:false});svg.addEventListener('touchmove',mv,{passive:false});svg.addEventListener('touchend',end);};
  useEffect(()=>{render(kind);},[kind,render]);
  return (<>
    <div className="m2-ctabs"><div className="m2-cgroup">
      {['line','candles','area'].map(k=>(<button key={k} className={'m2-ct'+(kind===k?' on':'')} onClick={()=>setKind(k)}>{k[0].toUpperCase()+k.slice(1)}</button>))}
    </div><span className="m2-cind">drag to inspect</span></div>
    <div className="m2-charthost" ref={hostRef}><div className="m2-ohlc"></div></div>
    <div className="m2-tf">{['1D','1M','3M','6M','1Y','5Y'].map((t,i)=>(<div key={t} className={'t'+(i===1?' on':'')}>{t}</div>))}</div>
  </>);
}

/* ---------- intro ---------- */
function Intro({onDone}){
  const cvRef=useRef(null); const rootRef=useRef(null);
  useEffect(()=>{
    const root=rootRef.current, cv=cvRef.current; if(!cv)return;
    const ctx=cv.getContext('2d'); const dpr=Math.min(window.devicePixelRatio||1,2);
    const r=root.getBoundingClientRect(); cv.width=r.width*dpr; cv.height=r.height*dpr; ctx.scale(dpr,dpr);
    const cx=r.width/2, cy=r.height/2; let parts=[]; let burst=false; const t0=performance.now(); let raf;
    root.querySelector('.m2-iorb').classList.add('go');root.querySelector('.m2-iword').classList.add('go');root.querySelector('.m2-isub').classList.add('go');
    const loop=(now)=>{const t=(now-t0)/1000; ctx.clearRect(0,0,r.width,r.height);
      if(t<0.6){const p=t/0.6;const rr=2+p*14;const g=ctx.createRadialGradient(cx,cy,0,cx,cy,rr*4);g.addColorStop(0,'rgba(255,180,90,'+(0.9*p)+')');g.addColorStop(.4,'rgba(255,106,0,'+(0.5*p)+')');g.addColorStop(1,'rgba(255,106,0,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,rr*4,0,7);ctx.fill();}
      if(!burst&&t>=0.55){burst=true;for(let i=0;i<110;i++){const a=Math.random()*7;const sp=1.4+Math.random()*4.6;parts.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,rr:1+Math.random()*2.4,life:1});}}
      parts.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=0.965;p.vy*=0.965;p.life-=0.016;if(p.life>0){ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=Math.random()>.4?'#ff9243':'#ffd8a8';ctx.beginPath();ctx.arc(p.x,p.y,p.rr,0,7);ctx.fill();}});
      ctx.globalAlpha=1;
      if(t<3.0){raf=requestAnimationFrame(loop);} else {root.classList.add('gone');setTimeout(onDone,700);}
    };
    raf=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(raf);
  },[onDone]);
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

export default function MobileAppV2(){
  const [tab,setTab]=useState('term');
  const [detail,setDetail]=useState(false);
  const [intro,setIntro]=useState(true);
  const [tour,setTour]=useState(false);
  const tabRefs=useRef({});
  const go=(t)=>{setDetail(false);setTab(t);const sc=document.querySelector('.m2-screen');if(sc)sc.scrollTop=0;};
  const endIntro=()=>{setIntro(false);let seen=false;try{seen=localStorage.getItem('m2tour')==='1';}catch(e){}if(!seen)setTimeout(()=>setTour(true),250);};
  const endTour=()=>{setTour(false);try{localStorage.setItem('m2tour','1');}catch(e){}};

  const { data } = useMarketData();
  const { watchlist } = useWatchlist();
  const look=(sym)=>data?.stocks?.[sym]||data?.forex?.[sym]||data?.crypto?.[sym]||data?.indices?.[sym]||null;
  const NAMES={SPY:'S&P 500',QQQ:'Nasdaq 100',DIA:'Dow Jones',IWM:'Russell 2000',EWZ:'Ibovespa',EFA:'EAFE',EWJ:'Japan',EEM:'Emerging Mkts',FXI:'China',AAPL:'Apple',NVDA:'Nvidia',MSFT:'Microsoft',TSLA:'Tesla',AMZN:'Amazon',GOOGL:'Alphabet',META:'Meta',GLD:'Gold',SLV:'Silver',USO:'WTI crude',UNG:'Nat gas',CORN:'Corn',CPER:'Copper',EURUSD:'EUR / USD',USDBRL:'USD / BRL',USDJPY:'USD / JPY',GBPUSD:'GBP / USD',BTCUSD:'Bitcoin',ETHUSD:'Ethereum',SOLUSD:'Solana',VALE:'Vale',PBR:'Petrobras'};
  const fmtP=(v)=>{if(v==null)return '—';const a=Math.abs(v);if(a>=1000)return v.toLocaleString('en-US',{maximumFractionDigits:0});if(a>=10)return v.toFixed(2);return v.toFixed(4);};
  const fmtC=(c)=>c==null?'—':(c>=0?'+':'')+c.toFixed(2)+'%';
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

  return (
    <div className="m2-root">
      <div className="m2-aura"><b className="a1"></b><b className="a2"></b></div>
      <div className="m2-tex"></div>

      {/* TERMINAL */}
      {tab==='term' && !detail && (
        <div className="m2-screen">
          <div className="m2-top"><div className="m2-av"></div>
            <div className="m2-search"><I d={icons.search} w={15}/>Search any market or ticker…</div>
            <div className="m2-icbtn"><I d={icons.bell} w={17}/></div></div>
          <div className="m2-h1">Terminal</div>
          <div className="m2-sub"><span className="m2-dot"></span>Live · markets open · 24 Jul</div>
          <div className="m2-brief">
            <div className="bh"><span className="tag">MORNING BRIEF</span><span className="tm">06:30 BST</span></div>
            <h2>Futures firm as CPI cools; semis lead the tape</h2>
            <ul><li><i></i>Core CPI steady at 3.2% y/y — a dovish surprise, cut odds rise</li><li><i></i>Your watchlist +1.1%, led by NVDA +2.8%; Petrobras lags</li><li><i></i>2 names you follow report after the close</li></ul>
            <div className="cta">Read full brief · listen 3 min <I d={icons.arrow} w={14}/></div>
          </div>
          <div className="m2-sec"><h3>Global pulse</h3><a>Indices</a></div>
          <div className="m2-strip">
            {PULSE.map(([sym,label])=>{const q=look(sym);return (
              <div className="m2-chip" key={sym}><div className="n">{label}</div><div className="v">{fmtP(q&&q.price)}</div><div className={'c '+cls(q&&q.changePct)}>{fmtC(q&&q.changePct)}</div></div>);})}
          </div>
          <div className="m2-sec"><h3>Watchlist</h3><a>tap a name → in-depth</a></div>
          <div className="m2-card">
            {wl.map(sym=>{const q=look(sym);const nm=NAMES[sym]||sym;return (
              <div className="m2-row" key={sym} onClick={()=>setDetail(true)}>
                <div className="m2-tk">{sym.replace(/USD$/,'').slice(0,3)}</div><div className="nm"><b>{nm}</b><span>{sym}</span></div>
                <div className="pr"><b>{fmtP(q&&q.price)}</b><small className={cls(q&&q.changePct)}>{fmtC(q&&q.changePct)}</small></div><span className="m2-chev"><I d={icons.chev} w={15}/></span>
              </div>);})}
          </div>
          <div className="m2-sec"><h3>FX</h3><a>All pairs</a></div>
          <div className="m2-g2">
            {FX.map(([sym,label])=>{const q=data&&data.forex&&data.forex[sym];return (
              <div className="m2-cell" key={sym}><div className="n">{label}</div><div className="v">{fmtP(q&&q.price)}</div><div className={'c '+cls(q&&q.changePct)}>{fmtC(q&&q.changePct)}</div></div>);})}
          </div>
          <div className="m2-sec"><h3>Commodities</h3><a>All</a></div>
          <div className="m2-strip">
            {COMM.map(([sym,label])=>{const q=data&&data.stocks&&data.stocks[sym];return (
              <div className="m2-chip" key={sym}><div className="n">{label}</div><div className="v">{fmtP(q&&q.price)}</div><div className={'c '+cls(q&&q.changePct)}>{fmtC(q&&q.changePct)}</div></div>);})}
          </div>
          <div className="m2-sec"><h3>Countries</h3><a>Explore</a></div>
          <div className="m2-strip">
            <div className="m2-cty"><div className="ch"><span className="cn">United States</span><span className="risk lo">RISK LOW</span></div><div className="kv"><span>Equity</span><b className="m2-u">S&P +0.7%</b></div><div className="kv"><span>10Y</span><b>4.21%</b></div><div className="kv"><span>USD (DXY)</span><b className="m2-u">104.6</b></div><div className="kv"><span>5Y CDS</span><b>38bp</b></div></div>
            <div className="m2-cty"><div className="ch"><span className="cn">Brazil</span><span className="risk md">RISK MED</span></div><div className="kv"><span>Equity</span><b className="m2-u">IBOV +0.5%</b></div><div className="kv"><span>10Y</span><b>6.34%</b></div><div className="kv"><span>BRL</span><b className="m2-d">5.42</b></div><div className="kv"><span>5Y CDS</span><b>148bp</b></div></div>
            <div className="m2-cty"><div className="ch"><span className="cn">Eurozone</span><span className="risk lo">RISK LOW</span></div><div className="kv"><span>Equity</span><b className="m2-u">Stoxx +0.3%</b></div><div className="kv"><span>Bund 10Y</span><b>2.38%</b></div><div className="kv"><span>EUR</span><b className="m2-d">1.084</b></div><div className="kv"><span>BTP-Bund</span><b>128bp</b></div></div>
          </div>
          <div className="m2-sec"><h3>Credit &amp; risk</h3><a>More</a></div>
          <div className="m2-g3">
            {[['VIX','14.2','-0.6','d'],['MOVE','98','-2','d'],['US HY OAS','312','-4bp','u'],['US IG OAS','92','-1bp','u'],['EM CDS','168','flat','flat'],['BR CDS','148','-2','u']].map(x=>(
              <div className="m2-cell" key={x[0]}><div className="n">{x[0]}</div><div className="v">{x[1]}</div><div className={'c m2-'+x[3]}>{x[2]}</div></div>))}
          </div>
        </div>
      )}

      {/* DETAIL */}
      {detail && (
        <div className="m2-screen">
          <div className="m2-dhead"><button className="m2-back" onClick={()=>setDetail(false)}><I d={icons.back} w={18}/></button><div className="m2-dtitle"><b>Apple · AAPL</b><br/><span>Nasdaq · US equity · technology</span></div><div className="m2-star"><I d={icons.star} w={18}/></div></div>
          <div className="m2-dprice"><div className="v">$228.42</div><div className="c"><I d={icons.up} w={12}/>+$2.71 · +1.20%</div></div>
          <ChartV2/>
          <div className="m2-range"><div className="rt">Day range</div><div className="rl"><span>224.90</span><span>229.10</span></div><div className="m2-bar"><i style={{left:'78%'}}></i></div></div>
          <div className="m2-range"><div className="rt">52-week range</div><div className="rl"><span>164.08</span><span>237.23</span></div><div className="m2-bar"><i style={{left:'88%'}}></i></div></div>
          <div className="m2-sec"><h3>Fundamentals</h3><a>Full model</a></div>
          <div className="m2-fgrid">
            {[['Mkt cap','3.47T'],['Enterprise val','3.51T'],['P/E (ttm)','34.2'],['Fwd P/E','29.8'],['EV/EBITDA','25.1'],['P/B','48.6'],['EPS (ttm)','6.68'],['Div yield','0.44%'],['Rev growth','+6.1%'],['Net margin','25.3%'],['ROE','147%'],['Beta','1.24']].map(x=>(
              <div className="m2-fg" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b></div>))}
          </div>
          <div className="m2-sec"><h3>Street consensus</h3><a>12 analysts</a></div>
          <div className="m2-cons"><div className="m2-con"><div className="n">Rating</div><div className="v m2-u">Buy</div></div><div className="m2-con"><div className="n">Target</div><div className="v">$245</div></div><div className="m2-con"><div className="n">Upside</div><div className="v m2-u">+7.3%</div></div></div>
          <div className="m2-aitake"><div className="h"><span className="o2"></span>Particle AI take</div><p>Trading with the tape (+1.2%); relative strength vs the S&amp;P is neutral and valuation sits ~1σ above its 5-yr average on fwd P/E. Your vault's Q3 teardown flagged services margin as the swing factor — next catalyst is earnings in 18 days.</p></div>
          <div className="m2-sec"><h3>News</h3><a>All</a></div>
          <div className="m2-card"><div className="m2-row"><div className="nm"><b>Apple suppliers signal stronger Q1 orders</b><span>Bloomberg · 2h ago</span></div></div><div className="m2-row"><div className="nm"><b>Services revenue seen as margin driver into FY26</b><span>Reuters · 5h ago</span></div></div></div>
        </div>
      )}

      {/* PARTICLE AI */}
      {tab==='ai' && !detail && (<>
        <div className="m2-screen">
          <div style={{height:'8px'}}></div>
          <div className="m2-aihead"><div className="m2-orb"></div><div><b>Particle AI</b><br/><span><span className="m2-dot"></span>Grounded in markets + your vault</span></div></div>
          <div className="m2-chat">
            <div className="m2-msg me">What's driving Nvidia today and how exposed is my watchlist?</div>
            <div className="m2-msg ai">Nvidia is +2.8% pre-market on a cooler CPI print and supplier demand commentary. Across your watchlist, semis (NVDA, AAPL) are the main beta; Petrobras and BTC are muted. Net watchlist delta ≈ +1.1%.<div className="m2-cite"><I d={icons.cite} w={12}/>3 sources · CPI release + 2 vault notes</div></div>
            <div className="m2-msg me">One-line take on the CPI print.</div>
            <div className="m2-msg ai">Headline CPI +0.1% m/m (vs +0.2% exp), core steady at 3.2% y/y — a dovish surprise that supports the cut path.</div>
          </div>
        </div>
        <div className="m2-composer"><div className="m2-cbox"><input placeholder="Ask Particle anything…"/><button className="m2-send"><I d={icons.send} w={18}/></button></div></div>
      </>)}

      {/* VAULT */}
      {tab==='vault' && !detail && (
        <div className="m2-screen">
          <div className="m2-h1" style={{paddingTop:'6px'}}>Vault</div>
          <div className="m2-sub">Your private research · {vaultDocs?vaultDocs.length:0} document{(vaultDocs&&vaultDocs.length===1)?'':'s'}</div>
          <div className="m2-askvault"><b>Ask your vault</b><p>"What did our last Nvidia note conclude on margins?" — Particle searches every document you've saved and answers with citations.</p></div>
          <div className="m2-sec"><h3>Recent</h3><a>All</a></div>
          {(vaultDocs&&vaultDocs.length?vaultDocs.slice(0,10):[]).map(doc=>(
            <div className="m2-vcard" key={doc.id}><div className="m2-vico"><I d={icons.doc} w={19}/></div><div className="nm"><b>{docTitle(doc.filename)}</b><span>{docType(doc.filename)}{doc.chunk_count?(' · '+doc.chunk_count+' chunks'):''} · {relTime(doc.created_at)}</span></div></div>))}
          {vaultDocs&&!vaultDocs.length && (<div className="m2-vcard"><div className="nm"><b>No documents yet</b><span>Email or upload research to build your vault</span></div></div>)}
          {!vaultDocs && (<div className="m2-vcard"><div className="nm"><span>Loading your vault…</span></div></div>)}
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
