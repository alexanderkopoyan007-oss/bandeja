document.getElementById('__ov')?.remove();
const mp=document.getElementById('movie_player');mp.setPlaybackQualityRange&&mp.setPlaybackQualityRange('hd1080','hd1080');
const v=document.querySelector('video');
const seek0=(t)=>new Promise((res)=>{let d=false;const f=()=>{if(d)return;d=true;v.removeEventListener('seeked',f);res()};v.addEventListener('seeked',f);v.currentTime=t;setTimeout(f,5000)});
await seek0(42);await new Promise(r=>setTimeout(r,3000));await seek0(42.8);await new Promise(r=>setTimeout(r,1000));
window.__scan3=function(times){const VW=v.videoWidth,VH=v.videoHeight;const c=document.createElement('canvas');const sc=Math.min(1,1280/Math.max(VW,VH));c.width=Math.round(VW*sc);c.height=Math.round(VH*sc);const x=c.getContext('2d',{willReadFrequently:true});
const hc=document.createElement('canvas');hc.width=hc.height=288;const hx=hc.getContext('2d',{willReadFrequently:true});
const bc=document.createElement('canvas');bc.width=640;bc.height=360;const bx=bc.getContext('2d',{willReadFrequently:true});
const job={rows:[],done:false,err:null,t:0,ms:0,n:times.length,VW,VH};
const seek=(t)=>new Promise((res)=>{let d=false;const f=()=>{if(d)return;d=true;v.removeEventListener('seeked',f);res()};v.addEventListener('seeked',f);v.currentTime=t;setTimeout(f,4000)});
(async()=>{try{v.pause();v.muted=true;const s0=performance.now();for(const t of times){job.t=t;await seek(t);x.drawImage(v,0,0,c.width,c.height);const r=window.__pl.detect(c);const w=r.worldLandmarks&&r.worldLandmarks[0],l=r.landmarks&&r.landmarks[0];if(!w){job.rows.push({t:+t.toFixed(3),none:1});continue}
const row={t:+t.toFixed(3),w:w.map(p=>[+p.x.toFixed(4),+(-p.y).toFixed(4),+(-p.z).toFixed(4),+(p.visibility||0).toFixed(2)]),l:l.map(p=>[+p.x.toFixed(5),+p.y.toFixed(5)]),h:null,b:null};
// the free (left) hand: a cut-out round the wrist, the hand whose wrist is nearest; its direction (wrist to middle knuckle) and knuckle line (little to index), right-handed
{const wx=l[15].x*VW,wy=l[15].y*VH,ex=l[13].x*VW,ey=l[13].y*VH;const fore=Math.hypot(wx-ex,wy-ey);const cx=wx+0.35*(wx-ex),cy=wy+0.35*(wy-ey);const half=Math.max(1.35*fore,40);hx.fillStyle='#000';hx.fillRect(0,0,288,288);hx.drawImage(v,cx-half,cy-half,2*half,2*half,0,0,288,288);const hr=window.__hl.detect(hc);const ewx=(wx-(cx-half))/(2*half),ewy=(wy-(cy-half))/(2*half);let best=-1,bd=0.12;(hr.landmarks||[]).forEach((lm,k)=>{const d=Math.hypot(lm[0].x-ewx,lm[0].y-ewy);if(d<bd){bd=d;best=k}});if(best>=0){const W=hr.worldLandmarks[best];const dv=(a,b)=>[W[a].x-W[b].x,-(W[a].y-W[b].y),-(W[a].z-W[b].z)].map(q=>+q.toFixed(4));row.h={d:dv(9,0),a:dv(5,17)}}}
// the ball: yellow pixels near the player
{bx.drawImage(v,0,0,640,360);const d=bx.getImageData(0,0,640,360).data;const hxp=(l[23].x+l[24].x)/2*640,hyp=(l[23].y+l[24].y)/2*360;let n=0,sx=0,sy=0,x0=1e9,x1=-1,y0=1e9,y1=-1;const X0=Math.max(0,Math.round(hxp-230)),X1=Math.min(639,Math.round(hxp+230)),Y0=Math.max(0,Math.round(hyp-150)),Y1=Math.min(359,Math.round(hyp+150));for(let y=Y0;y<=Y1;y++)for(let xx=X0;xx<=X1;xx++){const i=(y*640+xx)*4;const R=d[i],G=d[i+1],B=d[i+2];if(R>150&&G>160&&B<120&&R-B>70&&G-B>80){n++;sx+=xx;sy+=y;if(xx<x0)x0=xx;if(xx>x1)x1=xx;if(y<y0)y0=y;if(y>y1)y1=y}}if(n>0)row.b=[+(sx/n/640).toFixed(5),+(sy/n/360).toFixed(5),n,x1-x0+1,y1-y0+1]}
job.rows.push(row)}job.ms=performance.now()-s0}catch(e){job.err=String(e).slice(0,300)}job.done=true})();window.__job=job;return {n:times.length,VW,VH}};
const T=[];const seg=(a,b,f)=>{for(let k=0;;k++){const t=a+k/f;if(t>=b-1e-6)break;T.push(+t.toFixed(3))}};
seg(42.8,59,25);seg(59,65.6,5);seg(65.6,74,25);seg(74,79.2,5);seg(79.2,82,25);seg(82,89,5);seg(89,93.6,25);seg(93.6,99.6,5);seg(99.6,101.6,25);
const r=window.__scan3(T);await new Promise(q=>setTimeout(q,15000));({r,n:window.__job.rows.length,t:window.__job.t,err:window.__job.err,q:mp.getPlaybackQuality()})
