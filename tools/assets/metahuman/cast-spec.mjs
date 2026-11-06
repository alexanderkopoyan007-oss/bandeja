// The mh-player.py spec for a cast member's MetaHuman (cast-batch.sh): its files under ~/bandeja-people-src/cast/<name>,
// the hair and colours from cast.json, and the kit cut and shoes the player has now (their pack's header), with the
// garment's own collar; under a skirt, the shorts' length the MPFB player had.  node tools/assets/metahuman/cast-spec.mjs <name>
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const n = process.argv[2];
const c = JSON.parse(readFileSync('tools/assets/metahuman/cast.json', 'utf8'))[n];
const s = gunzipSync(readFileSync(`public/assets/people/${n}.bnz`)).toString('latin1');
const at = s.indexOf('"kit":');
const kit = JSON.parse(s.slice(at + 6, s.indexOf('}', at) + 1));
const h = c.hair.replace(/^WI_/, '');
// (under a skirt, MetaHuman's shorts end where the old inner shorts did: data/players' shorts, the MPFB legs' cut)
const skirt = kit.bottom === 'pleated' || kit.bottom === 'aline';
const women = JSON.parse(readFileSync('data/people.json', 'utf8')).women.map((w) => w.name);
const shortsHem = skirt ? JSON.parse(readFileSync(`data/players/${n}.json`, 'utf8')).shorts : undefined;
console.log(JSON.stringify({
  name: `${n}mh`, src: `~/bandeja-people-src/cast/${n}`,
  body: `full/SKM_MHC_${n}_BodyMesh.fbx`, body_lod: 1,
  face: `full/SKM_MHC_${n}_FaceMesh.fbx`, face_lod: 2, teeth_decimate: 0.35,
  outfit: `export/MHC_${n}_Outfits.fbx`, outfit_lod: 1,
  hair: `export/${h}_CardsMesh_Group0_LOD3.fbx`, hair_atlas: `export/tex/${h}_CardsAtlas_Attribute.png`, hair_rgb: c.hair_rgb,
  helmet: `export/${h}_Helmet_LOD5.fbx`, helmet_cov: `export/tex/${h}_RootUVSeedCoverage.png`,
  maps: `dcc/MHC_${n}/Maps`,
  head_bc: 'export/tex/T_Head_LOD3_BC.png', head_brows: 'export/tex/T_Head_LOD5to7_BC.png', body_bc: 'export/tex/T_Body_BC.png',
  shoes_from: '~/bandeja-p9/assets-src/people/p1/p1.blend',
  ...(shortsHem ? { shorts_hem: shortsHem } : {}),
  // (the women's tops ended level with the hips: mh-player cuts the tee's hem there)
  ...(women.includes(n) ? { top_hem: 'hips' } : {}),
  // (a tank keeps the scoop the shader cuts, as the MPFB women had it; tees and polos the garment's own crew neck)
  kit: kit.top === 'tank' ? kit : { ...kit, collar: 'own' },
}, null, 1));
