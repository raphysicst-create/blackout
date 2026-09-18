/* Implementation regression only. Independent verdicts live in independent/. */
(() => {
  const frame = document.getElementById('game');
  const results = document.getElementById('results');
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  function run() {
    const w = frame.contentWindow, api = w.BlackoutTesting, report = [];
    const snap = () => api.snapshot();
    const test = (name, fn) => { try { fn(); report.push({ name, status:'pass' }); } catch(e) { report.push({name,status:'fail',error:e.message}); } };
    const reset = seed => { api.reset({seed}); api.start(); };
    const connect = (id, feeder) => {
      assert(api.connect(`feeder-${feeder}`,id,'plus','left'),`${id} feed`);
      assert(api.connect(id,`feeder-${feeder}`,'right','minus'),`${id} return`);
    };
    test('closed first circuit and forbidden infrastructure edits', () => {
      reset(101);
      assert(!api.connect('source','lamp-1','plus','left'),'source bypass');
      assert(!api.remove('feeder-A-plus'),'fixed deletion');
      connect('lamp-1','A');
      assert(snap().analysis.allStable,'first loop');
      assert(!api.branch('feeder-A-plus',{x:300,y:300},'lamp-1','left'),'free branch');
    });
    test('repeated attempts cannot multiply current capacity or add a second terminal wire', () => {
      reset(101); connect('lamp-1','A');
      const count = snap().edges.length;
      assert(!api.connect('feeder-B','lamp-1','plus','left'),'occupied terminal');
      assert(!api.connect('feeder-A','feeder-B','plus','plus'),'feeder bridge');
      assert(snap().edges.length===count,'failed edits mutated graph');
    });
    if (api.undo) test('inherited series wiring requires revision and one deletion can be undone', () => {
      reset(101); connect('lamp-1','A'); api.advance(12.1);
      const state=snap();
      assert(state.lessonStarted,'repair step missing');
      assert(state.analysis.nodes['lamp-1'].brightness>.8,'player circuit overwritten');
      assert(state.analysis.nodes['lamp-2'].brightness<.8 && state.analysis.nodes['lamp-2'].powered,'old circuit not dim');
      const old=state.edges.find(e=>e.a==='lamp-2'&&e.b==='lamp-3');
      assert(old,'middle wire missing');
      api.remove(old.id); assert(!snap().analysis.nodes['lamp-2'].powered,'cut did not open');
      assert(api.undo(),'undo refused');
      assert(snap().edges.some(e=>e.id===old.id),'wrong undo wire');
      api.remove(old.id);
      assert(api.connect('lamp-2','feeder-B','right','minus'),'new return');
      assert(!api.undo(),'stale undo after new edit');
      assert(api.connect('feeder-B','lamp-3','plus','left'),'new feed');
      assert(snap().analysis.allStable,'repair not stable');
      api.advance(.3); assert(snap().lessonSolved,'repair completion not observed');
    });
    test('three district runs complete using real progression and safe final allocations', () => {
      for (const seed of [101,202,303]) {
        reset(seed);
        let graphKey = '';
        for (let second=0; second<100 && snap().mode==='playing'; second++) {
          const state=snap(), loads=state.nodes.filter(n=>['lamp','motor'].includes(n.type));
          const newKey=loads.map(n=>`${n.id}:${n.type}:${n.nominalCurrent||0}`).join('|');
          if(newKey!==graphKey) {
            for(const edge of state.edges.filter(e=>!e.fixed)) api.remove(edge.id);
            // Exhaustively find a safe partition with the actual engine and current loads.
            let assignment;
            for(let mask=0;mask<(1<<loads.length);mask++) {
              const edges=api.snapshot().edges.map(e=>({...e,heat:0,open:false}));
              loads.forEach((n,i)=>{ const feeder=`feeder-${(mask>>i)&1?'B':'A'}`; edges.push({id:`p${i}`,a:feeder,aPort:'plus',b:n.id,bPort:'left'},{id:`r${i}`,a:n.id,aPort:'right',b:feeder,bPort:'minus'}); });
              if(w.BlackoutEngine.analyze(state.nodes,edges).allStable) { assignment=loads.map((n,i)=>((mask>>i)&1)?'B':'A'); break; }
            }
            assert(assignment,`no safe partition seed ${seed}`);
            loads.forEach((n,i)=>connect(n.id,assignment[i])); graphKey=newKey;
          }
          api.advance(1);
          for(const n of snap().nodes.filter(n=>n.tripped)) api.resetFeeder(n.id);
        }
        assert(snap().mode==='won',`seed ${seed} incomplete`);
        const scenario=w.BlackoutRuns.scenarios.find(s=>s.seed===seed);
        if(scenario.surgeId) {
          assert(snap().surgeId===scenario.surgeId,`seed ${seed} wrong surge target`);
          assert(snap().nodes.find(n=>n.id===scenario.surgeId).nominalCurrent===.45,`seed ${seed} no actual changed load`);
        }
        api.advance(7.1);
        assert(!w.document.getElementById('result').hidden,`seed ${seed} no result`);
      }
    });
    if ('demandChanged' in snap()) test('demand increase causes a real trip; moving two loads permits safe recovery', () => {
      reset(101); connect('lamp-1','A'); api.advance(12.5);
      const middle=snap().edges.find(e=>e.a==='lamp-2'&&e.b==='lamp-3'); api.remove(middle.id);
      api.connect('lamp-2','feeder-B','right','minus'); api.connect('feeder-B','lamp-3','plus','left');
      api.advance(12.5); connect('motor-1','A'); api.advance(12);
      assert(snap().demandChanged,'final demand skipped'); assert(snap().mode==='playing','premature win');
      assert(snap().analysis.edges['feeder-A-plus'].overloaded,'demand has no electrical effect');
      api.advance(6.1);
      assert(snap().nodes.find(n=>n.id==='feeder-A').tripped,'A failed to trip');
      assert(snap().analysis.nodes['lamp-2'].powered,'healthy circuit blacked out');
      api.advance(3.1); assert(!api.resetFeeder('feeder-A'),'unsafe reset allowed');
      for(const id of ['lamp-1','lamp-2']) for(const e of snap().edges.filter(e=>!e.fixed&&(e.a===id||e.b===id))) api.remove(e.id);
      connect('lamp-1','B'); connect('lamp-2','A');
      assert(api.resetFeeder('feeder-A'),'safe reset blocked'); api.advance(8.1);
      assert(snap().mode==='won','repaired run cannot finish');
      assert(api.events().events.filter(e=>e.event==='demand_changed').length===1,'demand applied repeatedly');
    });
    if (w.BlackoutRuns.scenarios[0].surgeId) test('next district and same district restart reset all campaign state', () => {
      api.advance(7.1);
      w.document.getElementById('replay-button').click();
      assert(snap().seed===202 && snap().surgeId==='lamp-2','wrong next campaign');
      assert(!snap().demandChanged && !snap().lessonStarted && snap().time===0,'campaign state leaked');
      assert(w.BlackoutSession.history().length===1,'missing history');
      w.document.getElementById('replay-button').click(); assert(snap().seed===202,'duplicate replay');
      w.document.getElementById('pause-button').click();
      w.document.getElementById('restart-button').click();
      assert(snap().seed===202 && snap().mode==='playing' && !snap().paused,'restart changed district');
      assert(!api.undo(),'undo leaked');
      assert(w.document.getElementById('pause-button').getAttribute('aria-label')==='일시 정지','pause label leaked');
    });
    results.textContent=JSON.stringify({passed:report.filter(r=>r.status==='pass').length,total:report.length,cases:report},null,2);
    results.dataset.done='true';
  }
  frame.addEventListener('load',run);
  document.getElementById('run').addEventListener('click',run);
})();
