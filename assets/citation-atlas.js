/* Citation atlas: precomputed geometry, demand-loaded leaves, no continuous loop. */
(() => {
  'use strict';
  const count = (n, stream) => n[stream === 's1' ? 6 : stream === 's2' ? 7 : 5];
  const level = n => n >= 40 ? 'stem' : n >= 5 ? 'branch' : 'leaf';
  const sourceUrl = key => key.startsWith('doi:') ? 'https://doi.org/' + encodeURIComponent(key.slice(4)) :
    /^s2:[a-f0-9]{40}$/i.test(key) ? 'https://www.semanticscholar.org/paper/' + key.slice(3) : null;
  const intersects = (c, b) => c.x + c.radius >= b[0] && c.y + c.radius >= b[1] &&
    c.x - c.radius <= b[2] && c.y - c.radius <= b[3];
  const overlaps = (a,b) => a[2]>=b[0] && a[3]>=b[1] && a[0]<=b[2] && a[1]<=b[3];
  const searchRows = (rows,query,stream) => rows.filter(n=>count(n,stream)>0&&(!query||(n[1]+' '+n[2]).toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a,b)=>count(b,stream)-count(a,stream)||a[1].localeCompare(b[1]));
  async function buildSearchIndex(core,fetchChunk) {
    const index=new Map(core.nodes.map(n=>[n[0],n]));
    const files=[...new Set(core.clusters.flatMap(c=>c.chunks.map(v=>v.file)))];
    let next=0,failed=0;
    async function worker(){while(next<files.length){const file=files[next++];try{
      const chunk=await fetchChunk(file);chunk.nodes.forEach(n=>index.set(n[0],n));
    }catch(e){failed++;}}}
    await Promise.all([worker(),worker(),worker()]);
    return {rows:[...index.values()],complete:failed===0&&index.size===core.meta.sources,failed};
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {count, level, sourceUrl, intersects, overlaps, searchRows, buildSearchIndex}; return;
  }
  const palette = {stem: '#60436e', branch: '#9276a0', leaf: '#c5b7cd'};
  const cached = new Map();
  const get = url => {
    if (!cached.has(url)) cached.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    }).catch(e => { cached.delete(url); throw e; }));
    return cached.get(url);
  };
  function boot(root) {
    if (root.dataset.bound) return;
    root.dataset.bound = 'true';
    const $ = s => root.querySelector(s), canvas = $('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) return;
    const status = $('[data-ca-status]'), list = $('[data-ca-list]'), detail = $('[data-ca-detail]');
    const stats = {draws: 0, lastDrawMs: 0, maxDrawMs: 0, requestedChunks: 0};
    const measuredLabels = new Map();
    let data, nodes = new Map(), clusters, width = 0, height = 0, fit = 1, zoom = 1, center = [0,0];
    let frame = 0, active = false, started = false, grid = new Map(), selected = null, hover = null;
    let stream = $('[data-ca-stream]').value || 'all', levels = new Set(['stem','branch','leaf']), drawNodes = [], error = '', searchTimer;
    let orderedNodes=[],orderDirty=true,listPage=0;
    let searchIndex=null,searchPromise=null,searchError=false;
    const loaded = new Set(), pending = new Set(), queued = new Set(), failed = new Set(), queue = [];
    const fmt = n => n.toLocaleString('en-US');
    const currentBounds = () => [center[0]-width/2/(fit*zoom),center[1]-height/2/(fit*zoom),
                                center[0]+width/2/(fit*zoom),center[1]+height/2/(fit*zoom)];
    const xy = n => [(n[3]-center[0])*fit*zoom+width/2,(center[1]-n[4])*fit*zoom+height/2];
    const visible = n => count(n,stream)>0 && levels.has(level(count(n,stream)));
    function invalidate() {
      if (data && active && !document.hidden && !frame) frame = requestAnimationFrame(()=>{
        if(drag&&drag.moved&&drag.image){
          frame=0;ctx.clearRect(0,0,width,height);
          ctx.drawImage(drag.image,drag.dx,drag.dy,width,height);
        }else draw();
      });
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      width = rect.width; height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      if (data) {
        const b = data.meta.bounds;
        fit = Math.min((width-40)/(b[2]-b[0]),(height-44)/(b[3]-b[1]));
      }
      invalidate();
    }
    function whole() {
      const key=$('.ca-key');if(key)key.open=true;
      root.querySelectorAll('[data-ca-key] button').forEach(b=>b.setAttribute('aria-pressed','false'));
      const b=data.meta.bounds; center=[(b[0]+b[2])/2,(b[1]+b[3])/2]; zoom=1; invalidate();
    }
    function focusCluster(c) {
      $('.ca-key').open=true;
      center=[c.x,c.y]; zoom=Math.min(18,Math.max(2.9,Math.min(width,height)/(c.radius*2.4*fit)));
      $('[data-ca-cluster]').value=String(c.id);
      selected=null;detail.replaceChildren();
      const title=document.createElement('h4');title.textContent=c.kind==='community'?'Citation group '+(c.id+1):c.label;detail.append(title);
      const name=document.createElement('p');name.textContent=c.topic_description || (c.kind==='community'?'Prominent source: '+c.label:'These sources do not have enough shared citation links to join a group.');detail.append(name);
      if(c.topic_description){const ex=document.createElement('p');ex.className='ca-muted';ex.textContent='Representative source: '+c.prominent_source;detail.append(ex);}
      const counts=document.createElement('p');counts.textContent=fmt(c.shared)+' sources cited by at least five review papers; '+fmt(c.leaves)+' less-shared sources placed nearby.';detail.append(counts);
      const note=document.createElement('p');note.className='ca-muted';note.textContent='Grouping follows co-citation. Nearby pale dots share citing papers with this group; their positions are arranged for browsing.';detail.append(note);
      root.querySelectorAll('[data-ca-key] button').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.cluster)===c.id)));
      invalidate();
    }
    function changeZoom(factor, anchor) {
      const old=zoom, next=Math.max(1,Math.min(26,zoom*factor));
      if(anchor) {
        center[0]+=(anchor[0]-width/2)/fit*(1/old-1/next);
        center[1]-=(anchor[1]-height/2)/fit*(1/old-1/next);
      }
      zoom=next; invalidate();
    }
    function hit(x,y) {
      const gx=Math.floor(x/24),gy=Math.floor(y/24); let best=null,distance=144;
      for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) {
        for(const entry of grid.get((gx+dx)+','+(gy+dy))||[]) {
          const d=(entry.x-x)**2+(entry.y-y)**2;
          if(d<distance){best=entry.n;distance=d;}
        }
      }
      return best;
    }
    function select(n, move=false) {
      if(!nodes.has(n[0])){nodes.set(n[0],n);orderDirty=true;}
      selected=n[0]; detail.replaceChildren();
      const kicker=document.createElement('p'); kicker.className='ca-eyebrow';
      kicker.textContent=(count(n,stream)?level(count(n,stream)):'No observed link')+' · cited source'; detail.append(kicker);
      const title=document.createElement('h4'); title.textContent=n[1]; detail.append(title);
      const p=document.createElement('p'); p.textContent=fmt(count(n,stream))+' citing review papers'+(stream==='all'?' across both streams':' in Stream '+stream.slice(1)); detail.append(p);
      const sub=document.createElement('p'); sub.className='ca-muted';
      sub.textContent='Stream 1: '+fmt(n[6])+' · Stream 2: '+fmt(n[7])+' · Combined: '+fmt(n[5])+' distinct papers. Stream memberships can overlap.'; detail.append(sub);
      const url=sourceUrl(n[2]);
      if(url){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent='Open this source ↗';detail.append(a);}
      const note=document.createElement('p'); note.className='ca-muted';note.textContent='See the page-grounded examples of how sources informed a design or measure.';detail.append(note);
      const cards=document.createElement('a');cards.href='living-paper.html#fig:theory-lineage-tree';cards.textContent='Explore recorded source use →';detail.append(cards);
      if(move){center=[n[3],n[4]];zoom=Math.max(zoom,4);}
      root.dataset.selectedSource=String(n[0]); invalidate();
    }
    async function loadSearchIndex() {
      if(!data||searchPromise)return searchPromise;
      if(searchIndex&&!searchError)return;
      searchError=false;
      searchPromise=(async()=>{
        $('[data-ca-search-all]').disabled=true;
        $('[data-ca-matches]').textContent='Loading all retained source titles…';
        const result=await buildSearchIndex(data,file=>get(root.dataset.assets+file));
        searchIndex=result.rows;searchError=!result.complete;
        $('[data-ca-search-all]').disabled=false;
        $('[data-ca-search-all]').hidden=!searchError;
        $('[data-ca-search-all]').textContent=searchError?'Retry complete source index':'Search every retained source';
        updateList();
      })().finally(()=>{searchPromise=null;});
      return searchPromise;
    }
    function updateList() {
      if(!data) return;
      const q=$('[data-ca-search]').value.trim().toLocaleLowerCase();
      const rows=searchRows(searchIndex||[...nodes.values()],q,stream),pageSize=20;
      listPage=Math.min(listPage,Math.max(0,Math.ceil(rows.length/pageSize)-1));
      $('[data-ca-matches]').textContent=(searchIndex?(searchError?'Partial index — some source shards failed. Retry before interpreting absence. ':'Complete retained index. '):'Map-loaded preview; search to load every source. ')+fmt(rows.length)+(q?' matches':' sources')+' · page '+(listPage+1)+' of '+Math.max(1,Math.ceil(rows.length/pageSize));
      list.replaceChildren();
      rows.slice(listPage*pageSize,(listPage+1)*pageSize).forEach(n=>{
        const li=document.createElement('li'),button=document.createElement('button');button.type='button';
        const title=document.createElement('span');title.textContent=n[1];
        const value=document.createElement('span');value.className='ca-count';value.textContent=fmt(count(n,stream));
        button.append(title,value);button.addEventListener('click',()=>select(n,true));li.append(button);list.append(li);
      });
      if(!rows.length){const li=document.createElement('li');li.textContent=searchIndex&&!searchError?'No matching retained source.':'No match in the currently loaded sources; the complete index is not yet available.';list.append(li);}
      $('[data-ca-more]').hidden=(listPage+1)*pageSize>=rows.length;
      $('[data-ca-prev]').hidden=listPage===0;
    }
    function pump() {
      if(!active || document.hidden || (drag&&drag.moved)) return;
      while(pending.size<2 && queue.length) {
        const job=queue.shift();queued.delete(job.file);
        // A pan can make queued chunks irrelevant before they begin.
        if(zoom<6 || !levels.has('leaf') || !overlaps(job.bounds,currentBounds())) continue;
        pending.add(job.file);stats.requestedChunks++;
        get(root.dataset.assets+job.file).then(chunk=>{
          chunk.nodes.forEach(n=>nodes.set(n[0],n));loaded.add(job.file);orderDirty=true;
        }).catch(()=>{failed.add(job.file);error='Some leaves could not load. Use Retry to fetch them again.';})
          .finally(()=>{pending.delete(job.file);updateList();invalidate();pump();});
      }
    }
    function requestLeaves() {
      if(zoom<6 || !levels.has('leaf') || error) return;
      const b=currentBounds();
      for(const c of clusters) if(intersects(c,b)) for(const chunk of c.chunks) {
        if(overlaps(chunk.bounds,b)&&!loaded.has(chunk.file)&&!pending.has(chunk.file)&&!queued.has(chunk.file)&&!failed.has(chunk.file)){
          queue.push({...chunk,cluster:c});queued.add(chunk.file);
        }
      }
      pump();
    }
    function draw() {
      frame=0;if(!active||!width) return;
      const began=performance.now();ctx.clearRect(0,0,width,height);grid.clear();
      const phases=[began];
      const b=currentBounds(), scale=fit*zoom;
      const screen=new Map();
      for(const n of data.nodes){
        const [x,y]=xy(n);screen.set(n[0],{n,x,y,v:visible(n)&&(level(count(n,stream))!=='leaf'||zoom>=6)});
      }
      ctx.lineWidth=1;ctx.strokeStyle='#dce4df';
      for(const c of clusters) if(c.kind==='community' && intersects(c,b)) {
        const x=(c.x-center[0])*scale+width/2,y=(center[1]-c.y)*scale+height/2;
        ctx.beginPath();ctx.arc(x,y,c.radius*scale,0,Math.PI*2);ctx.stroke();
        if(zoom<1.6 && c.id<7) {
          const yy=y-c.radius*scale*.83;
          ctx.fillStyle='#fffef9';ctx.strokeStyle='#ab94b7';ctx.beginPath();ctx.arc(x,yy,9,0,Math.PI*2);ctx.fill();ctx.stroke();
          ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.fillStyle='#60436e';
          ctx.fillText(String(c.id+1),x,yy+4);ctx.strokeStyle='#dce4df';
        }
      }
      phases.push(performance.now());
      {
        ctx.strokeStyle='#b6a2c1';ctx.lineWidth=zoom<1.6?.45:.6;ctx.globalAlpha=zoom<1.6?.25:.65;ctx.beginPath();
        for(const [a,b] of data.edges){
          const na=screen.get(a),nb=screen.get(b);
          if(!na.v||!nb.v)continue;
          const ax=na.x,ay=na.y,bx=nb.x,by=nb.y;
          if(Math.max(ax,bx)<0||Math.min(ax,bx)>width||Math.max(ay,by)<0||Math.min(ay,by)>height)continue;
          ctx.moveTo(ax,ay);ctx.lineTo(bx,by);
        }ctx.stroke();ctx.globalAlpha=1;
      }
      phases.push(performance.now());
      drawNodes=[];
      if(orderDirty){orderedNodes=[...nodes.values()].sort((a,b)=>count(a,stream)-count(b,stream));orderDirty=false;}
      for(const n of orderedNodes) if(visible(n)) {
        const kind=level(count(n,stream));if(kind==='leaf'&&zoom<6)continue;
        const point=screen.get(n[0]),position=point?[point.x,point.y]:xy(n);
        const [x,y]=position;if(x < -12||y < -12||x>width+12||y>height+12)continue;
        drawNodes.push({n,x,y,kind});
      }
      phases.push(performance.now());
      let paintKey=null;
      for(const {n,x,y,kind} of drawNodes){
        const r=Math.max(kind==='leaf'?1.3:1.6,Math.sqrt(count(n,stream))*.43)*Math.min(1.4,Math.sqrt(zoom));
        const key=kind+'/'+count(n,stream);
        if(key!==paintKey){
          if(paintKey!==null)ctx.fill();paintKey=key;ctx.beginPath();
          ctx.fillStyle=palette[kind];ctx.globalAlpha=kind==='leaf'?.3:kind==='branch'?.86:1;
        }
        if(kind==='stem'){const rr=r*1.25;ctx.moveTo(x,y-rr);ctx.lineTo(x+rr,y);ctx.lineTo(x,y+rr);ctx.lineTo(x-rr,y);ctx.closePath();}
        else{ctx.moveTo(x+r,y);ctx.arc(x,y,r,0,Math.PI*2);}
        const cell=Math.floor(x/24)+','+Math.floor(y/24);if(!grid.has(cell))grid.set(cell,[]);grid.get(cell).push({n,x,y});
      }
      if(paintKey!==null)ctx.fill();ctx.globalAlpha=1;
      phases.push(performance.now());
      // Collision-aware names become denser with zoom; selected names always win.
      const labelBoxes=[];let labelCount=0;
      const prioritized=drawNodes.filter(a=>a.n[0]===selected||a.n[0]===hover).concat(drawNodes.slice().reverse().filter(a=>a.n[0]!==selected&&a.n[0]!==hover));
      // Bound label measurement independently of how many collision-free
      // labels fit. Dense views must not measure thousands of hidden titles.
      for(const {n,x,y} of prioritized.slice(0,100)){
        const chosen=n[0]===selected||n[0]===hover;
        if(!chosen&&(zoom<1.6||labelCount>=(zoom>5?22:9)))continue;
        const label=n[1].length>52?n[1].slice(0,49)+'…':n[1];ctx.font=(chosen?'600 ':'')+'12px system-ui';
        const measureKey=(chosen?'bold:':'normal:')+label;
        if(!measuredLabels.has(measureKey))measuredLabels.set(measureKey,ctx.measureText(label).width+10);
        const w=Math.min(width-20,measuredLabels.get(measureKey)),xx=Math.max(4,Math.min(width-w-4,x+9)),yy=y-8;
        const box=[xx,yy-13,xx+w,yy+4];
        if(!chosen&&labelBoxes.some(a=>!(box[2]<a[0]||box[0]>a[2]||box[3]<a[1]||box[1]>a[3])))continue;
        if(yy<16||yy>height-8)continue;labelBoxes.push(box);labelCount++;
        ctx.fillStyle='rgba(255,253,248,.94)';ctx.fillRect(xx-2,yy-13,w+2,18);
        ctx.fillStyle='#253e39';ctx.textAlign='left';ctx.fillText(label,xx+2,yy);
        if(chosen){ctx.strokeStyle='#795584';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.stroke();}
      }
      stats.draws++;stats.lastDrawMs=performance.now()-began;stats.maxDrawMs=Math.max(stats.maxDrawMs,stats.lastDrawMs);
      phases.push(performance.now());
      root.dataset.drawPhases=JSON.stringify(phases.slice(1).map((t,i)=>Number((t-phases[i]).toFixed(2))));
      root.dataset.drawMs=stats.lastDrawMs.toFixed(2);root.dataset.loadedNodes=String(nodes.size);
      root.dataset.drawnNodes=String(drawNodes.length);root.dataset.zoom=zoom.toFixed(2);
      root.dataset.requestedChunks=String(stats.requestedChunks);
      root.dataset.drawCount=String(stats.draws);root.dataset.maxDrawMs=stats.maxDrawMs.toFixed(2);
      $('[data-ca-zoom]').textContent=zoom.toFixed(1)+'×';
      status.textContent=error || (zoom<1.6?'Overview · choose a neighbourhood or zoom in':zoom<6?'Shared sources · zoom further for leaves':
        fmt(drawNodes.length)+' sources in view'+(pending.size?' · loading nearby leaves':''));
      $('[data-ca-retry]').hidden=!error;
      requestLeaves();
    }
    async function start() {
      if(started)return;started=true;
      try{
        data=await get(root.dataset.assets+'core.json');clusters=data.clusters;
        data.nodes.forEach(n=>nodes.set(n[0],n));root.classList.add('ca-ready');
        const menu=$('[data-ca-cluster]');
        for(const c of clusters){const o=document.createElement('option');o.value=String(c.id);
          o.textContent=(c.id+1)+'. '+c.label+(c.kind==='community'?' ('+fmt(c.shared)+' shared)':c.kind==='unplaced'?' ('+fmt(c.leaves)+' sources, outside the frame)':' ('+fmt(c.shared)+' sources)');menu.append(o);}
        const key=$('[data-ca-key]');key.replaceChildren();
        for(const c of clusters.filter(c=>c.kind==='community').slice(0,7)){
          const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.dataset.cluster=String(c.id);button.setAttribute('aria-pressed','false');
          const mark=document.createElement('span');mark.className='ca-key-number';mark.textContent=String(c.id+1);
            const label=document.createElement('span');label.textContent=c.label;
          const reach=document.createElement('small');reach.textContent=fmt(c.shared)+' shared sources';label.append(reach);
          button.append(mark,label);button.addEventListener('click',()=>focusCluster(c));li.append(button);key.append(li);
        }
        resize();whole();updateList();
      }catch(e){started=false;status.textContent='The interactive map could not load. The static figure remains available.';
        $('[data-ca-retry]').hidden=false;}
    }
    root.querySelectorAll('[data-ca-level]').forEach(input=>input.addEventListener('change',()=>{
      input.checked?levels.add(input.dataset.caLevel):levels.delete(input.dataset.caLevel);updateList();invalidate();
    }));
    $('[data-ca-stream]').addEventListener('change',e=>{stream=e.target.value;orderDirty=true;updateList();if(selected!==null)select(nodes.get(selected));invalidate();});
    $('[data-ca-cluster]').addEventListener('change',e=>{if(!data)return;e.target.value===''?whole():focusCluster(clusters[Number(e.target.value)]);});
    $('[data-ca-search]').addEventListener('input',()=>{listPage=0;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{updateList();loadSearchIndex();},150);});
    $('[data-ca-more]').addEventListener('click',()=>{listPage++;updateList();});
    $('[data-ca-prev]').addEventListener('click',()=>{listPage--;updateList();});
    $('[data-ca-search-all]').addEventListener('click',()=>{listPage=0;loadSearchIndex();});
    $('[data-ca-in]').addEventListener('click',()=>changeZoom(1.7));
    $('[data-ca-out]').addEventListener('click',()=>changeZoom(1/1.7));
    $('[data-ca-home]').addEventListener('click',()=>{whole();$('[data-ca-cluster]').value='';});
    $('[data-ca-retry]').addEventListener('click',()=>{error='';failed.clear();data?invalidate():start();});
    canvas.addEventListener('wheel',e=>{
      if(!data||(!e.ctrlKey&&document.activeElement!==canvas))return;
      e.preventDefault();const r=canvas.getBoundingClientRect();changeZoom(Math.exp(-e.deltaY*.002),[e.clientX-r.left,e.clientY-r.top]);
    },{passive:false});
    let drag=null;
    canvas.addEventListener('pointerdown',e=>{
      if(!data)return;drag={x:e.clientX,y:e.clientY,c:center.slice(),moved:false,touch:e.pointerType==='touch',dx:0,dy:0};
      if(!drag.touch){
        canvas.setPointerCapture(e.pointerId);
        drag.image=document.createElement('canvas');drag.image.width=canvas.width;drag.image.height=canvas.height;
        drag.image.getContext('2d').drawImage(canvas,0,0);
      }
    });
    canvas.addEventListener('pointermove',e=>{
      if(drag&&!drag.touch){
        if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>4)drag.moved=true;
        if(drag.moved){drag.dx=e.clientX-drag.x;drag.dy=e.clientY-drag.y;
          center=[drag.c[0]-drag.dx/(fit*zoom),drag.c[1]+drag.dy/(fit*zoom)];invalidate();}
      }else if(!drag){const r=canvas.getBoundingClientRect(),n=hit(e.clientX-r.left,e.clientY-r.top),next=n?n[0]:null;
        if(next!==hover){hover=next;canvas.style.cursor=n?'pointer':'grab';invalidate();}}
    });
    canvas.addEventListener('pointerup',e=>{
      if(!data||!drag)return;
      if(!drag.moved){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
        const n=hit(x,y);if(n&&zoom>=1.6)select(n);
        else{const wx=(x-width/2)/(fit*zoom)+center[0],wy=center[1]-(y-height/2)/(fit*zoom);
          const c=clusters.find(c=>Math.hypot(wx-c.x,wy-c.y)<c.radius);if(c)focusCluster(c);}}
      drag=null;invalidate();
    });
    canvas.addEventListener('pointercancel',()=>{drag=null;invalidate();});
    canvas.addEventListener('keydown',e=>{
      if(!data)return;
      if(e.key==='+'||e.key==='=')changeZoom(1.5);else if(e.key==='-')changeZoom(1/1.5);else if(e.key==='Home')whole();
      else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
        center[e.key==='ArrowLeft'||e.key==='ArrowRight'?0:1]+=(e.key==='ArrowLeft'||e.key==='ArrowDown'?-70:70)/(fit*zoom);invalidate();
      }else return;e.preventDefault();
    });
    const saveData=navigator.connection&&navigator.connection.saveData;
    const idle=window.requestIdleCallback||((f)=>setTimeout(f,0));
    if('IntersectionObserver' in window){
      new IntersectionObserver(entries=>{for(const e of entries){active=e.isIntersecting;
        if(active){start();invalidate();pump();}else if(frame){cancelAnimationFrame(frame);frame=0;}}},{threshold:0}).observe(root);
      if(!saveData){const prefetch=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){
        idle(()=>get(root.dataset.assets+'core.json').catch(()=>{}),{timeout:1500});prefetch.disconnect();}},{rootMargin:'700px'});prefetch.observe(root);}
    }else{active=true;start();}
    if('ResizeObserver' in window)new ResizeObserver(resize).observe(canvas);else window.addEventListener('resize',resize);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;}else{invalidate();pump();}});
  }
  function run(){document.querySelectorAll('[data-citation-atlas]').forEach(boot);}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',run):run();
})();
