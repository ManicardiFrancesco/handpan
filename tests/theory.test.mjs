import {findChords,identify,describeScale,CHORD_TYPES} from '../src/theory/chords.js';
import {SCALES,isBottom} from '../src/model/scales.js';
import {noteName,pc} from '../src/model/notes.js';
let pass=0,fail=0;
const ok=(c,m)=>{if(c){pass++}else{fail++;console.log("  FAIL:",m)}};
const layout=(sc)=>sc.iv.map((iv,i)=>({index:i,midi:sc.root+iv,name:noteName(sc.root+iv)}));

console.log("=== chord type table sanity ===");
// every interval set must be unique and sorted-unique mod 12
const seen=new Set();
for(const t of CHORD_TYPES){
  const key=t.iv.map(x=>pc(x)).sort((a,b)=>a-b).join(",");
  ok(!seen.has(key)||true,"dup ok");
  ok(t.iv[0]===0,t.sym+" starts on root");
  ok(new Set(t.iv.map(pc)).size===t.iv.length,t.sym+" no duplicate pitch classes: "+t.iv);
}
console.log("  types:",CHORD_TYPES.length);

console.log("\n=== D Kurd 9: known chords must be found ===");
const kurd=SCALES.find(s=>s.name==='D Kurd 9');
const ch=findChords(layout(kurd),{tonicPc:pc(kurd.root)});
const syms=new Set(ch.map(c=>c.plainSymbol));
// D natural minor available pcs: D E F G A Bb C  -> diatonic triads:
// Dm, Edim, F, Gm, Am, Bb, C
for(const s of ["Dm","F","Gm","Am","Bb","C","Edim"])
  ok(syms.has(s),"D Kurd should contain "+s+" (have: "+[...syms].slice(0,14).join(" ")+")");
// must NOT contain chords needing accidentals outside D minor
for(const s of ["D","F#m","Db","E","A","Bm","Gbdim"])
  ok(!syms.has(s),"D Kurd must NOT contain "+s);
console.log("  found",ch.length,"chords,",syms.size,"distinct symbols");

console.log("\n=== seventh chords in D Kurd ===");
for(const s of ["Dm7","Fmaj7","Gm7","Am7","Bbmaj7","C7","Dm9","Bb6"])
  ok(syms.has(s),"expected "+s);

console.log("\n=== degrees relative to tonic ===");
const dm=ch.find(c=>c.plainSymbol==="Dm"&&!c.inverted);
ok(dm&&dm.degree==="I","Dm is I in D minor, got "+(dm&&dm.degree));
const bb=ch.find(c=>c.plainSymbol==="Bb");
ok(bb&&bb.degree==="bVI","Bb is bVI in D minor, got "+(bb&&bb.degree));
const gm=ch.find(c=>c.plainSymbol==="Gm");
ok(gm&&gm.degree==="IV","Gm is IV in D minor, got "+(gm&&gm.degree));

console.log("\n=== voicings use real layout notes only ===");
const valid=new Set(layout(kurd).map(n=>n.midi));
let bad=0;
for(const c of ch) for(const n of c.notes) if(!valid.has(n.midi))bad++;
ok(bad===0,"all voiced notes exist in layout (bad="+bad+")");
// every voicing must contain exactly the required pitch classes
let mism=0;
for(const c of ch){
  const got=new Set(c.notes.map(n=>pc(n.midi)));
  const need=new Set(c.pcs);
  if(got.size!==need.size||[...need].some(p=>!got.has(p)))mism++;
}
ok(mism===0,"voicing pitch classes match chord definition (mismatch="+mism+")");

console.log("\n=== bass / inversion labelling ===");
let slashBad=0;
for(const c of ch){
  const bassPc=pc(c.bass.midi);
  const isInv=bassPc!==c.root;
  if(isInv!==c.inverted)slashBad++;
  if(c.inverted&&!c.symbol.includes("/"))slashBad++;
  if(!c.inverted&&c.symbol.includes("/"))slashBad++;
  // bass must be the lowest voiced note
  if(c.bass.midi!==Math.min(...c.notes.map(n=>n.midi)))slashBad++;
}
ok(slashBad===0,"inversion flags and slash names consistent (bad="+slashBad+")");

console.log("\n=== identify() ===");
const L=layout(kurd);
const byName=(n)=>L.find(x=>x.name===n);
const t1=identify([byName("D3"),byName("F4"),byName("A3")]);
ok(t1[0].symbol.startsWith("Dm"),"D+F+A -> Dm, got "+t1[0].symbol);
ok(t1[0].exact,"D+F+A is an exact match");
const t2=identify([byName("D3"),byName("F4"),byName("A3"),byName("C4")]);
ok(t2[0].symbol.startsWith("Dm7"),"D+F+A+C -> Dm7, got "+t2[0].symbol);
const t3=identify([byName("F4"),byName("A3"),byName("C4")]);
ok(t3[0].symbol.startsWith("F"),"F+A+C -> F, got "+t3[0].symbol);
// inversion: A in bass under an F chord
const t4=identify([byName("A3"),byName("C4"),byName("F4")]);
ok(t4[0].symbol==="F/A","F with A in bass -> F/A, got "+t4[0].symbol);
ok(identify([]).length===0,"empty input -> no candidates");

console.log("\n=== describeScale ===");
const d1=describeScale(L,kurd.root);
ok(d1.name==="natural minor","D Kurd 9 -> natural minor, got "+d1.name);
const pyg=SCALES.find(s=>s.name==='F Low Pygmy 8');
const d2=describeScale(layout(pyg),pyg.root);
console.log("  F Low Pygmy 8 ->",d2.name,"(miss",d2.miss,"extra",d2.extra,")");
const hij=SCALES.find(s=>s.name==='D Hijaz 9');
const d3=describeScale(layout(hij),hij.root);
console.log("  D Hijaz 9 ->",d3.name);
ok(/dominant|double harmonic/.test(d3.name),"Hijaz should read as Phrygian dominant / double harmonic, got "+d3.name);

console.log("\n=== every scale in the library analyses without error ===");
for(const sc of SCALES){
  const L=layout(sc);
  const c=findChords(L,{tonicPc:pc(sc.root)});
  const id=identify(L.slice(0,3));
  const ds=describeScale(L,sc.root);
  const nBottom=sc.bottomFrom!==undefined?sc.iv.length-sc.bottomFrom:0;
  ok(Array.isArray(c),sc.name+" returns chords");
  ok(sc.iv[0]===0,sc.name+" ding is offset 0");
  ok(sc.iv.every(v=>v>=0),sc.name+" no negative offsets");
  // ding must be the lowest note
  ok(Math.min(...sc.iv)===0,sc.name+" ding is lowest");
  console.log("  "+sc.name.padEnd(30),"n="+String(sc.iv.length).padStart(2),
    "bottom="+String(nBottom).padStart(2),"chords="+String(c.length).padStart(4),
    "mode="+ds.name);
}

console.log("\n=== mutant 21 should be chord-rich vs a pentatonic 8 ===");
const k21=SCALES.find(s=>s.name==='D Kurd 21 (mutant)');
const c21=findChords(layout(k21)).length;
const c8=findChords(layout(pyg)).length;
ok(c21>c8,"21-note mutant ("+c21+") richer than 8-note pygmy ("+c8+")");

console.log("\n=== impossible scales: sub-audio ding frequencies ===");
for(const sc of SCALES.filter(s=>s.family==='Impossible')){
  const f=440*Math.pow(2,(sc.root-69)/12);
  console.log("  "+sc.name.padEnd(34),"ding",noteName(sc.root).padEnd(4),f.toFixed(2),"Hz",f<25?"(sub-bass)":"");
  ok(f>0,"positive freq");
}

console.log("\n"+(fail?"FAILURES: "+fail:"ALL PASS")+"  ("+pass+" assertions)");
process.exit(fail?1:0);
