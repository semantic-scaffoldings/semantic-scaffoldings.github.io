/* Fixed coordinates; no simulation, semantic inference, or background render loop. */
(() => {
  'use strict';
  const COLORS = {1:'#b75229', 2:'#487b85', 4:'#867a91'};
  const LABELS = {1:'Applied', 2:'Conceptual', 4:'Citation only'};
  const cardURL = card => `card-gallery.html?card=${encodeURIComponent(card)}`;
  const unpack = (fields, rows) => rows.map(row => Object.fromEntries(fields.map((k,i) => [k,row[i]])));
  const el = (tag, text, cls) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n; };
  function init(root) {
    if(root.dataset.ksReady) return;
    root.dataset.ksReady='true';
    const q=s=>root.querySelector(s), canvas=q('[data-ks-canvas]'), ctx=canvas.getContext('2d');
    const status=q('[data-ks-status]'), results=q('[data-ks-results]'), detail=q('[data-ks-selection]');
    const search=q('[data-ks-search]'), scope=q('[data-ks-scope]'), more=q('[data-ks-more]');
    let data, promise, nodes, sources, papers, sourceById, paperById, atlasById, bySource, byPaper;
    let visible=false, queued=false, selected=null, page=40, pairPage=40, transform, hitNodes=[];
    const mask=()=>Array.from(root.querySelectorAll('[data-ks-layer]:checked')).reduce((n,b)=>n|(Number(b.dataset.ksLayer)||0),0);
    const context=()=>q('[data-ks-layer="context"]').checked;
    const isMain=n=>n && data.communities.some(c=>c.id===n.cluster);
    function schedule() {
      if(!data || !visible || queued || !ctx) return;
      queued=true;
      requestAnimationFrame(()=>{queued=false;if(visible)draw();});
    }
    const point=n=>[transform.x+(n.x-data.bounds[0])*transform.s,transform.y+(n.y-data.bounds[1])*transform.s];
    function line(a,b,color,dashed=false,width=1) {
      const p=point(a),r=point(b);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dashed?[4,4]:[]);
      ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...r);ctx.stroke();ctx.setLineDash([]);
    }
    function dot(n,color,r=2) {const p=point(n);ctx.fillStyle=color;ctx.beginPath();ctx.arc(...p,r,0,Math.PI*2);ctx.fill();}
    function selectedPairs() {
      if(!selected || selected.kind==='atlas') return [];
      return (selected.kind==='paper'?byPaper.get(selected.id):bySource.get(selected.id))?.filter(p=>p.role_mask&mask()) || [];
    }
    function draw() {
      const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height,dpr=Math.min(window.devicePixelRatio||1,2);
      if(!w||!h)return;
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
      const [x0,y0,x1,y1]=data.bounds,s=Math.min((w-32)/(x1-x0),(h-32)/(y1-y0));
      transform={s,x:(w-(x1-x0)*s)/2,y:(h-(y1-y0)*s)/2};
      for(const c of data.communities) {const p=point(c);ctx.fillStyle='rgba(176,146,118,.035)';ctx.beginPath();ctx.arc(...p,c.radius*s,0,Math.PI*2);ctx.fill();}
      if(context()) {
        for(const [a,b] of data.context_edges) {const A=atlasById.get(a),B=atlasById.get(b);if(isMain(A)&&isMain(B))line(A,B,'rgba(151,133,115,.14)',false,.65);}
        for(const n of nodes)if(isMain(n))dot(n,'rgba(141,123,106,.29)',1.05);
      }
      ctx.font='10px system-ui,sans-serif';ctx.textAlign='center';
      const labelBoxes=[];
      for(const c of [...data.communities].sort((a,b)=>b.radius-a.radius).slice(0,5)) {
        const [x,y]=point(c),maxWidth=Math.min(170,w-24);
        let label=c.label;
        while(label.length>1&&ctx.measureText(label).width>maxWidth)label=label.slice(0,-2)+'…';
        const width=ctx.measureText(label).width,lx=Math.max(width/2+8,Math.min(w-width/2-8,x));
        const desired=Math.max(14,Math.min(h-8,y-c.radius*s+13));
        let ly=desired;
        // Retain fixed node positions; move only overlapping labels on narrow
        // canvases so no title is clipped at the edge or printed over another.
        for(const offset of [0,16,-16,32,-32,48,-48]) {
          const candidate=Math.max(14,Math.min(h-8,desired+offset));
          if(!labelBoxes.some(b=>Math.abs(candidate-b.y)<15&&Math.abs(lx-b.x)<(width+b.width)/2+8)){ly=candidate;break;}
        }
        labelBoxes.push({x:lx,y:ly,width});
        ctx.fillStyle='rgba(251,248,241,.94)';ctx.fillRect(lx-width/2-4,ly-10,width+8,14);
        ctx.fillStyle='#766953';ctx.fillText(label,lx,ly);
      }
      for(const n of sources) {const a=atlasById.get(n.atlas_id);if(isMain(a))dot(a,selected?'rgba(94,121,115,.18)':'rgba(67,110,111,.55)',1.7);}
      const pairs=selectedPairs();
      for(const p of pairs) {
        const source=sourceById.get(p.source_id),paper=paperById.get(p.target_id),a=atlasById.get(source.atlas_id),b=atlasById.get(paper.atlas_id);
        const role=[1,2,4].find(v=>p.role_mask&mask()&v),color=COLORS[role];
        if(isMain(a)&&isMain(b))line(a,b,color,role!==1,1.3);
        if(isMain(a))dot(a,color,3.4);if(isMain(b))dot(b,color,3.4);
      }
      if(selected) {
        const work=selected.kind==='paper'?paperById.get(selected.id):selected.kind==='source'?sourceById.get(selected.id):atlasById.get(selected.id);
        const a=selected.kind==='atlas'?work:atlasById.get(work.atlas_id);
        if(isMain(a)) {const p=point(a);dot(a,'#282622',4.3);ctx.strokeStyle='#fffaf0';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(...p,6,0,Math.PI*2);ctx.stroke();}
      }
      // Picking is bounded to the prepared scene; source/paper roles share an anchor.
      hitNodes=nodes.filter(isMain);
    }
    function pick(kind,id) {selected={kind,id};pairPage=40;renderDetail();detail.parentElement.scrollTop=0;schedule();}
    function button(text,callback) {const b=el('button',text);b.type='button';b.addEventListener('click',callback);return b;}
    function openPair(link,pair) {
      link.href=cardURL(pair.original_card);
      link.addEventListener('click',event=>{
        if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
        const handled=!root.dispatchEvent(new CustomEvent('knowledge-space:open-pair',{
          bubbles:true,cancelable:true,detail:{snapshotId:data.lineage_snapshot_id,sourceId:pair.source_id,targetId:pair.target_id}
        }));
        if(handled)event.preventDefault();
      });
    }
    function renderDetail() {
      detail.replaceChildren();
      if(!selected)return;
      const work=selected.kind==='paper'?paperById.get(selected.id):selected.kind==='source'?sourceById.get(selected.id):atlasById.get(selected.id);
      detail.append(el('h4',work.title));
      if(selected.kind==='atlas') {
        detail.append(el('p','Historical reference context. No exact recorded-use join is available in this lineage snapshot.'));
        if(work.key.startsWith('doi:')) {const a=el('a','Open DOI');a.href='https://doi.org/'+encodeURI(work.key.slice(4));detail.append(a);}
        return;
      }
      const placement=work.position==='main'?'Fixed atlas position':work.position==='offmap'?'Unconnected or unplaced atlas group · listed outside the map':'No exact atlas anchor · listed outside the map';
      detail.append(el('p',placement,'ks-position'));
      if(selected.kind==='source' && work.atlas_id!==null) {
        const counterpart=papers.find(n=>n.atlas_id===work.atlas_id);
        if(counterpart)detail.append(button('View this work as a review paper',()=>pick('paper',counterpart.id)));
      }
      if(selected.kind==='paper') {
        const a=el('a','Open original lineage card');a.href=cardURL(work.card);detail.append(a);
        detail.append(el('p',`${work.pairs} recorded source–paper pairs; ${work.card_local_pairs} card-local pairs without a resolved DOI/S2 identity are available in the original card.`));
      }
      const pairs=selectedPairs();
      detail.append(el('p',`${pairs.length} identified ${selected.kind==='paper'?'source relationships':'paper relationships'} in the selected layers. Missing map lines are not absence of foundations.`,'ks-pair-count'));
      const list=el('ol',undefined,'ks-pairs');
      for(const p of pairs.slice(0,pairPage)) {
        const other=selected.kind==='paper'?sourceById.get(p.source_id):paperById.get(p.target_id),kind=selected.kind==='paper'?'source':'paper';
        const li=el('li');li.append(button(other.title,()=>pick(kind,other.id)));
        li.append(el('span',[1,2,4].filter(v=>p.role_mask&v).map(v=>LABELS[v]).join(' · '),'ks-role'));
        const a=el('a','Read recorded passage');openPair(a,p);li.append(a);list.append(li);
      }
      detail.append(list);
      if(pairs.length>pairPage)detail.append(button(`Show more relationships (${pairs.length-pairPage} remaining)`,()=>{pairPage+=40;renderDetail();}));
    }
    function renderResults() {
      if(!data)return;
      const term=search.value.trim().toLocaleLowerCase();
      let pool=scope.value==='sources'?sources.map(n=>({...n,kind:'source'})):scope.value==='unplaced'?
        [...papers.map(n=>({...n,kind:'paper'})),...sources.map(n=>({...n,kind:'source'}))].filter(n=>n.position!=='main'):papers.map(n=>({...n,kind:'paper'}));
      pool=pool.filter(n=>!term||`${n.title} ${n.key||''}`.toLocaleLowerCase().includes(term));
      // Start with inspectable connections rather than arbitrary card-file order.
      // This is a browsing order, not a ranking of a paper's evidence or importance.
      const links=n=>(n.kind==='paper'?byPaper:bySource).get(n.id)||[];
      const mapped=n=>links(n).filter(p=>sourceById.get(p.source_id).position==='main' && paperById.get(p.target_id).position==='main').length;
      pool=pool.map(n=>({...n,mapped:mapped(n),identified:links(n).length}));
      pool.sort((a,b)=>b.mapped-a.mapped||b.identified-a.identified||a.title.localeCompare(b.title));
      results.replaceChildren();
      for(const n of pool.slice(0,page)) {
        const li=el('li');li.append(button(n.title,()=>pick(n.kind,n.id)));
        li.append(el('span',`${n.kind==='paper'?'Paper':'Source'} · ${n.mapped?`${n.mapped} mapped connections`:n.identified?`${n.identified} recorded connections`:'See source card'}`,'ks-position'));results.append(li);
      }
      status.textContent=`${pool.length.toLocaleString()} works · showing ${Math.min(page,pool.length)}, most mapped connections first.`;
      more.hidden=pool.length<=page;
    }
    async function load() {
      if(promise)return promise;
      promise=(async()=>{
        status.textContent='Loading the fixed map…';
        const response=await fetch(root.dataset.source,{credentials:'same-origin'});
        if(!response.ok)throw new Error('Map data unavailable');data=await response.json();
        if(data.version!==1)throw new Error('Unsupported map data');
        nodes=unpack(data.atlas_fields,data.atlas_nodes);sources=unpack(data.source_fields,data.sources);papers=unpack(data.paper_fields,data.papers);
        sourceById=new Map(sources.map(n=>[n.id,n]));paperById=new Map(papers.map(n=>[n.id,n]));atlasById=new Map(nodes.map(n=>[n.id,n]));
        bySource=new Map();byPaper=new Map();
        for(const p of unpack(data.pair_fields,data.pairs)) {if(!bySource.has(p.source_id))bySource.set(p.source_id,[]);bySource.get(p.source_id).push(p);if(!byPaper.has(p.target_id))byPaper.set(p.target_id,[]);byPaper.get(p.target_id).push(p);}
        renderResults();schedule();
      })().catch(()=>{data=null;status.textContent='The interactive map could not load. The static figure and evidence cards remain available.';});
      return promise;
    }
    search.addEventListener('input',()=>{page=40;load().then(renderResults);});
    scope.addEventListener('change',()=>{page=40;load().then(renderResults);});
    more.addEventListener('click',()=>{page+=40;renderResults();});
    q('[data-ks-reset]').addEventListener('click',()=>{selected=null;detail.replaceChildren();search.value='';page=40;renderResults();schedule();});
    root.querySelectorAll('[data-ks-layer]').forEach(b=>b.addEventListener('change',()=>{if(data){renderDetail();schedule();}}));
    canvas.addEventListener('click',event=>{
      if(!data||!transform)return;const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
      let best=null,distance=100;
      for(const n of hitNodes) {const [a,b]=point(n),d=(a-x)**2+(b-y)**2;if(d<distance){distance=d;best=n;}}
      if(!best)return;
      const source=sources.find(n=>n.atlas_id===best.id),paper=papers.find(n=>n.atlas_id===best.id);
      if(source)pick('source',source.id);else if(paper)pick('paper',paper.id);else pick('atlas',best.id);
    });
    if(window.ResizeObserver)new ResizeObserver(schedule).observe(canvas);
    if(window.IntersectionObserver) {
      new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible){load();schedule();}},{rootMargin:'120px'}).observe(root);
    } else {visible=true;load();window.addEventListener('resize',schedule,{passive:true});}
  }
  const start=()=>document.querySelectorAll('[data-knowledge-space]').forEach(init);
  window.KnowledgeSpace={init:start};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
