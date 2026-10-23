import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const HISTORY={
  "65ad74e8f4d5010d1a1189ba78cd01c29469214a": {
    "assets/js/training-app.js": "f0aa876de3e82ac8688d4f6336b58b172c2c1e66f0baa63a6daae2714d39bbc3",
    "sw.js": "1d89da23d9c613d29201bb10988df5c820c07fb14805b5cc9ea4293560cd35ac",
    "tablet.html": "53b6c8dd5384f6dc80cddf0d43d02c124bb0abf1af9a47bb387f791648d1333c",
    "assets/css/training.css": "bedcfbb628353b6902369f3a54a7a510c6af16c6d35bb195738824c49d627733"
  },
  "6cd6d0dba7d090b3f129e73e454ea8546b07cecd": {
    "assets/js/training-app.js": "0cd25f5aa0edab9e3fd0430b3a84189ff12f11b70d645d694329758d0f7996de",
    "sw.js": "c8a057efb131991c7ba576544d031d526d8453985f11651d544dea41adc7d16a",
    "tablet.html": "c4ce73f657e4c0c876ae910aba63cac9fd4ce25d9689c817a67adc27aad69cff",
    "assets/css/training.css": "bedcfbb628353b6902369f3a54a7a510c6af16c6d35bb195738824c49d627733"
  }
};
export const OLD_3D='65ad74e8f4d5010d1a1189ba78cd01c29469214a';
export const OLD_TABLET='6cd6d0dba7d090b3f129e73e454ea8546b07cecd';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function historicalShell(ref,paths,read){
 assert(Object.hasOwn(HISTORY,ref),'Only a pinned historical source is allowed');const files=new Map();
 for(const [path,expected] of Object.entries(HISTORY[ref])){const bytes=read(ref,path);assert.equal(hash(bytes),expected,`Pinned historical source: ${ref}:${path}`);files.set(path,bytes);}
 for(const path of paths)if(!files.has(path))files.set(path,read(ref,path));return files;
}
export function chooseUpgrade(eventBase,current,previous,historical){
 assert.match(eventBase,/^[0-9a-f]{40}$/);assert(current.has('sw.js')&&previous.has('sw.js')&&historical.has('sw.js'),'Original workers required');
 const equal=current.size===previous.size&&[...current].every(([p,b])=>previous.has(p)&&hash(b)===hash(previous.get(p)));
 const files=equal?historical:previous,ref=equal?OLD_TABLET:eventBase;
 assert.notEqual(hash(files.get('sw.js')),hash(current.get('sw.js')),'A real worker transition must use different original workers');
 return {files,ref,eventBase,eventBaseRuntimeEqual:equal,kind:equal?'historical-tablet-upgrade-runtime-equals-event-base':'fresh-event-base-upgrade'};
}
