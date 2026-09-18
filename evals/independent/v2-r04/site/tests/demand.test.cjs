'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine.js'), G=require('../grid.js');
function fixture(target='lamp-1', moved=false) {
  const nodes=[{id:'source',type:'source'},...G.feeders(),...['lamp-1','lamp-2','lamp-3','motor-1'].map(id=>({id,type:id==='motor-1'?'motor':'lamp',...(id===target?{nominalCurrent:.45}:{})}))];
  let seq=0; const make=(a,b,aPort,bPort)=>({id:`e${++seq}`,a,b,aPort,bPort,heat:0});
  const edges=G.infrastructure(make);
  const other=nodes.find(n=>n.type==='lamp'&&n.id!==target).id;
  for(const n of nodes.filter(n=>['lamp','motor'].includes(n.type))) {
    const isA=n.id==='motor-1'||n.id===(moved?other:target);
    edges.push(make(`feeder-${isA?'A':'B'}`,n.id,'plus','left'),make(n.id,`feeder-${isA?'A':'B'}`,'right','minus'));
  }
  return {nodes,edges};
}
test('changing nominal demand changes actual current and overloads a previously safe allocation',()=>{
  const f=fixture();
  const increased=E.analyze(f.nodes,f.edges);
  assert.ok(increased.edges['feeder-A-plus'].current>.85);
  assert.ok(increased.nodes['lamp-1'].brightness>.8);
  delete f.nodes.find(n=>n.id==='lamp-1').nominalCurrent;
  const before=E.analyze(f.nodes,f.edges);
  assert.equal(before.allStable,true);
  assert.ok(before.edges['feeder-A-plus'].current<.75);
});
test('every boosted location has safe repartitioning while its copied pump pairing is unsafe',()=>{
  for(const target of ['lamp-1','lamp-2','lamp-3']) {
    for(const moved of [false,true]) {
      const f=fixture(target,moved), a=E.analyze(f.nodes,f.edges);
      assert.equal(a.allStable,moved,`${target} moved=${moved}`);
      if(moved) for(const s of G.status(f.nodes,f.edges,a)) assert.ok(s.current<.75 && s.current>.72);
    }
  }
});
