'use strict';
const assert=require('node:assert/strict');
const D=require('./site/director.js');
const cases=[];
function test(name,fn){try{cases.push({name,status:'pass',result:fn()})}catch(e){cases.push({name,status:'fail',error:e.message})}}
for(const dt of [.05,1/60,.1]) test(`fast stable policy dt=${dt}`,()=>{
 const s=D.create(),spawns=[],previews=[];let time=0;
 for(let i=0;i<Math.ceil(50/dt);i++){time+=dt;const r=D.step(s,{time,dt,allStable:true,hasNext:spawns.length<3});if(r.announce)previews.push(time);if(r.spawn)spawns.push(time)}
 assert.equal(spawns.length,3);spawns.forEach((t,i)=>assert(Math.abs(t-12*(i+1))<=dt+1e-7));assert.equal(previews.length,3);return {spawns,previews,maxWait:Math.max(...spawns.map((t,i)=>t-(spawns[i-1]||0)))};
});
test('unresolved 45s, help once, then 7s stable without catch-up',()=>{const s=D.create();let time=0,help=0,spawn=0;for(let i=0;i<900;i++){time+=.05;const r=D.step(s,{time,dt:.05,allStable:false,hasNext:true});help+=+r.help;spawn+=+r.spawn}assert.equal(help,1);assert.equal(spawn,0);for(let i=0;i<140;i++){time+=.05;spawn+=+D.step(s,{time,dt:.05,allStable:true,hasNext:true}).spawn}assert.equal(spawn,1);return {help,firstSpawn:time}});
test('preview cancellation resets 7 second stable requirement',()=>{const s=D.create();for(let i=1;i<=200;i++)D.step(s,{time:i*.05,dt:.05,allStable:true,hasNext:true});assert(s.preview);D.step(s,{time:10.05,dt:.05,allStable:false,hasNext:true});assert.equal(s.preview,false);assert.equal(s.stableFor,0);let spawn=0;for(let i=1;i<=139;i++)spawn+=+D.step(s,{time:10.05+i*.05,dt:.05,allStable:true,hasNext:true}).spawn;assert.equal(spawn,0);spawn+=+D.step(s,{time:17.05,dt:.05,allStable:true,hasNext:true}).spawn;assert.equal(spawn,1)});
const result={humanStatus:'not_run',passed:cases.filter(x=>x.status==='pass').length,total:cases.length,cases};console.log(JSON.stringify(result,null,2));process.exitCode=result.passed===result.total?0:1;
