// A cut-out round the head (not the tracker's racket wrist: behind the head the tracker loses that arm), with a 10 cm grid
// and the tracker's marks: magenta its racket wrist, cyan its elbow, white the racket shoulder, green the free one.
//   await __showH(t, half = 0.75 m, up = 0.2 m above the nose, dx = 0 m to the right of it)
// The value is where the marks fall in the 360-px reading (computer zoom of [0,0,400,400] at scale 0.9, viewport 1280x800)
// and its pixels to the metre. Wait for the paint (the call does, 0.9 s) or the zoom shows the frame before.
const v=document.querySelector('video');let oc=document.getElementById('__ov');
if(!oc){oc=document.createElement('canvas');oc.id='__ov';oc.width=640;oc.height=640;oc.style.cssText='position:fixed;left:0;top:0;z-index:999999;width:640px;height:640px;background:#000';document.body.appendChild(oc)}
const seek=(t)=>new Promise((res)=>{let d=false;const f=()=>{if(d)return;d=true;v.removeEventListener('seeked',f);res()};v.addEventListener('seeked',f);v.currentTime=t;setTimeout(f,5000)});
const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d',{willReadFrequently:true});
window.__cuts=window.__cuts||{};
window.__showH=async(t,half,up,dx)=>{half=half||0.75;up=up===undefined?0.2:up;dx=dx||0;await seek(t);await new Promise(r=>setTimeout(r,300));const VW=v.videoWidth,VH=v.videoHeight;x.drawImage(v,0,0,1280,720);const r=window.__pl.detect(c);const l=r.landmarks[0];const A=VW/VH;
// the body's scale: shoulders to ankles, 1.40 m
const bh=Math.hypot(((l[11].x+l[12].x)/2-(l[27].x+l[28].x)/2)*A,(l[11].y+l[12].y)/2-(l[27].y+l[28].y)/2)*VH;const m=1.40/bh;
const cx=l[0].x*VW+dx/m,cy=l[0].y*VH-up/m;const S=half/m;const N=640;const g=oc.getContext('2d');g.imageSmoothingQuality='high';g.fillStyle='#444';g.fillRect(0,0,N,N);g.drawImage(v,cx-S,cy-S,2*S,2*S,0,0,N,N);const u=N/(2*half);
g.lineWidth=1;g.strokeStyle='rgba(255,255,0,0.3)';for(let k=-9;k<=9;k++){g.beginPath();g.moveTo(N/2+k*0.1*u,0);g.lineTo(N/2+k*0.1*u,N);g.stroke();g.beginPath();g.moveTo(0,N/2+k*0.1*u);g.lineTo(N,N/2+k*0.1*u);g.stroke()}
const mark=(j,col)=>{g.strokeStyle=col;g.lineWidth=2;g.beginPath();g.arc(N/2+(l[j].x*VW-cx)*m*u,N/2+(l[j].y*VH-cy)*m*u,5,0,7);g.stroke()};mark(16,'#f0f');mark(14,'#0ff');mark(12,'#fff');mark(11,'#0f0');
g.fillStyle='#fff';g.font='bold 14px sans-serif';g.fillText('t='+t+'  grid 10 cm',6,14);
const rd=j=>[Math.round((N/2+(l[j].x*VW-cx)*m*u)*360/640),Math.round((N/2+(l[j].y*VH-cy)*m*u)*360/640)];
window.__cuts[t]={S:rd(12),LS:rd(11),W:rd(16),E:rd(14),ppm:+(360/(2*half)).toFixed(1)};
await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,900)));return JSON.stringify(window.__cuts[t])};
