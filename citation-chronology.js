/* Source-bound graph navigation; no inferred source-use relations. */
(() => {
 'use strict';
 const NS='http://www.w3.org/2000/svg', PAGE=4;
 const E=(tag,attrs={},text)=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;};
 const H=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const wrap=(text,max=29)=>{const out=[];let row='';for(const w of String(text).split(/\s+/)){if(row.length+w.length>max&&row){out.push(row);row='';}row+=(row?' ':'')+w;}if(row)out.push(row);return out;};
 const labels={motivates_design:'Motivates the design',frames_problem:'Frames the problem',explains_mechanism:'Explains a mechanism',informs_measurement:'Informs measurement',critiques:'Critiques',mentions:'Mentions'};
 const enactments={operationalized:'Applied in design or measurement',conceptually_used:'Conceptual use',cited_not_used:'Citation only'};
 const fmt=n=>Number(n||0).toLocaleString();
 const yearLabel=n=>n.year_state==='conflicting'?'Year conflicts':n.year||'Year not recorded';
 const nodeYearLabel=n=>n.year&&n.year_state!=='conflicting'?`${yearLabel(n)} · ${n.kind==='paper'?'AI PAPER':'PRIOR SOURCE'}`:yearLabel(n);
 function nodeMeta(n){return n.kind==='paper'?`${yearLabel(n)} · ${n.venue||'AI paper'}`:`${yearLabel(n)} · ${fmt(n.papers)} ${n.papers===1?'paper':'papers'} with recorded use`;}
 function handleKnowledgePair(root,event){if(root.openKnowledgePair?.(event.detail)){event.preventDefault();return true;}return false;}
 async function sourcePassages(pair,loadEvidence){
  const cards=[...new Set(pair.evidence.map(s=>s.card))];
  const records=new Map(await Promise.all(cards.map(async card=>[card,await loadEvidence(card)])));
  const shown=new Set(),passages=[];
  for(const support of pair.evidence){
   const record=records.get(support.card),quotes=[];
   for(const id of support.ids){
    const key=support.card+'\u0000'+id;if(shown.has(key))continue;
    const quote=record?.excerpts?.[id];if(!quote?.exact_quote||!quote.physical_page_index)throw Error('Missing original card passage');
    shown.add(key);quotes.push(quote);
   }
   passages.push({support,quotes});
  }
  return {records,passages};
 }
 async function init(root){
  const $=s=>root.querySelector(s),svg=$('.ct-svg'),stage=$('.ct-stage'),detail=$('.ct-detail'),status=$('.ct-status'),results=$('.ct-results'),search=$('[data-ct-search]'),role=$('[data-ct-role]');
  const container=root.closest('figure');if(container){container.classList.remove('publication-visual-loading');container.classList.add('publication-visual-ready');container.removeAttribute('aria-busy');container.style.aspectRatio='auto';}
  let D;try{const r=await fetch(root.dataset.source);if(!r.ok)throw Error(r.status);D=await r.json();}catch(e){status.textContent='Graph data could not load. Reload this page or use the static figure.';return;}
  const nodes=D.nodes.map(row=>Object.fromEntries(D.node_fields.map((k,i)=>[k,row[i]]))),byId=new Map(nodes.map(n=>[n.id,n]));
  const edges=D.edges.map(([a,b,mask],i)=>({a:nodes[a].id,b:nodes[b].id,mask,id:i}));
  const adjacent=new Map(nodes.map(n=>[n.id,[]]));for(const e of edges){adjacent.get(e.a).push(e);adjacent.get(e.b).push(e);}
  const pairIndex=new Map(edges.map(e=>[e.a+'\u0000'+e.b,e]));
  const deepDive=$('[data-ks-deep-dive]');
  const ranked=D.metrics.ranked_sources.map(id=>byId.get(id)),history=[],shards=new Map();
  let selected=ranked.find(n=>n.year)?.id||ranked[0]?.id,mode='neighborhood',page=0,resultLimit=30,positions=new Map(),visible=[],shownEdges=[],bounds={x:0,y:0,w:1000,h:600},view={...bounds},detailToken=0,drag=null;
  function accepted(e){return role.value==='all'||role.value==='applied'&&(e.mask&1)||role.value==='conceptual'&&(e.mask&2)||role.value==='use'&&(e.mask&3);}
  function neighbor(e,id){return e.a===id?e.b:e.a;}
  function link(text,href){const a=H('a','',text);a.href=href;return a;}
  function button(text,run,cls){const b=H('button',cls,text);b.type='button';b.addEventListener('click',run);return b;}
  function paperLink(n){return link('Open paper cards ↗','card-gallery.html?card='+encodeURIComponent(n.card));}
  function renderList(){
   const q=search.value.trim().toLocaleLowerCase();let list=q?nodes.filter(n=>(n.title+' '+n.key).toLocaleLowerCase().includes(q)):ranked.filter(n=>n.papers>=2);list=list.filter(n=>adjacent.get(n.id).some(accepted));
   if(q)list.sort((a,b)=>(b.papers||0)-(a.papers||0)||(a.year||3000)-(b.year||3000)||a.id.localeCompare(b.id));
   results.replaceChildren();$('.ct-list-heading').replaceChildren(document.createTextNode(q?`${fmt(list.length)} matching works`:'Shared sources'),H('span','',q?'Select to explore its connections':'Ranked by papers with recorded use'));
   for(const n of list.slice(0,resultLimit)){const b=button('',()=>choose(n.id),'ct-result');b.dataset.result=n.id;b.setAttribute('aria-pressed',String(n.id===selected&&mode==='neighborhood'));b.append(H('strong','',n.title),H('span','',nodeMeta(n)));results.append(b);}
   if(!list.length)results.append(H('p','','No matching work in this connection view.'));$('[data-ct-more]').hidden=list.length<=resultLimit;
  }
  function remember(){history.push({id:selected,mode,page});$('[data-ct-back]').disabled=false;}
  function choose(id,push=true){if(push)remember();selected=id;mode='neighborhood';page=0;draw();renderList();showNode(id);}
  function setView(v){view=v;svg.setAttribute('viewBox',`${v.x} ${v.y} ${v.w} ${v.h}`);$('.ct-zoom-label').value=Math.round(100*bounds.w/v.w)+'%';root.classList.toggle('ct-close',mode==='neighborhood'||v.w<1800);}
  function fit(){const r=stage.getBoundingClientRect(),ratio=r.width/r.height;let w=bounds.w,h=bounds.h;if(w/h<ratio)w=h*ratio;else h=w/ratio;setView({x:bounds.x+(bounds.w-w)/2,y:bounds.y+(bounds.h-h)/2,w,h});}
  function zoom(factor,cx=.5,cy=.5){const w=Math.max(400,Math.min(bounds.w*3,view.w*factor)),h=w*view.h/view.w;setView({x:view.x+(view.w-w)*cx,y:view.y+(view.h-h)*cy,w,h});}
  function trace(id){const related=new Set([id]);for(const e of shownEdges)if(e.a===id||e.b===id)related.add(neighbor(e,id));svg.querySelectorAll('[data-node]').forEach(e=>e.classList.toggle('is-dim',!!id&&!related.has(e.dataset.node)));svg.querySelectorAll('[data-edge]').forEach(e=>{const edge=edges[+e.dataset.edge];e.classList.toggle('is-on',!!id&&(edge.a===id||edge.b===id));});}
  function hint(n,event){trace(n.id);const tip=$('.ct-tooltip');tip.replaceChildren(H('strong','',n.title),H('span','',nodeMeta(n)));tip.hidden=false;if(event?.clientX){const r=stage.getBoundingClientRect();tip.style.left=Math.max(10,Math.min(event.clientX-r.left+12,r.width-300))+'px';tip.style.top=Math.max(10,Math.min(event.clientY-r.top+18,r.height-100))+'px';}else{tip.style.left='18px';tip.style.top='18px';}}
  function unhint(){trace(null);$('.ct-tooltip').hidden=true;}
  function yearAxis(ns,width,height){
   const dated=ns.map(n=>n.year).filter(Boolean);let lo=dated.length?Math.min(...dated):2019,hi=dated.length?Math.max(...dated):2026;if(hi===lo){lo-=1;hi+=1;}
   const unknown=ns.some(n=>!n.year),left=unknown?Math.min(width*.65,350):110,right=width-110,x=year=>year?left+(year-lo)/(hi-lo)*(right-left):105,span=hi-lo,step=span<=10?1:span<=30?5:span<=80?10:25;
   for(let yr=Math.ceil(lo/step)*step;yr<=hi;yr+=step){const xx=x(yr);svg.append(E('line',{x1:xx,y1:45,x2:xx,y2:height-60,class:'ct-grid'}),E('text',{x:xx,y:28,'text-anchor':'middle',class:'ct-tick'},yr));}
   if(unknown)svg.append(E('rect',{x:12,y:46,width:190,height:height-110,rx:12,class:'ct-undated'}),E('text',{x:105,y:28,'text-anchor':'middle',class:'ct-tick'},'Year unresolved'));return x;
  }
  function draw(){
   unhint();svg.replaceChildren();positions=new Map();let neighbours=[];
   if(mode==='neighborhood'){
    const all=adjacent.get(selected).filter(accepted).sort((a,b)=>{const x=byId.get(neighbor(a,selected)),y=byId.get(neighbor(b,selected));return(x.year||3000)-(y.year||3000)||x.title.localeCompare(y.title)||x.id.localeCompare(y.id);});
    page=Math.max(0,Math.min(page,Math.ceil(all.length/PAGE)-1));shownEdges=all.slice(page*PAGE,(page+1)*PAGE);neighbours=shownEdges.map(e=>byId.get(neighbor(e,selected)));visible=[byId.get(selected),...neighbours];
    status.textContent=all.length?`${page*PAGE+1}–${Math.min((page+1)*PAGE,all.length)} of ${fmt(all.length)} connections · Publication year →`:'No connections in this view. Try another connection type.';$('[data-ct-prev]').disabled=page===0;$('[data-ct-next]').disabled=(page+1)*PAGE>=all.length;
   }else{
    const shared=new Set(ranked.filter(n=>n.papers>=2).map(n=>n.id));shownEdges=edges.filter(e=>shared.has(e.a)&&accepted(e));const ids=new Set(shownEdges.flatMap(e=>[e.a,e.b]));visible=nodes.filter(n=>ids.has(n.id));status.textContent=`${fmt(new Set(shownEdges.map(e=>e.a)).size)} of ${fmt(shared.size)} shared sources · ${fmt(shownEdges.length)} visible source–paper pairs · Select a node to open its neighborhood`;$('[data-ct-prev]').disabled=true;$('[data-ct-next]').disabled=true;
   }
   $('[data-ct-overview]').setAttribute('aria-pressed',String(mode==='overview'));
   if(!visible.length){bounds={x:0,y:0,w:1000,h:600};fit();return;}
   const width=mode==='neighborhood'?Math.max(340,stage.clientWidth):3800,height=mode==='neighborhood'?Math.max(420,(neighbours.length+1)*100+60):2100,x=yearAxis(visible,width,height),cw=Math.min(220,width*.4),ch=94;
   if(mode==='neighborhood'){
    const center=byId.get(selected);positions.set(selected,{x:x(center.year),y:96});
    neighbours.forEach((n,i)=>positions.set(n.id,{x:x(n.year),y:196+i*100}));
   }else{
    // Components and repeated neighbor-median sweeps, with stable ID tie breaks.
    const sorted=[...visible].sort((a,b)=>(a.component??1e6)-(b.component??1e6)||(b.papers||0)-(a.papers||0)||a.id.localeCompare(b.id));let order=new Map(sorted.map((n,i)=>[n.id,i]));
    for(let pass=0;pass<4;pass++){const score=new Map();for(const n of sorted){const ranks=adjacent.get(n.id).filter(e=>accepted(e)&&order.has(neighbor(e,n.id))).map(e=>order.get(neighbor(e,n.id))).sort((a,b)=>a-b);score.set(n.id,ranks.length?ranks[Math.floor(ranks.length/2)]:order.get(n.id));}sorted.sort((a,b)=>(a.component??1e6)-(b.component??1e6)||score.get(a.id)-score.get(b.id)||a.id.localeCompare(b.id));order=new Map(sorted.map((n,i)=>[n.id,i]));}
    const slots=new Map();sorted.forEach(n=>{const xx=x(n.year),col=Math.round(xx/22),taken=slots.get(col)||new Set();let y=80+order.get(n.id)/sorted.length*(height-180);while([...taken].some(t=>Math.abs(y-t)<20))y+=21;taken.add(y);slots.set(col,taken);positions.set(n.id,{x:xx,y});});
   }
   const maxY=Math.max(height,...[...positions.values()].map(p=>p.y+ch)),defs=E('defs'),marker=E('marker',{id:'ct-arrow-'+root.dataset.ctId,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});marker.append(E('path',{d:'M0 0 L10 5 L0 10 Z',fill:'context-stroke'}));defs.append(marker);svg.append(defs);
   for(const e of shownEdges){const a=positions.get(e.a),b=positions.get(e.b);if(!a||!b)continue;const dir=b.x>=a.x?1:-1,offset=mode==='neighborhood'?cw/2:8,sx=a.x+dir*offset,tx=b.x-dir*offset,mid=(sx+tx)/2,path=`M${sx} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${tx} ${b.y}`;
    const g=E('g',{'data-edge':e.id,class:'ct-edge',role:'button',tabindex:mode==='neighborhood'?'0':'-1','aria-label':`${byId.get(e.a).title} → ${byId.get(e.b).title}. Read source passage.`});g.append(E('path',{d:path,class:'ct-link',style:'stroke:'+(e.mask&1?'#be501e':e.mask&2?'#416e83':'#8b867f'),'stroke-dasharray':e.mask&1?'':e.mask&2?'7 5':'2 5','marker-end':`url(#ct-arrow-${root.dataset.ctId})`}),E('path',{d:path,class:'ct-edge-hit'}));g.addEventListener('click',()=>showEdge(e));g.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();showEdge(e);}});g.addEventListener('focus',()=>g.classList.add('is-on'));g.addEventListener('blur',()=>g.classList.remove('is-on'));svg.append(g);
   }
   for(const n of visible){const p=positions.get(n.id),g=E('g',{class:'ct-node '+(n.kind==='paper'?'ct-paper':'ct-source')+(n.id===selected&&mode==='neighborhood'?' ct-selected':''),'data-node':n.id,role:'button',tabindex:mode==='neighborhood'?'0':'-1','aria-label':n.title+'. '+nodeMeta(n)});g.append(E('title',{},n.title));
    if(mode==='neighborhood'){g.append(E('rect',{x:p.x-cw/2,y:p.y-ch/2,width:cw,height:ch,rx:10,class:'ct-card'}),E('text',{x:p.x-cw/2+10,y:p.y-27,class:'ct-year'},nodeYearLabel(n)));const lines=wrap(n.title,Math.floor((cw-20)/9));lines.slice(0,3).forEach((s,j)=>g.append(E('text',{x:p.x-cw/2+10,y:p.y-7+j*22,class:'ct-label'},s+(j===2&&lines.length>3?'…':''))));}
    else{g.append(E('circle',{cx:p.x,cy:p.y,r:n.kind==='source'?5+2*Math.sqrt(n.papers||1):5,class:'ct-dot'}));if(n.kind==='source'&&n.papers>=4)g.append(E('text',{x:p.x+14,y:p.y+5,class:'ct-overview-label'},n.title.length>40?n.title.slice(0,39)+'…':n.title));}
    g.addEventListener('pointerenter',e=>hint(n,e));g.addEventListener('pointerleave',unhint);g.addEventListener('focus',()=>hint(n));g.addEventListener('blur',unhint);const run=()=>n.id===selected&&mode==='neighborhood'?showNode(n.id):choose(n.id);g.addEventListener('click',run);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();run();}});svg.append(g);
   }bounds={x:0,y:0,w:width,h:maxY+24};fit();
  }
  async function evidence(card){const s=D.evidence_shards[card].toString(16).padStart(2,'0'),base=root.dataset.source.replace(/view\.json$/,'');if(!shards.has(s))shards.set(s,fetch(base+'evidence-'+s+'.json').then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).catch(e=>{shards.delete(s);throw e;}));return(await shards.get(s))[card];}
  function showNode(id){
   detail.hidden=false;++detailToken;const n=byId.get(id);detail.replaceChildren();const head=H('div','ct-detail-heading');head.append(H('h4','',n.title),H('p','',nodeMeta(n)));detail.append(head);
   if(n.kind==='paper')head.append(paperLink(n));else{head.append(H('p','',`${fmt(n.applied)} papers apply this source in design or measurement. ${n.identity==='card_local'?'This source occurrence has not been joined across cards.':'Source identities are joined by recorded '+(n.identity==='doi'?'DOI.':'Semantic Scholar ID.')}`));if(n.identity==='doi')head.append(link('Open source ↗','https://doi.org/'+n.key.slice(4)));if(n.identity==='s2')head.append(link('Open source ↗','https://www.semanticscholar.org/paper/'+n.key.slice(3)));for(const cid of n.claim_cards||[])head.append(link('Knowledge-claim card ↗','card-gallery.html?card='+encodeURIComponent(cid)));}
   if(n.counterpart)head.append(button(n.kind==='source'?'Explore this source’s own foundations':'Follow later uses of this paper',()=>choose(n.counterpart),'ct-work-link'));
   const es=adjacent.get(id).filter(accepted).sort((a,b)=>{const x=byId.get(neighbor(a,id)),y=byId.get(neighbor(b,id));return(x.year||3000)-(y.year||3000)||x.title.localeCompare(y.title);}),list=H('div','ct-evidence-list');
   for(const e of es.slice(page*PAGE,(page+1)*PAGE)){const other=byId.get(neighbor(e,id)),row=H('div','ct-evidence-row');row.append(button(other.title,()=>choose(other.id),'ct-work-link'),H('span','',yearLabel(other)),button('Read passage',()=>showEdge(e),'ct-read-evidence'));list.append(row);}detail.append(list);
  }
  async function showEdge(e){
   detail.hidden=false;const token=++detailToken,source=byId.get(e.a),paper=byId.get(e.b);detail.replaceChildren();const head=H('div','ct-detail-heading');head.append(H('h4','',source.title+' → '+paper.title),paperLink(paper),button('Explore this paper',()=>{if(deepDive)deepDive.open=true;choose(paper.id);},'ct-work-link'));detail.append(head,H('p','','Loading the recorded passage…'));
   try{const bound=await evidence(paper.card);if(token!==detailToken)return;const pair=bound.pairs.find(p=>p.source===e.a&&p.target===e.b);if(!pair)throw Error('Missing source pair');
    const {records,passages}=await sourcePassages(pair,card=>card===paper.card?Promise.resolve(bound):evidence(card));if(token!==detailToken)return;detail.lastElementChild.remove();
    for(const {support,quotes} of passages){const article=H('article','ct-passage');article.append(H('p','ct-passage-role',`${labels[support.relation]||support.relation} · ${enactments[support.enactment]||support.enactment}`));for(const q of quotes){article.append(H('blockquote','',q.exact_quote),H('p','ct-page',`PDF page ${q.physical_page_index}${q.section?' · '+q.section:''}`));}if(records.size>1)article.append(link('Open this evidence card ↗','card-gallery.html?card='+encodeURIComponent(support.card)));detail.append(article);}
    const provenance=H('details','ct-provenance');provenance.append(H('summary','',records.size>1?'Source records':'Source record'));
    for(const [card,record] of records){provenance.append(H('p','',`Card ${card} · ${record.status.replaceAll('_',' ')}`),H('p','',`Card SHA-256: ${record.card_sha256}`),H('p','',`PDF SHA-256: ${record.pdf_sha256}`));}detail.append(provenance);
   }catch(err){if(token===detailToken)detail.append(H('p','','The passage could not load. The full paper card remains available above.'));}
  }
  root.openKnowledgePair=request=>{
   if(!request||request.snapshotId!==D.snapshot_id)return false;
   const edge=pairIndex.get(request.sourceId+'\u0000'+request.targetId);if(!edge)return false;
   showEdge(edge);detail.focus({preventScroll:true});detail.scrollIntoView({block:'nearest',behavior:'auto'});return true;
  };
  $('[data-ct-more]').addEventListener('click',()=>{resultLimit+=30;renderList();});let timer;search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{resultLimit=30;renderList();},100);});role.addEventListener('change',()=>{page=0;renderList();draw();if(mode==='neighborhood')showNode(selected);});
  $('[data-ct-overview]').addEventListener('click',()=>{remember();mode='overview';draw();renderList();++detailToken;detail.replaceChildren(H('h4','','Shared-source overview'),H('p','',`${fmt(D.metrics.shared_sources)} sources have recorded use in at least two papers. Nodes are arranged by publication year and graph connectivity. Select any node to see readable titles and its complete local connections.`));});
  $('[data-ct-back]').addEventListener('click',()=>{const prev=history.pop();if(!prev)return;selected=prev.id;mode=prev.mode;page=prev.page;draw();renderList();showNode(selected);$('[data-ct-back]').disabled=!history.length;});
  for(const[sel,amount]of [['[data-ct-prev]',-1],['[data-ct-next]',1]])$(sel).addEventListener('click',()=>{page+=amount;draw();showNode(selected);});$('[data-ct-fit]').addEventListener('click',fit);root.querySelectorAll('[data-ct-zoom]').forEach(b=>b.addEventListener('click',()=>zoom(b.dataset.ctZoom==='in'?.75:1/.75)));
  $('[data-ct-fullscreen]').addEventListener('click',()=>{const on=root.classList.toggle('ct-expanded');document.body.classList.toggle('ct-map-open',on);$('[data-ct-fullscreen]').textContent=on?'Close expanded map':'Expand map';$('[data-ct-fullscreen]').setAttribute('aria-pressed',String(on));requestAnimationFrame(fit);});
  stage.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();const r=stage.getBoundingClientRect();zoom(e.deltaY>0?1.13:1/1.13,(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);},{passive:false});
  stage.addEventListener('pointerdown',e=>{if(e.target.closest('button,[data-node],[data-edge]'))return;drag={x:e.clientX,y:e.clientY,v:{...view}};stage.setPointerCapture(e.pointerId);stage.classList.add('is-dragging');});stage.addEventListener('pointermove',e=>{if(!drag)return;const r=stage.getBoundingClientRect();setView({...drag.v,x:drag.v.x-(e.clientX-drag.x)/r.width*drag.v.w,y:drag.v.y-(e.clientY-drag.y)/r.height*drag.v.h});});const endDrag=()=>{stage.classList.remove('is-dragging');drag=null;};stage.addEventListener('pointerup',endDrag);stage.addEventListener('pointercancel',endDrag);
  stage.addEventListener('keydown',e=>{if(e.target!==stage)return;const shifts={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,-.1],ArrowDown:[0,.1]};if(shifts[e.key]){e.preventDefault();const[x,y]=shifts[e.key];setView({...view,x:view.x+x*view.w,y:view.y+y*view.h});}if(['+','=','-','Home'].includes(e.key)){e.preventDefault();e.key==='Home'?fit():zoom(e.key==='-'?1/.75:.75);}});root.addEventListener('keydown',e=>{if(e.key==='Escape'&&root.classList.contains('ct-expanded'))$('[data-ct-fullscreen]').click();});new ResizeObserver(()=>{if(!deepDive||deepDive.open)fit();}).observe(stage);renderList();
  if(deepDive){deepDive.addEventListener('toggle',()=>{if(deepDive.open){draw();if(detail.hidden)showNode(selected);}});if(deepDive.open)draw();}
  else{draw();showNode(selected);}
 }
 document.querySelectorAll('[data-citation-chronology]').forEach((root,i)=>{root.dataset.ctId=String(i);root.addEventListener('knowledge-space:open-pair',event=>handleKnowledgePair(root,event));const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();init(root);}},{rootMargin:'500px'});observer.observe(root);});
 document.querySelectorAll('[data-practice-compare]').forEach(root=>{root.querySelectorAll('[data-practice-select]').forEach(button=>button.addEventListener('click',()=>{root.querySelectorAll('[data-practice-select]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));root.querySelectorAll('[data-practice-row]').forEach(row=>row.hidden=button.dataset.practiceSelect!=='all'&&button.dataset.practiceSelect!==row.dataset.practiceRow);}));});
})();
