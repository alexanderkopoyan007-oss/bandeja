const K=7.2,FPS=60,A=16/9;
const SEG=[[52.48,58.80],[67.00,72.48],[80.48,81.44],[89.44,92.00]];
const byT=new Map(window.__raw3.map(r=>[r.t.toFixed(2),r]));
// 1. the moving frames, in order; a frame the tracker missed is filled from its neighbours
const M=[];for(const [a,b] of SEG){for(let k=0;;k++){const t=+(a+k*0.04).toFixed(2);if(t>b+1e-6)break;M.push({t,r:byT.get(t.toFixed(2))})}}
const miss=M.filter(m=>!m.r||!m.r.w).length;
const good=i=>M[i].r&&M[i].r.w;
const U=[0,7,8,11,12,13,14,15,16,17,18,19,20,23,24,25,26,27,28,29,30,31,32],IP=[23,24,27,28,29,30,31,32];
const n=M.length;const P=[],I=[],S=[],H=[];
for(let i=0;i<n;i++){let a=i,b=i;while(a>=0&&!good(a))a--;while(b<n&&!good(b))b++;if(a<0)a=b;if(b>=n)b=a;const u=a===b?0:(i-a)/(b-a);const ra=M[a].r,rb=M[b].r;
const hip=r=>[0,1,2].map(c=>(r.w[23][c]+r.w[24][c])/2);const ha=hip(ra),hb=hip(rb);
P.push(ra.w.map((q,j)=>[0,1,2].map(c=>(q[c]-ha[c])*(1-u)+(rb.w[j][c]-hb[c])*u)));
I.push(ra.l.map((q,j)=>[0,1].map(c=>q[c]*(1-u)+rb.l[j][c]*u)));
const sc=r=>{const w=r.w,l=r.l;const pr=[[[11,12],[27,28]],[[23,24],[11,12]],[[23],[27]],[[24],[28]]];let si=0,sw=0;for(const [g1,g2] of pr){const mw=g=>[0,1].map(c=>g.reduce((s,j)=>s+w[j][c],0)/g.length),ml=g=>[g.reduce((s,j)=>s+l[j][0]*A,0)/g.length,g.reduce((s,j)=>s+l[j][1],0)/g.length];const w1=mw(g1),w2=mw(g2),l1=ml(g1),l2=ml(g2);sw+=Math.hypot(w1[0]-w2[0],w1[1]-w2[1]);si+=Math.hypot(l1[0]-l2[0],l1[1]-l2[1])}return si/sw};
S.push(sc(ra)*(1-u)+sc(rb)*u);
H.push(M[i].r&&M[i].r.h?M[i].r.h:null)}
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[s.length>>1]};
const filt=(get,len,dims,km,ka)=>{const m1=[];for(let i=0;i<n;i++){const row=[];for(let j=0;j<len;j++){const p=[];for(let c=0;c<dims;c++){const v=[];for(let k=Math.max(0,i-km);k<=Math.min(n-1,i+km);k++)v.push(get(k,j,c));p.push(med(v))}row.push(p)}m1.push(row)}const m2=[];for(let i=0;i<n;i++){const row=[];for(let j=0;j<len;j++){const p=[];for(let c=0;c<dims;c++){let s=0,q=0;for(let k=Math.max(0,i-ka);k<=Math.min(n-1,i+ka);k++){s+=m1[k][j][c];q++}p.push(s/q)}row.push(p)}m2.push(row)}return m2};
const Ps=filt((k,j,c)=>P[k][j][c],33,3,3,2),Is=filt((k,j,c)=>I[k][j][c],33,2,3,2),Ss=filt((k,j,c)=>S[k],1,1,12,12);
// the free hand: the median of what was seen within 6 frames, where at least 2 were
const Hs=[];for(let i=0;i<n;i++){const a=[];for(let k=Math.max(0,i-6);k<=Math.min(n-1,i+6);k++)if(H[k])a.push(H[k]);if(a.length<2){Hs.push(null);continue}const un=v=>{const m=Math.hypot(...v)||1;return v.map(q=>q/m)};const mv=key=>un([0,1,2].map(c=>med(a.map(h=>un(h[key])[c]))));Hs.push({d:mv('d'),a:mv('a')})}
// 2. to the stroke's own time
const T=(n-1)/25/K,N=Math.floor(T*FPS)+1;const AB='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let clip=0;const e2=v=>{let q=Math.round(v);if(q<0||q>4095){clip++;q=Math.min(4095,Math.max(0,q))}return AB[q>>6]+AB[q&63]};
let body='',img='',scale='',lh='',lhok='';
for(let f=0;f<N;f++){const x=f/FPS*K*25,i=Math.min(n-2,Math.floor(x)),u=Math.min(1,x-i);const L=(a,b)=>a+(b-a)*u;
for(const j of U)for(let c=0;c<3;c++)body+=e2(L(Ps[i][j][c],Ps[i+1][j][c])*1000+2048);
for(const j of IP)for(let c=0;c<2;c++)img+=e2(L(Is[i][j][c],Is[i+1][j][c])*4000);
scale+=e2(L(Ss[i][0][0],Ss[i+1][0][0])*8000);
const h=Hs[u<0.5?i:i+1];lhok+=h?'1':'0';for(const key of ['d','a'])for(let c=0;c<3;c++)lh+=e2((h?h[key][c]:0)*1000+2048)}
// 3. the racket's keys in the stroke's time
const KT=[45,52,55.5,57,60,67,68.5,70,71.5,73,76,80.2,80.8,81.1,81.4,89.65,89.9,90.15,90.4,90.9,91.5,92.3,96];
const idx=t=>{let o=0;for(const [a,b] of SEG){if(t<a)return o;if(t<=b)return o+(t-a)/0.04;o+=Math.round((b-a)/0.04)+1}return o-1};
const key_out=KT.map(t=>+(Math.min(n-1,idx(t))/25/K).toFixed(4));
window.__export={marker:'BANDEJA_POSE_V2',clip_id:'JtSP9EGtz1c',fps:FPS,frames:N,joints:U,img_points:IP,k:K,aspect:A,racket_hand:'Right',moving_frames:n,missed:miss,contact_s:+(idx(81.42)/25/K).toFixed(4),key_t:KT,key_out,clipped:clip,lh_ok:lhok,body,img,scale,lh};
({n,miss,N,T:T.toFixed(3),contact:window.__export.contact_s,clip,lhSeen:[...lhok].filter(c=>c==='1').length,scale:[Ss[0][0][0],Ss[n>>1][0][0],Ss[n-1][0][0]].map(v=>v.toFixed(4)),key_out,len:JSON.stringify(window.__export).length})
