const o={};try{
const V=window.__mpv;const B='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/';
const M='https://storage.googleapis.com/mediapipe-models/';
const [pb,hb]=await Promise.all([fetch(M+'pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task').then(r=>r.arrayBuffer()),fetch(M+'hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task').then(r=>r.arrayBuffer())]);
o.pose=pb.byteLength;o.hand=hb.byteLength;window.__hb=hb;
const fileset={wasmLoaderPath:'',wasmBinaryPath:B+'wasm/vision_wasm_internal.wasm'};
window.__pl=await V.PoseLandmarker.createFromOptions(fileset,{baseOptions:{modelAssetBuffer:new Uint8Array(pb),delegate:'CPU'},runningMode:'IMAGE',numPoses:1,minPoseDetectionConfidence:0.3,minPosePresenceConfidence:0.3});
o.pl=!!window.__pl;o.factoryAfter=typeof self.ModuleFactory;
}catch(e){o.err=String(e).slice(0,300)}o
