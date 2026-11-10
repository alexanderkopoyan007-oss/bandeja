// As 5-stroke.js, for a clip whose parts play at different speeds (the vibora PihyQF3EnHk: a 120 fps camera at 25, its
// first part at half that again, frames repeated in the second, three frames cut out before a frozen contact frame).
// SEGS: each part's video span and the stroke's time one of its frames takes; `dedupe` drops a frame that is the one
// before again (window.__jA.out: each frame's difference from the one before); `gap` puts back frames the edit cut out
// (filled between their neighbours). window.__rawV: the scan's rows (3-scan.js). KT: the racket keys' video times.
const FPS=60,A=16/9;
const SEGS=[{a:52.6,b:55.48,dt:1/240},{a:63.48,b:66.44,dt:1/120,dedupe:1},{a:76.44,b:77.2,dt:1/120},{gap:3,dt:1/120},{a:93.44,b:93.44,dt:1/120},{a:93.48,b:97.44,dt:1/120}];
const STEP=0.04,CONTACT=93.44,CLIP='PihyQF3EnHk';
const KT=[52.6,53.0,53.8,54.4,55.0,55.48,64.1,64.7,65.3,65.9,66.44,76.44,76.6,76.76,76.92,77.04,77.2,93.44,93.48,93.6,93.8,94.0,94.3,94.8,95.6,96.5,97.44];
const dfm=new Map(window.__jA.out.map(o=>[o.t.toFixed(2),o.df]));
const byT=new Map(window.__rawV.map(r=>[r.t.toFixed(2),r]));
const M=[];let tau=0;for(const s of SEGS){if(s.gap){for(let k=0;k<s.gap;k++){tau+=s.dt;M.push({t:-1,r:null,tau})}continue}
for(let k=0;;k++){const t=+(s.a+k*STEP).toFixed(2);if(t>s.b+1e-6)break;if(s.dedupe&&k>0&&(dfm.get(t.toFixed(2))||0)<0.05)continue;if(M.length)tau+=s.dt;M.push({t,r:byT.get(t.toFixed(2)),tau})}}
const miss=M.filter(m=>!m.r||!m.r.w).length;const good=i=>M[i].r&&M[i].r.w;
const U=[0,7,8,11,12,13,14,15,16,17,18,19,20,23,24,25,26,27,28,29,30,31,32],IP=[23,24,27,28,29,30,31,32];
const n=M.length;const P=[],I=[],S=[],H=[];
for(let i=0;i<n;i++){let a=i,b=i;while(a>=0&&!good(a))a--;while(b<n&&!good(b))b++;if(a<0)a=b;if(b>=n)b=a;const u=a===b?0:(M[i].tau-M[a].tau)/(M[b].tau-M[a].tau);const ra=M[a].r,rb=M[b].r;
const hip=r=>[0,1,2].map(c=>(r.w[23][c]+r.w[24][c])/2);const ha=hip(ra),hb=hip(rb);
P.push(ra.w.map((q,j)=>[0,1,2].map(c=>(q[c]-ha[c])*(1-u)+(rb.w[j][c]-hb[c])*u)));
I.push(ra.l.map((q,j)=>[0,1].map(c=>q[c]*(1-u)+rb.l[j][c]*u)));
const sc=r=>{const w=r.w,l=r.l;const pr=[[[11,12],[27,28]],[[23,24],[11,12]],[[23],[27]],[[24],[28]]];let si=0,sw=0;for(const [g1,g2] of pr){const mw=g=>[0,1].map(c=>g.reduce((s,j)=>s+w[j][c],0)/g.length),ml=g=>[g.reduce((s,j)=>s+l[j][0]*A,0)/g.length,g.reduce((s,j)=>s+l[j][1],0)/g.length];const w1=mw(g1),w2=mw(g2),l1=ml(g1),l2=ml(g2);sw+=Math.hypot(w1[0]-w2[0],w1[1]-w2[1]);si+=Math.hypot(l1[0]-l2[0],l1[1]-l2[1])}return si/sw};
S.push(sc(ra)*(1-u)+sc(rb)*u);H.push(M[i].r&&M[i].r.h?M[i].r.h:null)}
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[s.length>>1]};
const filt=(get,len,dims,km,ka)=>{const m1=[];for(let i=0;i<n;i++){const row=[];for(let j=0;j<len;j++){const p=[];for(let c=0;c<dims;c++){const v=[];for(let k=Math.max(0,i-km);k<=Math.min(n-1,i+km);k++)v.push(get(k,j,c));p.push(med(v))}row.push(p)}m1.push(row)}const m2=[];for(let i=0;i<n;i++){const row=[];for(let j=0;j<len;j++){const p=[];for(let c=0;c<dims;c++){let s=0,q=0;for(let k=Math.max(0,i-ka);k<=Math.min(n-1,i+ka);k++){s+=m1[k][j][c];q++}p.push(s/q)}row.push(p)}m2.push(row)}return m2};
const Ps=filt((k,j,c)=>P[k][j][c],33,3,2,2),Is=filt((k,j,c)=>I[k][j][c],33,2,2,2),Ss=filt((k,j,c)=>S[k],1,1,12,12);
const Hs=[];for(let i=0;i<n;i++){const a=[];for(let k=Math.max(0,i-6);k<=Math.min(n-1,i+6);k++)if(H[k])a.push(H[k]);if(a.length<2){Hs.push(null);continue}const un=v=>{const m=Math.hypot(...v)||1;return v.map(q=>q/m)};const mv=key=>un([0,1,2].map(c=>med(a.map(h=>un(h[key])[c]))));Hs.push({d:mv('d'),a:mv('a')})}
const T=M[n-1].tau,N=Math.floor(T*FPS)+1;const AB='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let clip=0;const e2=v=>{let q=Math.round(v);if(q<0||q>4095){clip++;q=Math.min(4095,Math.max(0,q))}return AB[q>>6]+AB[q&63]};
let body='',img='',scale='',lh='',lhok='';let i=0;
for(let f=0;f<N;f++){const x=f/FPS;while(i<n-2&&M[i+1].tau<=x)i++;const u=Math.min(1,Math.max(0,(x-M[i].tau)/(M[i+1].tau-M[i].tau)));const L=(a,b)=>a+(b-a)*u;
for(const j of U)for(let c=0;c<3;c++)body+=e2(L(Ps[i][j][c],Ps[i+1][j][c])*1000+2048);
for(const j of IP)for(let c=0;c<2;c++)img+=e2(L(Is[i][j][c],Is[i+1][j][c])*4000);
scale+=e2(L(Ss[i][0][0],Ss[i+1][0][0])*8000);
const h=Hs[u<0.5?i:i+1];lhok+=h?'1':'0';for(const key of ['d','a'])for(let c=0;c<3;c++)lh+=e2((h?h[key][c]:0)*1000+2048)}
const tauAt=t=>{let best=0;for(let k=0;k<n;k++){if(M[k].t>=0&&M[k].t<=t+1e-6)best=k}return M[best].tau};
const key_out=KT.map(t=>+tauAt(t).toFixed(4));
window.__export={marker:'BANDEJA_POSE_V2',clip_id:CLIP,fps:FPS,frames:N,joints:U,img_points:IP,k:4.8,aspect:A,racket_hand:'Right',moving_frames:n,missed:miss,contact_s:+tauAt(CONTACT).toFixed(4),key_t:KT,key_out,clipped:clip,lh_ok:lhok,body,img,scale,lh};
({n,miss,N,T:T.toFixed(3),contact:window.__export.contact_s,clip,key_out:key_out.join(' ')})
