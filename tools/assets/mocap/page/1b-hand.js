const o={};try{
const V=window.__mpv;const B='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/';
const fileset={wasmLoaderPath:'',wasmBinaryPath:B+'wasm/vision_wasm_internal.wasm'};
window.__hl=await V.HandLandmarker.createFromOptions(fileset,{baseOptions:{modelAssetBuffer:new Uint8Array(window.__hb),delegate:'CPU'},runningMode:'IMAGE',numHands:2,minHandDetectionConfidence:0.25,minHandPresenceConfidence:0.25});
o.hl=!!window.__hl;
}catch(e){o.err=String(e).slice(0,300)}o
