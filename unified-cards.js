/* A source-bound code match never falls back to a broader paper match. */
var GalleryCoding = (() => {
 'use strict';
 const text = value => Array.isArray(value) ? value.map(text).join(' ') : value && typeof value === 'object' ? Object.values(value).map(text).join(' ') : String(value ?? '');
 const list = value => Array.isArray(value) ? value : value ? [value] : [];
 const nodeList = data => Object.values(data?.nodes || {});
 function ancestors(data, id) {
  const result = [], seen = new Set();
  while (id && data?.nodes[id] && !seen.has(id)) { seen.add(id); result.unshift(data.nodes[id]); id = data.nodes[id].parent; }
  return result;
 }
 function matchUnit(unit, selection = [], data) {
  if (selection.some(id => !data?.nodes[id])) return false;
  if (!selection.every(id => list(unit.codes).includes(id))) return false;
  const facets = selection.filter(id => data.nodes[id].kind === 'facet');
  const values = selection.filter(id => ['value', 'qualified_value'].includes(data.nodes[id].kind));
  return facets.every(facet => values.every(value => list(unit.pairs).some(pair => pair.facet === facet && pair.value === value)));
 }
 function searchNodes(data, query) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return nodeList(data).filter(n => { const haystack = text([n.id,n.label,n.definition,n.aliases,n.code]).toLocaleLowerCase(); return terms.every(term => haystack.includes(term)); });
 }
 function counts(units) {
  return {papers:new Set(units.map(u => u.paper_id)).size,units:units.length,mechanisms:new Set(units.filter(u => u.kind === 'mechanism').map(u => (u.card_id||u.paper_id)+':'+(u.mechanism_id||u.id))).size};
 }
 function ordinaryNode(data,node){return !!node&&!ancestors(data,node.id).some(n=>n.null_branch||n.availability?.ordinary_browse===false);}
 function summaryParts(unit){
  const raw=text(unit?.summary||''),parts={},marks=[...raw.matchAll(/(?:^|\s)(Facet|Value|Evidence):\s*/g)];
  for(let i=0;i<marks.length;i++)parts[marks[i][1].toLowerCase()]=raw.slice(marks[i].index+marks[i][0].length,marks[i+1]?.index??raw.length).trim();
  return {description:parts.value||(!marks.length?raw:parts.facet)||'',evidence:parts.evidence||'',facet:parts.facet||''};
 }
 function decodeUnits(payload,data){
  if(Array.isArray(payload.units))return payload.units;
  const encoding=data.unit_encoding;
  if(!encoding||!Array.isArray(payload.rows)||!Array.isArray(payload.columns))throw Error('Unsupported coding shard');
  return payload.rows.map(row=>{
   const value=Object.fromEntries(payload.columns.map((key,i)=>[key,row[i]])),card=encoding.cards[value.card];
   if(!card)throw Error('Unknown source card');
   const code=index=>{const id=encoding.node_ids[index];if(!id||!data.nodes[id])throw Error('Unknown code in shard');return id;};
   const kind=typeof value.kind==='number'?encoding.kinds[value.kind]:value.kind,version=typeof value.version==='number'?encoding.versions[value.version]:value.version;
   if(!kind||!version)throw Error('Unknown coded unit kind or version');
   const locator=typeof value.locator==='number'?encoding.locators[value.locator]:value.locator,detailURL=value.fallback==null?undefined:encoding.evidence_urls?.[value.fallback];
   if(typeof locator!=='string'||value.fallback!=null&&!detailURL)throw Error('Unknown source evidence route');
   return {id:value.id,paper_id:card.paper_id,card_id:card.id,stream:card.stream,source_card_sha256:card.source_card_sha256,kind,mechanism_id:value.mechanism||null,codes:list(value.codes).map(code),pairs:list(value.pairs).map(pair=>({facet:code(pair[0]),value:code(pair[1])})),summary:value.summary||'',page_refs:value.page_refs||[],figure_refs:value.figure_refs||[],parent_id:typeof value.parent==='number'?encoding.parent_ids[value.parent]:value.parent||value.id,codebook_version:version,source_locator:locator,card_detail_url:card.detail_url,detail_url:detailURL,observation_ids:value.observations||[],claim_id:value.claim_id||null};
  });
 }
 function sourceEvidence(card,unit){
  if(unit.field_name&&typeof unit.evidence_text==='string')return {rows:[{key:unit.field_name,value:unit.evidence_text}],heading:'Exact recorded source field',note:''};
  if(unit.kind==='mechanism'&&unit.mechanism_id){const mechanism=list(card.mechanisms).find(m=>m.id===unit.mechanism_id);return {rows:mechanism?.entries||[],heading:'Recorded mechanism and supporting passage',note:''};}
  const locator=unit.source_locator||'',match=locator.match(/^sections\.(\d+)\.blocks\.(\d+)\.fields\.([^.]+)\.(\d+)$/);
  if(match){
   const [,section,block,field,occurrence]=match;
   let entries=[];
   if(section==='0')entries=card.identity_entries;
   if(section==='1')entries=list(card.mechanisms).find(m=>m.id==='M'+block)?.entries;
   if(section==='2')entries=list(card.shifts).find(m=>String(m.n)===block)?.entries;
   if(section==='3')entries=card.rq3_entries;
   if(section==='4')entries=card.claim_entries;
   if(section==='6')entries=card.paper_code_entries;
   if(section==='5'&&['limitations','boundary_conditions'].includes(field))return {rows:list(card[field]).map(value=>({key:field,value})),heading:'Recorded source field',note:'This field contains the following recorded statements.'};
   const row=list(entries).filter(row=>row.key===field)[Number(occurrence)-1];
   return {rows:row?[row]:[],heading:'Exact recorded source field',note:''};
  }
  const claim=locator.match(/^\/claims\/(\d+)(?:\/|$)/);
  if(claim){const items=list(list(card.sections).find(s=>String(s.num)==='1')?.items),item=unit.claim_id?items.find(item=>String(item.heading||'').endsWith(' · '+unit.claim_id)):items[Number(claim[1])];return {rows:item?.rows||[],heading:item?.heading||'Recorded parent claim',note:'The selected coding refers to this parent claim. Its evidence and conditions remain at their recorded scope.'};}
  const key=locator.split('/').filter(Boolean).at(-1),rows=list(card.sections).flatMap(s=>list(s.items).flatMap(item=>list(item.rows))).filter(row=>row.key===key);
  return {rows,heading:'Recorded source field',note:''};
 }
 function groupByPaper(units) {
  const result = new Map();
  for (const unit of units) { if (!result.has(unit.paper_id)) result.set(unit.paper_id,[]); result.get(unit.paper_id).push(unit); }
  return result;
 }
 return {text,list,nodeList,ancestors,matchUnit,searchNodes,counts,groupByPaper,decodeUnits,sourceEvidence,ordinaryNode,summaryParts};
})();

(() => {
 'use strict';
 if (typeof document === 'undefined') return;
 const C=PaperCards,N=GalleryCoding,$=id=>document.getElementById(id),esc=C.esc;
 const controls=Object.fromEntries(['view','type','stream','learning','year','scope'].map(key=>[key,$('filter-'+key)]));
 let data,nav,papers=[],paperById=new Map(),unitsById=new Map(),search,analysis=null,media=null;
 let selected=null,active=null,selectedUnit=null,selection=[],lens='',field='',browse='design',limit=24,serial=0,pinned=[],loadingSearch=false,navError=false;
 let returningFocus=null,searchTimer,restoring=false,lensLoading=false,lensFailure=false,lensTicket=0,returningPaper=null,keyboardFocus=false;
 const unitShards=new Map(),detailShards=new Map(),loadedShards=new Set();
 const detail=$('paper-detail'),comparison=$('comparison-dialog');
 const filters=()=>({q:$('gallery-search').value.trim(),analysis:analysis?.id||'',...Object.fromEntries(Object.entries(controls).map(([k,c])=>[k,c.value]))});
 function stateURL(){const pinlenses=[...new Set(pinned.flatMap(id=>{const u=unitsById.get(id);return u?nav.lenses.filter(l=>l.stream===u.stream&&N.list(u.codes).some(code=>l.fields.includes(node(code)?.field))).map(l=>l.id):[];}))].join('|');const f={...filters(),lens,field,browse:browse==='papers'?'papers':'',code:selection.join('|'),unit:selectedUnit?.id||'',mechanism:selectedUnit?.mechanism_id||'',pin:pinned.join('|'),pinlens:pinlenses};return C.galleryURL(f,active);}
 function savePosition(){history.replaceState({...history.state,scrollY:window.scrollY,limit,detailScroll:detail.open?detail.scrollTop:history.state?.detailScroll||0},'',location.href);}
 function updateURL(push=true){if(restoring)return;savePosition();const url=stateURL();if(location.pathname.split('/').pop()+location.search!==url)history[push?'pushState':'replaceState']({scrollY:window.scrollY,limit},'',url);}
 const currentLens=()=>nav?.lenses.find(l=>l.id===lens);
 const designLens=()=>nav?.lenses.find(l=>l.id==='design'||l.fields?.includes('facet')&&l.stream==='Stream 1')||nav?.lenses[0];
 const node=id=>nav?.nodes[id];
 const familyOf=unit=>N.list(unit?.codes).map(node).filter(Boolean).find(n=>n.kind==='family'&&/FC-A[1-5]/.test(n.id));
 const familyQuestions={'FC-A1':'What can a person inspect and understand?','FC-A2':'How can a person organise and compare material?','FC-A3':'What can a person express, change, or try?','FC-A4':'How is the next action or reflection supported?','FC-A5':'How can people share work and perspectives?'};
 const schematic=(family,style='family-illustration')=>'<svg class="'+style+'" viewBox="0 0 600 210" aria-hidden="true" focusable="false"><svg x="0" y="0" width="600" height="210" viewBox="60 60 600 210" overflow="hidden"><image href="'+esc(artwork(family))+'" width="720" height="396"/></svg></svg>';
 const artwork=family=>{const match=family?.id.match(/FC-A[1-5]/);return family?.illustration||family?.image|| (match?'assets/design-space-atlas/family-'+match[0]+'.svg':'');};
 const countCopy=units=>{const c=N.counts(units),mechanisms=units.filter(u=>u.kind==='mechanism').length,observations=units.length-mechanisms;return `${c.papers.toLocaleString()} ${c.papers===1?'paper':'papers'}`+(c.mechanisms?` · ${c.mechanisms.toLocaleString()} matching ${c.mechanisms===1?'mechanism':'mechanisms'}`:'')+(observations?` · ${observations.toLocaleString()} coded ${observations===1?'observation':'observations'}`:'');};
 const fieldLabels={work_domain:'Work domains',process_before:'Work before the support',process_after:'Work with the support',externalised_to_tool:'Work delegated to the tool',retained_by_person:'Work retained by people',still_required_of_the_person:'What people still need to do',evidence:'Study evidence',learning_evidence:'Learning and capability assessment',limitations:'Limitations',boundary_conditions:'Conditions and boundaries',null_or_negative_results:'Null and negative findings',affected_capability:'Human capabilities',affected_work_activity:'Human activities',applicability_condition:'When a claim applies',applicability_context:'Work and task contexts',applicability_population:'People and populations',lineage_named_construct:'Theories and constructs',support_form:'Forms of support',facet:'Mechanism facets',value:'Observed variations'};
 const routeCopy={mechanisms:['Mechanisms','What does the design make possible?','Family → category → facet → observed variation → source evidence.'],work:['Work domains','Where does the work take place?','Choose a domain family, then follow its categories to specific work settings.'],activity:['Human activity','What do people and tools do?','Choose the part of the workflow, then explore its families, categories and recorded activities.'],evidence:['Evidence and limits','What does the evidence establish?','Choose an evidence question, then inspect the coded distinctions and source observations.'],stream2:['Stream 2 prior knowledge','Which prior ideas help explain a design?','A separate vocabulary of capabilities, activities, conditions and prior theory.']};
 const levelLabel=n=>({family:'Family',category:'Category',facet:'Facet',value:'Observed variation',qualified_value:'Observed variation',code:'Coded distinction'}[n?.kind]||'Coded distinction');
 const lensShards=()=>N.list(nav?.unit_shards).filter(s=>s.stream===currentLens()?.stream&&s.fields.some(f=>currentLens()?.fields.includes(f)));
 const lensReady=()=>!!nav&&!lensLoading&&!lensFailure&&lensShards().every(s=>loadedShards.has(s.url));
 let poolCache=new Map();
 const preview=value=>{const text=N.text(value);return text.length>=160?text.slice(0,160).replace(/\s+\S*$/,'')+'…':text;};
 const safeURL=url=>/^(?:https?:\/\/|\.?\.?\/|[\w-]+(?:\/|\.))/i.test(String(url||''))&&!String(url).includes('\\')?url:'#';
 function focusSnapshot(){
  if(!keyboardFocus)return null;
  const active=document.activeElement,region=active?.closest('#family-tiles,#coding-lenses,#code-search,#coding-navigation,#card-results,#comparison-tray');
  if(!region)return null;
  const attributes=Array.from(active.attributes).filter(a=>a.name==='id'||a.name.startsWith('data-')).map(a=>[a.name,a.value]);
  const matches=element=>element.tagName===active.tagName&&attributes.every(([key,value])=>element.getAttribute(key)===value);
  const peers=[...region.querySelectorAll('button,[tabindex]')].filter(matches);
  return {region:region.id,attributes,tag:active.tagName,position:peers.indexOf(active)};
 }
 function restoreFocus(saved){
  if(!saved)return;
  const region=$(saved.region),matches=element=>element.tagName===saved.tag&&saved.attributes.every(([key,value])=>element.getAttribute(key)===value);
  const peers=[...region.querySelectorAll('button,[tabindex]')].filter(matches);
  const pin=saved.attributes.find(([key])=>key==='data-pin')?.[1],related=pin?[...$('card-results').querySelectorAll('[data-pin]')].find(button=>button.dataset.pin===pin):null;
  const target=peers[saved.position]||peers[0]||related||(!region.hidden&&region.querySelector('button:not(:disabled)'));
  if(target)target.focus({preventScroll:true});else focusSelection();
 }
 function focusSelection(){const target=$('selected-code-heading')||$('results-title');target.tabIndex=-1;target.focus({preventScroll:true});}
 function unitText(unit){return N.text([unit.summary,unit.mechanism_id,unit.page_refs,N.list(unit.codes).map(id=>node(id)).filter(Boolean).map(n=>[n.label,n.definition,n.aliases])]).toLocaleLowerCase();}
 function paperMatches(p,f){const q=f.q?.toLocaleLowerCase();return C.matches(p,f,search||{})||q&&C.matches(p,{...f,q:''},search||{})&&N.text([p.id,p.record_ids,p.cards.map(c=>c.id)]).toLocaleLowerCase().includes(q);}
 function paperPool(query=true){const f=filters();if(!query)f.q='';return papers.filter(p=>(!analysis||analysis.paper_ids.includes(p.id))&&paperMatches(p,f));}
 function baseUnits(query=true,allFields=false){
  if(!nav||lens&&!currentLens())return [];
  const cacheKey=query+':'+allFields;if(poolCache.has(cacheKey))return poolCache.get(cacheKey);
  const allowed=new Set(paperPool(false).map(p=>p.id)),f=filters(),q=query?f.q.toLocaleLowerCase():'';
  const result=nav.units.filter(u=>allowed.has(u.paper_id)&&(!currentLens()?.stream||u.stream===currentLens().stream)&&(!currentLens()?.fields?.length||N.list(u.codes).some(id=>currentLens().fields.includes(node(id)?.field)&&(!field||allFields||node(id)?.field===field)))&&(!q||unitText(u).includes(q)||paperMatches(paperById.get(u.paper_id),f)));poolCache.set(cacheKey,result);return result;
 }
 function matchingUnits(){return baseUnits().filter(u=>N.matchUnit(u,selection,nav)&&(!selection.length||selection.every(id=>N.ordinaryNode(nav,node(id))))&&u.codes.some(id=>{const n=node(id);return n&&currentLens()?.fields.includes(n.field)&&(!field||n.field===field)&&N.ordinaryNode(nav,n);}));}
 function navigation(){
  const target=$('coding-navigation');
  if(browse==='papers'&&!selection.length){target.innerHTML='';return;}
  if(!nav){target.innerHTML=selection.length?'<p class="empty-state">The selected code cannot be checked while the coding index is unavailable. <button type="button" data-reset-code>Clear the code selection</button></p>':'';return;}
  if(lens&&!currentLens()){target.innerHTML='<p class="empty-state">This exploration route is not in the current snapshot. No broader matches are shown. Choose a route above.</p>';return;}
  const unknown=selection.filter(id=>!node(id));
  if(unknown.length){target.innerHTML='<p class="empty-state">This code is not in the current snapshot: <strong>'+esc(unknown.join(', '))+'</strong>. No broader matches are shown. <button type="button" data-reset-code>Clear the code selection</button></p>';return;}
  if(field&&!currentLens()?.fields.includes(field)){target.innerHTML='<p class="empty-state">This field is not part of the selected route. <button type="button" data-reset-field>Choose a field</button></p>';return;}
  const last=node(selection.at(-1)),facet=selection.map(node).find(n=>n?.kind==='facet'),isValue=n=>['value','qualified_value'].includes(n?.kind),path=isValue(last)&&facet?[...N.ancestors(nav,facet.id),last]:last?N.ancestors(nav,last.id):[];
  const multi=currentLens()?.id!==designLens()?.id&&currentLens()?.fields.length>1,label=routeCopy[lens]?.[0]||currentLens()?.label||'Mechanisms';
  let html='<nav class="coding-breadcrumbs" aria-label="Code path"><button type="button" data-lens="'+esc(lens)+'">'+esc(label)+'</button>'+(field&&multi?'<span aria-hidden="true">/</span><button type="button" data-field="'+esc(field)+'">'+esc(fieldLabels[field]||C.human(field))+'</button>':'')+path.map(n=>'<span aria-hidden="true">/</span><button type="button" data-node="'+esc(n.id)+'"'+(n.id===last?.id?' aria-current="page"':'')+'><small>'+esc(levelLabel(n))+'</small>'+esc(n.reader_label||n.label)+'</button>').join('')+'</nav>';
  if(last)html+='<div class="code-definition"><span class="eyebrow">'+esc(levelLabel(last))+'</span><h2 id="selected-code-heading" tabindex="-1">'+esc(last.reader_label||last.label)+'</h2><p>'+esc(last.definition||'No definition is recorded for this code.')+'</p></div>';
  if(!lensReady()){target.innerHTML=html+'<p class="loading-state" role="status">'+(lensFailure?'Examples could not load. Retry the selected fields below.':'Loading the examples for this route…')+'</p>';return;}
  const pool=baseUnits(),roots=(currentLens()?.roots||[]).map(node).filter(n=>n&&(!field||n.field===field)&&(currentLens()?.id!==designLens()?.id||n.field==='facet'));
  const selectionFor=n=>isValue(n)&&facet?[...N.ancestors(nav,facet.id).map(a=>a.id),n.id]:N.ancestors(nav,n.id).map(a=>a.id);
  const matchesFor=n=>pool.filter(u=>N.matchUnit(u,selectionFor(n),nav));
  const available=n=>N.ordinaryNode(nav,n)&&matchesFor(n).length>0;
  const tile=(n,matched)=>'<button type="button" data-node="'+esc(n.id)+'"><span class="node-level">'+esc(levelLabel(n))+'</span><strong>'+esc(n.reader_label||n.label)+'</strong><span class="node-description">'+esc(preview(n.definition||''))+'</span><small>'+esc(countCopy(matched))+'</small>'+((n.children||[]).length?'<span class="node-next">'+n.children.map(node).filter(x=>x&&available(x)).length+' linked '+(n.kind==='family'?'categories':n.kind==='category'?'distinctions':'choices')+' <span aria-hidden="true">→</span></span>':'')+'</button>';
  if(multi&&!field&&!last){
   const allPool=baseUnits(true,true),fields=(currentLens().field_groups||currentLens().fields.map(f=>({id:f,label:fieldLabels[f]}))).map(group=>({field:group.id,label:group.label,units:allPool.filter(u=>u.codes.some(id=>node(id)?.field===group.id&&N.ordinaryNode(nav,node(id))))})).filter(g=>g.units.length);
   html+='<section class="hierarchy-level"><h3>Choose a question</h3><div class="node-choices field-choices">'+fields.map(g=>'<button type="button" data-field="'+esc(g.field)+'"><strong>'+esc(g.label||fieldLabels[g.field]||C.human(g.field))+'</strong><span>'+esc(currentLens().stream==='Stream 2'?'Explore the prior-knowledge vocabulary':'Explore the workflow or evidence vocabulary')+'</span><small>'+esc(countCopy(g.units))+'</small><span class="node-next">Browse families <span aria-hidden="true">→</span></span></button>').join('')+'</div></section>';
   target.innerHTML=html;return;
  }
  const valueChoices=facet?[...new Set(pool.flatMap(u=>N.list(u.pairs).filter(pair=>pair.facet===facet.id).map(pair=>pair.value)))].map(node).filter(Boolean):[];
  const candidates=last?.kind==='facet'?valueChoices:last?N.list(last.children).map(node).filter(Boolean):roots;
  const unplaced=n=>n.hierarchy_status==='unplaced_refinement'||!n.parent&&!['family','category'].includes(n.kind);
  const ordinary=candidates.filter(n=>available(n)&&(!unplaced(n)||last)),additional=candidates.filter(n=>available(n)&&unplaced(n)&&!last),unavailable=candidates.filter(n=>!available(n));
  if(last&&!N.ordinaryNode(nav,last))html+='<p class="gallery-notice">'+esc(last.availability?.message||(last.null_branch?'This code records missing information, rather than a design or activity.':'This definition has no source-bound examples in the current gallery.'))+' Its definition remains available; broader examples are not substituted.</p>';
  if(ordinary.length&&(last||lens!==designLens()?.id))html+='<section class="hierarchy-level"><h3>'+esc(last?.kind==='family'?'Categories in this family':last?.kind==='category'?(lens===designLens()?.id?'Facets in this category':'Distinctions in this category'):last?.kind==='facet'?'Observed variations of this facet':'Families in this field')+'</h3>'+(last?.kind==='facet'?'<p class="level-intro">These forms occur with this facet in the same recorded mechanism. They are not necessarily interchangeable settings.</p>':'')+'<div class="node-choices">'+ordinary.map(n=>tile(n,matchesFor(n))).join('')+'</div></section>';
  if(additional.length)html+='<details class="additional-distinctions"><summary>Additional reviewed distinctions ('+additional.length+')</summary><p>These recorded distinctions do not yet have a reviewed family assignment.</p><div class="node-choices">'+additional.map(n=>tile(n,matchesFor(n))).join('')+'</div></details>';
  if(unavailable.length)html+='<details class="availability-details"><summary>Code availability ('+unavailable.length+')</summary><p>Missing-information markers and definitions without matching examples are kept out of the browsing tiles.</p><ul>'+unavailable.map(n=>'<li><button type="button" data-node="'+esc(n.id)+'">'+esc(n.reader_label||n.label)+'</button><span>'+esc(n.availability?.status==='examples_available'&&!matchesFor(n).length?'No examples match the current filters.':n.availability?.message||(n.null_branch?'Records missing information.':Number(n.unit_count)>0?'No examples match the current filters.':'No source-bound examples in this gallery snapshot.'))+'</span></li>').join('')+'</ul></details>';
  const siblings=isValue(last)&&facet?valueChoices.filter(n=>n.id!==last.id&&available(n)):last?.parent?N.list(node(last.parent)?.children).map(node).filter(n=>n&&n.id!==last.id&&available(n)):[];
  if(siblings.length)html+='<details class="sibling-codes"><summary>Other '+esc(levelLabel(last).toLowerCase())+' choices</summary><div class="sibling-buttons">'+siblings.map(n=>'<button type="button" data-node="'+esc(n.id)+'">'+esc(n.reader_label||n.label)+' <small>'+esc(countCopy(matchesFor(n)))+'</small></button>').join('')+'</div></details>';
  if(selection.length>path.length)html+='<div class="selected-codes">Also matching: '+selection.filter(id=>!path.some(n=>n.id===id)).map(id=>'<button type="button" data-remove-code="'+esc(id)+'">'+esc(node(id).label)+' ×</button>').join('')+'</div>';
  target.innerHTML=html;
 }
 function entries(){
  if(!nav||navError){$('family-tiles').innerHTML='<p class="empty-state">Code browsing is temporarily unavailable. You can still search and read the paper cards. <button type="button" id="retry-coding">Retry coding index</button></p>';return;}
  const design=designLens(),isDesign=currentLens()?.id===design?.id,copy=routeCopy[lens]||routeCopy.mechanisms;
  $('coding-lenses').innerHTML=nav.lenses.map(l=>'<button type="button" data-lens="'+esc(l.id)+'" aria-pressed="'+(l.id===lens&&browse!=='papers')+'">'+esc(routeCopy[l.id]?.[0]||l.label)+'</button>').join('');
  $('route-eyebrow').textContent=browse==='papers'?'Paper search':copy[0];$('family-heading').textContent=browse==='papers'?'Search the complete paper collection':copy[1];$('route-description').textContent=browse==='papers'?'Includes papers whose coding is unavailable or belongs to an earlier source version.':copy[2];$('route-atlas-link').hidden=!isDesign||browse==='papers';
  $('family-tiles').hidden=!isDesign||browse==='papers'||!!selection.length;
  $('family-count-scope').hidden=!isDesign||browse==='papers'||!!selection.length;
  $('family-count-scope').textContent=(data?.public_sample?'Counts cover this sample under the current filters.':'Counts follow the current collection filters.')+' A paper may appear in several families.';
  if(isDesign&&browse!=='papers'){
   if(!lensReady())$('family-tiles').innerHTML='<p class="loading-state" role="status">'+(lensFailure?'The mechanism examples could not load. Retry below.':'Loading mechanism families and their examples…')+'</p>';
   else{const pool=baseUnits();$('family-tiles').innerHTML=(design?.roots||[]).map(node).filter(n=>n&&n.field==='facet'&&/FC-A[1-5]$/.test(n.id)).map(n=>({n,units:pool.filter(u=>u.codes.includes(n.id))})).filter(({n,units})=>N.ordinaryNode(nav,n)&&units.length).map(({n,units})=>'<button type="button" class="family-tile" data-family="'+esc(n.id)+'" aria-pressed="false">'+(artwork(n)?schematic(n):'')+'<span class="family-label">'+esc(n.reader_label||n.label)+'</span><span class="family-description">'+esc(familyQuestions[n.id.split(':').at(-1)]||n.definition||'')+'</span><small>'+esc(countCopy(units))+'</small><span class="family-next">'+N.list(n.children).filter(id=>pool.some(u=>u.codes.includes(id))).length+' categories <span aria-hidden="true">→</span></span></button>').join('')||'<p class="empty-state">No mechanism families match these filters. Change the collection filters or search all papers.</p>';}
  }
  $('coding-coverage').textContent=nav.coverage?.reader_note||nav.coverage?.note||'Counts use this released coding snapshot. Coding coverage and evidence quality differ by field; the source card and original paper remain available for inspection.';
 }
 function figureFor(unit){
  unit=unitsById.get(unit?.id)||unit;
  const records=Array.isArray(media)?media:media?.media||[];
  return records.find(item=>item.card_id===unit?.card_id&&item.mechanism_id===unit.mechanism_id&&item.mechanism_id&&item.card_sha256&&item.card_sha256===unit.source_card_sha256&&item.source_sha256&&(item.path||item.url));
 }
 function visual(unit){
  const figure=figureFor(unit);
  if(figure)return '<figure class="example-visual"><img src="'+esc(safeURL(figure.path||figure.url))+'" alt="'+esc(figure.alt||figure.caption||'Recorded interface figure')+'" loading="lazy" width="340" height="176"><figcaption><span class="visual-label">Original paper figure</span><a href="'+esc(safeURL(figure.source_url))+'" target="_blank" rel="noopener">'+esc(figure.source_locator||'Source figure')+' ↗</a></figcaption></figure>';
  const parts=N.summaryParts(unit),excerpt=parts.evidence||unit?.evidence_text,refs=N.text(unit?.page_refs);
  return unit?'<div class="example-evidence"><span class="visual-label">Recorded text evidence'+(refs?' · '+esc(refs):'')+'</span>'+(excerpt?'<p>'+esc(preview(excerpt))+'</p>':'<p class="evidence-route">Read the coded observation and its source passage.</p>')+'<small>No reviewed figure for this entry</small></div>':'<div class="example-evidence paper-preview"><span class="visual-label">Paper and source cards</span></div>';
 }
 function example(p,unit){
  const id=unit?.id||'paper:'+p.id,chosen=pinned.includes(id),parts=N.summaryParts(unit);
  const preferred=N.list(unit?.codes).map(node).filter(n=>n&&(!field||n.field===field)&&N.ordinaryNode(nav,n));
  const facet=preferred.find(n=>n.kind==='facet'),leaf=facet||preferred.filter(n=>!N.list(n.children).some(id=>unit.codes.includes(id))).at(0);
  const path=leaf?N.ancestors(nav,leaf.id):[],match=path.length?path.map(n=>n.reader_label||n.label):selection.map(id=>node(id)?.reader_label||node(id)?.label||id);
  const why=unit?(match.join(' → ')||currentLens()?.label||'Recorded observation'):'Paper title and available cards';
  return '<article class="example-card"'+(selectedUnit?.id===unit?.id&&unit?' data-selected="true"':'')+'>'+visual(unit)+'<div class="example-body"><p class="example-meta">'+esc([p.year,C.human(p.venue).replaceAll('C and C','C&C'),unit?.stream||p.streams.join(' · ')].filter(Boolean).join(' · '))+'</p><h3><button type="button" data-paper="'+esc(p.id)+'"'+(unit?' data-unit="'+esc(unit.id)+'"':'')+'>'+esc(p.title)+'</button></h3>'+(parts.description?'<p class="example-summary">'+esc(preview(parts.description))+'</p>':'<p class="example-summary">'+esc(p.cards.map(c=>C.names[c.type]).filter((v,i,a)=>a.indexOf(v)===i).join(' · '))+'</p>')+'<p class="match-reason"><span>'+esc(unit?'Matching coding path':'Available source')+'</span>'+esc(why)+'</p><div class="example-actions"><button type="button" data-paper="'+esc(p.id)+'"'+(unit?' data-unit="'+esc(unit.id)+'"':'')+'>Read '+(unit?.kind==='mechanism'?'mechanism':'evidence')+' <span aria-hidden="true">→</span></button><button type="button" data-pin="'+esc(id)+'" aria-pressed="'+chosen+'" aria-label="'+(chosen?'Unpin ':'Pin for comparison: ')+esc(p.title)+'">'+(chosen?'Pinned ✓':'Pin +')+'</button></div></div></article>';
 }
 function render(){
  if(!data)return;
  const focus=focusSnapshot();poolCache=new Map();
  navigation();entries();
  const units=matchingUnits(),isCoded=browse!=='papers'||selection.length>0;
  const groups=[...N.groupByPaper(units).values()],ordered=[];for(let depth=0;groups.some(group=>group.length>depth);depth++)for(const group of groups)if(group[depth])ordered.push(group[depth]);ordered.sort((a,b)=>Number(!!figureFor(b))-Number(!!figureFor(a)));
  let items=isCoded&&nav?ordered.map(u=>({p:paperById.get(u.paper_id),u})):selection.length?[]:paperPool().map(p=>({p,u:null}));
  const lastCode=node(selection.at(-1)),unavailableCode=lastCode&&!N.ordinaryNode(nav,lastCode),emptyMessage=selection.some(id=>!node(id))?'The requested code is not available in this snapshot.':unavailableCode?(lastCode.availability?.message||'This is an availability marker or a definition without source-bound examples in this snapshot. No broader examples are substituted.'):'Try a different code or remove a collection filter. A paper without current coding can still be found in All papers.';
  $('gallery-count').textContent=!lensReady()&&!lensFailure&&browse!=='papers'?'Loading the selected coding fields…':lensFailure?'These coding fields could not load. Use Retry below.':isCoded&&nav?(units.length?countCopy(units):'No source-bound examples match this selection'):`${items.length.toLocaleString()} matching papers`;
  $('results-title').textContent=browse==='papers'&&!selection.length?'All paper cards':selection.length?'Examples matching this code':'Examples to explore';
  if(filters().q&&!search&&browse==='papers')$('gallery-count').textContent+=' · searching full cards…';
  $('card-results').innerHTML=!lensReady()&&!lensFailure&&browse!=='papers'?'<p class="loading-state" role="status">Loading source-bound examples…</p>':lensFailure?'<div class="empty-state"><p>The selected coding fields could not load. No broader matches are shown.</p><button type="button" id="retry-lens">Retry these fields</button></div>':items.slice(0,limit).map(({p,u})=>example(p,u)).join('')||'<div class="empty-state"><h3>'+esc(unavailableCode?'Definition without browsable examples':'No matching examples')+'</h3><p>'+esc(emptyMessage)+'</p><button type="button" data-reset-code>Back to this branch</button></div>';
  $('more-papers').hidden=items.length<=limit;
  $('more-papers').textContent=browse==='papers'?'Show more papers':'Show more examples';
  const activeFilters=Object.entries(filters()).filter(([k,v])=>v&&!['q','view','analysis'].includes(k)).length;
  $('filter-badge').textContent=activeFilters?'('+activeFilters+')':'';
  $('all-papers').textContent=browse==='papers'?'Browse designs':'Search all papers';
  const terms=filters().q,found=terms&&nav?N.searchNodes(nav,terms).sort((a,b)=>Number(N.ordinaryNode(nav,b))-Number(N.ordinaryNode(nav,a))).slice(0,8):[];
  $('code-search').hidden=!found.length;
  $('code-search').innerHTML=found.length?'<p>Matching codes and definitions</p>'+found.map(n=>'<button type="button" data-node="'+esc(n.id)+'"><strong>'+esc(n.reader_label||n.label)+'</strong><small>'+esc(N.ancestors(nav,n.id).map(a=>a.label).join(' / '))+'</small></button>').join(''):'';
  renderTray();restoreFocus(focus);
 }
 async function vocabulary(){if(search||loadingSearch)return;loadingSearch=true;try{search=await C.vocabulary();render();}catch{notice('Full-card search could not load. Title search remains available.');}finally{loadingSearch=false;}}
 function notice(message){$('gallery-notice').hidden=!message;$('gallery-notice').textContent=message;}
 function navigate(id,focus=false){
  const n=node(id);if(!n)return;
  const matchingLens=nav.lenses.find(l=>l.stream===n.stream&&l.fields.includes(n.field));if(matchingLens)lens=matchingLens.id;field=matchingLens?.id===designLens()?.id?'':n.field;
  const facet=selection.map(node).find(n=>n?.kind==='facet');
  selection=['value','qualified_value'].includes(n.kind)&&facet?[...N.ancestors(nav,facet.id).map(n=>n.id),id]:N.ancestors(nav,id).map(n=>n.id);browse='design';limit=24;$('gallery-search').value='';
  if(n.stream==='Stream 2'&&['ai','pending'].includes(controls.view.value))controls.view.value='theory';else if(n.stream==='Stream 1'&&controls.view.value==='theory')controls.view.value='ai';controls.stream.value=n.stream||'';
  updateURL();ensureLens().then(render);render();$('coding-navigation').scrollIntoView({block:'start',behavior:'instant'});if(focus)focusSelection();
 }
 function changeLens(id,focus=false){lens=id;field='';selection=[];browse='design';limit=24;controls.stream.value=currentLens()?.stream||'';controls.view.value=currentLens()?.stream==='Stream 2'?'theory':'ai';updateURL();ensureLens().then(render);render();if(focus)focusSelection();}
 function changeField(id,focus=false){if(!currentLens()?.fields.includes(id))return;field=id;selection=[];browse='design';limit=24;updateURL();ensureLens().then(render);render();if(focus)focusSelection();}
 function resetCode(focus=false){selection=[];limit=24;updateURL();render();if(focus)focusSelection();}
 function sourceIllustration(unit){
  const figure=figureFor(unit);if(!figure)return '';
  const image=figure.path||figure.url;
  const credit=(figure.credit||'').replace('numbered annotations added by this review','numbered annotations appear in the design atlas');
  return '<figure class="matched-illustration"><a href="'+esc(safeURL(image))+'" target="_blank" rel="noopener"><img src="'+esc(safeURL(image))+'" alt="'+esc(figure.alt||figure.caption||'Source illustration')+'"></a><figcaption><span>'+esc(figure.source_title||figure.title)+' · '+esc(figure.source_locator||'')+'</span><span class="source-credit">'+esc(credit)+'</span><a href="'+esc(safeURL(image))+'" target="_blank" rel="noopener">Open crop ↗</a><a href="'+esc(safeURL(figure.source_url))+'" target="_blank" rel="noopener">Full paper context ↗</a></figcaption></figure>';
 }
 function recordedUnit(unit,p,c){
  if(!unit)return '';
  const mechanism=N.list(c?.mechanisms).find(m=>m.id===unit.mechanism_id),rows=N.list(mechanism?.entries),get=key=>rows.find(row=>row.key===key),exact=c?N.sourceEvidence(c,unit):{rows:[]},support=get('evidence')||(exact.rows.length===1?exact.rows[0]:null);
  const description=get('value')?.value||unit.summary;
  const facets=[...new Set(N.list(unit.pairs).map(pair=>pair.facet))],values=[...new Set(N.list(unit.pairs).map(pair=>pair.value))];
  const pathRows=facets.length?'<div><dt>Design operation</dt><dd>'+facets.map(id=>esc(N.ancestors(nav,id).map(n=>n.label).join(' → '))).join('<br>')+'</dd></div><div><dt>Recorded form</dt><dd>'+values.map(id=>esc(node(id)?.label||id)).join(' · ')+'</dd></div>':'<div><dt>Code path</dt><dd>'+N.list(unit.codes).map(node).filter(n=>n&&!N.list(n.children).some(id=>unit.codes.includes(id))).map(n=>esc(N.ancestors(nav,n.id).map(a=>a.label).join(' → '))).join('<br>')+'</dd></div>';
  const quote=N.list(support?.quotes)[0],evidence=quote||unit.evidence_text||support?.value,refs=N.text(unit.page_refs)||N.text(support?.page_refs);
  const overview=c?C.overview(c,active?.kind):[],paperFacts=overview.filter(([key])=>['Activity','Work people retain','Learning assessment','Measured outcomes'].includes(key));
  return '<section class="matched-unit" aria-labelledby="matched-unit-heading"><p class="eyebrow">'+(unit.source_only?'Recorded':'Matched')+' '+esc(unit.kind||'coded unit')+(unit.mechanism_id?' · '+esc(unit.mechanism_id):'')+'</p><h2 id="matched-unit-heading">'+esc(p.title)+'</h2>'+sourceIllustration(unit)+'<p class="matched-summary">'+esc(description)+'</p>'+(evidence?'<section class="evidence-highlight"><h3>'+esc(quote?'Supporting source passage':mechanism?'Recorded supporting evidence':'Recorded source field')+'</h3>'+(quote?'<blockquote>'+esc(quote)+'</blockquote>':'<p>'+esc(evidence)+'</p>')+(refs?'<p class="source-location">'+esc(refs)+'</p>':'')+'</section>':'')+(unit.source_only?'<p class="source-reference">Coding is unavailable for this card version. This is the recorded mechanism, without an inferred code assignment.</p>':'<dl class="matched-code-path" aria-label="Recorded code path">'+pathRows+'</dl>')+(paperFacts.length?'<details class="paper-context"><summary>Activity and assessment in the paper</summary><p class="source-reference">Paper-level card context; these statements are not necessarily specific to this mechanism.</p><dl>'+paperFacts.map(([key,value])=>'<div><dt>'+esc(key)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl></details>':'')+'<div class="source-actions">'+(p.doi?'<a href="https://doi.org/'+esc(encodeURI(p.doi))+'" target="_blank" rel="noopener">Original paper ↗</a>':'')+' <a href="#full-card" data-full-card>Read the full card ↓</a></div><div id="matched-source-fields"></div><details class="unit-binding"><summary>Version and source binding</summary><p>'+esc(unit.codebook_version||'Original source card; no coding assignment')+'<br>Source field: '+esc(unit.source_locator||unit.source_ref||'See full card')+(unit.source_card_sha256?'<br>Source card SHA-256: '+esc(unit.source_card_sha256):'')+'</p></details></section>';
 }
 function sourceFields(c,unit){
  if(!unit)return '';
  const evidence=N.sourceEvidence(c,unit);
  if(!evidence.rows.length)return '<p class="source-reference">The exact coding pointer is shown above. Inspect its source passage in the full card below.</p>';
  return '<details class="unit-evidence"><summary>'+esc(evidence.heading)+'</summary>'+(evidence.note?'<p>'+esc(evidence.note)+'</p>':'')+evidence.rows.map(row=>'<div class="card-row"><div class="card-key">'+esc(C.human(row.key))+'</div><div class="card-value">'+esc(row.value)+N.list(row.quotes).map(q=>'<blockquote>'+esc(q)+'</blockquote>').join('')+'</div></div>').join('')+'</details>';
 }
 async function open(p,cardId,unit,focus=true,push=true,requestedMechanism=null){
  if(!p)return;selected=p;selectedUnit=unit||null;active=p.cards.find(c=>c.id===(unit?.card_id||cardId))||p.cards.find(c=>!controls.type.value||c.type===controls.type.value)||p.cards[0];
  const card=active,ticket=++serial,restoredScroll=restoring?history.state?.detailScroll||0:0;
  if(focus){returningFocus=document.activeElement;returningPaper=p.id;}
  updateURL(push);render();
  detail.innerHTML='<div class="detail-tools"><a href="'+esc(stateURL())+'">Link to this example</a><button type="button" id="close-detail">Close card</button></div>'+recordedUnit(unit,p)+'<div id="full-card" tabindex="-1"><div id="card-content" class="detail-loading" role="status">Loading the full card…</div></div>';
  if(!detail.open)detail.showModal();detail.scrollTop=0;if(focus)$('close-detail').focus();
  try{
   const [c,unitResult]=await Promise.all([C.detail(card),unit?unitDetail(unit).then(value=>({value})).catch(()=>({failed:true})):null]);
   if(ticket!==serial)return;
   let enriched=unitResult?.value||unit;
   if(!enriched&&requestedMechanism&&N.list(c.mechanisms).some(m=>m.id===requestedMechanism)){
    const binding=nav?.unit_encoding?.cards.find(c=>c.id===card.id);
    enriched={id:'',paper_id:p.id,card_id:card.id,kind:'mechanism',stream:card.stream,mechanism_id:requestedMechanism,codes:[],pairs:[],source_only:true,source_locator:'Recorded mechanism '+requestedMechanism,source_card_sha256:binding?.source_card_sha256||''};
   }
   if(enriched){selectedUnit=enriched;const old=detail.querySelector('.matched-unit');if(old)old.outerHTML=recordedUnit(enriched,p,c);else $('full-card').insertAdjacentHTML('beforebegin',recordedUnit(enriched,p,c));}
   else if(requestedMechanism)$('full-card').insertAdjacentHTML('beforebegin','<p class="gallery-notice">This mechanism identifier is not recorded in the current card. The full card is available below.</p>');
   if(unitResult?.failed)detail.querySelector('.matched-unit').insertAdjacentHTML('beforeend','<p class="gallery-notice">The detailed coding evidence could not load. The full card remains available below.</p>');
   $('card-content').className='';$('card-content').removeAttribute('role');$('card-content').innerHTML=C.renderCard(p,card,c,'gallery-card');if(enriched)$('matched-source-fields').innerHTML=sourceFields(c,enriched);detail.querySelector('.detail-tools>a').href=stateURL();detail.scrollTop=restoredScroll;
  }catch{if(ticket===serial)$('card-content').innerHTML='<p>This card could not load.</p><button type="button" data-retry-card>Retry this card</button>';}

 }
 function closeDetail(push=true){savePosition();if(detail.open)detail.close();selected=null;active=null;selectedUnit=null;++serial;updateURL(push);render();if(returningFocus?.isConnected)returningFocus.focus({preventScroll:true});else [...$('card-results').querySelectorAll('[data-paper]')].find(b=>b.dataset.paper===returningPaper)?.focus({preventScroll:true});}
 const pinnedItem=id=>{const u=unitsById.get(id);return {p:paperById.get(u?.paper_id||id.replace(/^paper:/,'')),u};};
 function renderTray(){
  const tray=$('comparison-tray');tray.hidden=!pinned.length;
  tray.innerHTML='<strong>'+pinned.length+' / 4 pinned</strong><div class="pin-list">'+pinned.map(id=>{const {p}=pinnedItem(id);return '<button type="button" data-pin="'+esc(id)+'" aria-label="Remove '+esc(p?.title||id)+'">'+esc((p?.title||id).slice(0,45))+' ×</button>';}).join('')+'</div><button type="button" id="open-comparison"'+(pinned.length<2?' disabled':'')+'>Compare '+pinned.length+' examples</button><span class="pin-hint">Choose 2–4 examples</span>';
 }
 function pin(id){if(pinned.includes(id))pinned=pinned.filter(x=>x!==id);else if(pinned.length<4)pinned.push(id);else {notice('Four examples are pinned. Remove one to compare a different example.');return;}updateURL();render();}
 async function compare(){
  const chosen=[...pinned];if(chosen.length<2)return;
  $('comparison-content').innerHTML='<p role="status">Loading the recorded designs and evidence…</p>';comparison.showModal();
  const items=await Promise.all(chosen.map(async id=>{const item=pinnedItem(id);try{const card=item.p.cards.find(c=>c.id===item.u?.card_id)||item.p.cards[0];return {...item,card,detail:await C.detail(card),u:item.u?await unitDetail(item.u):null};}catch{return item;}}));
  if(!comparison.open)return;
  const fields=[['Design','Design support'],['Human activity','Work people retain'],['Evidence','Measured outcomes']];
  $('comparison-content').innerHTML='<div class="comparison-grid" tabindex="0" role="region" aria-label="Comparison; scroll horizontally to see all pinned examples" style="--compare-count:'+items.length+'">'+items.map(({p,u,card,detail:c})=>{
   const overview=c?C.overview(c,card.kind):[],get=key=>overview.find(row=>row[0]===key)?.[1];
   return '<article><h3>'+esc(p.title)+'</h3><p>'+esc([p.year,u?.stream||p.streams.join(' · ')].join(' · '))+'</p>'+visual(u)+fields.map(([label,key])=>{const matched=label==='Design'&&u?.kind==='mechanism'||label==='Human activity'&&N.list(u?.codes).some(id=>['process_before','process_after','retained_by_person','still_required_of_the_person','externalised_to_tool'].includes(node(id)?.field))||label==='Evidence'&&N.list(u?.codes).some(id=>['evidence','learning_evidence','limitations','boundary_conditions','null_or_negative_results'].includes(node(id)?.field));const copy=matched?(u.evidence_text||u.summary):get(key)||(label==='Human activity'?get('Activity'):label==='Evidence'?get('Evidence & limits'):null);return '<section><h4>'+label+'</h4><small class="comparison-scope">'+(matched?'Selected coded entry':'Paper-level card overview')+'</small><p>'+esc(copy||(c?'Not reported in this card overview.':'The source card could not load. Open this example to retry.'))+'</p></section>';}).join('')+(u?'<p class="comparison-source">'+esc(N.text(u.page_refs)||'See the full source card')+'</p>':'')+'<button type="button" data-compare-open="'+esc(u?.id||'paper:'+p.id)+'">Read this example →</button></article>';
  }).join('')+'</div>';
 }
 async function readURL(){
  const params=new URLSearchParams(location.search);$('gallery-search').value=params.get('q')||'';
  for(const[k,c]of Object.entries(controls))c.value=params.get(k)||params.get('f.'+k)||'';
  if(!controls.view.value)controls.view.value=controls.scope.value?(controls.scope.value==='prior_work'?'theory':'all'):(controls.type.value==='claim'?'theory':'ai');
  selection=(params.get('code')||'').split('|').filter(Boolean);const selectedCode=selection.map(node).find(Boolean);lens=params.get('lens')||nav?.lenses.find(l=>l.stream===selectedCode?.stream&&l.fields.includes(selectedCode?.field))?.id||designLens()?.id||'';if(!params.has('view')&&!params.has('f.view')&&currentLens()?.stream==='Stream 2')controls.view.value='theory';browse=params.get('browse')==='papers'||params.get('q')&&!selection.length||params.has('analysis')||!params.has('lens')&&!selection.length&&['view','type','stream','learning','year','scope'].some(k=>params.has(k)||params.has('f.'+k))?'papers':'design';
  field=params.get('field')||((currentLens()?.id!==designLens()?.id&&selectedCode)?selectedCode.field:'');limit=history.state?.limit||24;await ensureLens((params.get('pinlens')||'').split('|').filter(Boolean));
  pinned=(params.get('pin')||'').split('|').filter(id=>unitsById.has(id)||id.startsWith('paper:')&&paperById.has(id.slice(6))).slice(0,4);render();
  const id=params.get('card')||decodeURIComponent(location.hash.slice(1));let unit=unitsById.get(params.get('unit'));
  const p=paperById.get(unit?.paper_id||data.aliases[id]||nav?.aliases?.[id]||id);
  if(!unit&&params.get('mechanism'))unit=[...unitsById.values()].find(u=>u.card_id===id&&u.mechanism_id===params.get('mechanism'));
  if(p)open(p,id,unit,false,false,params.get('mechanism'));else{if(detail.open)detail.close();selected=null;active=null;selectedUnit=null;if(id)notice(data.public_sample?'This card is not included in the public sample. The full card dataset will be available to download when the paper is released.':'This card is not in the current snapshot. Its identifier is preserved in the URL.');}
  if(params.has('unit')&&!unit)notice(data.public_sample?'This coded example is not included in the public sample. The full card dataset will be available to download when the paper is released.':'This coded unit is not in the current snapshot. The paper card is shown without a claimed mechanism match.');
  if($('gallery-search').value)vocabulary();
 }
 async function unitDetail(unit){
  if(!unit.detail_url)return unit;
  if(!detailShards.has(unit.detail_url))detailShards.set(unit.detail_url,fetch('paper-cards-data/'+unit.detail_url).then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).catch(e=>{detailShards.delete(unit.detail_url);throw e;}));
  const shard=await detailShards.get(unit.detail_url),record=shard.units[unit.id];
  if(!record)throw Error('Missing coded unit');
  if(record.source_card_sha256&&unit.source_card_sha256&&record.source_card_sha256!==unit.source_card_sha256)throw Error('Source card binding changed');
  if(record.source_locator&&unit.source_locator&&record.source_locator!==unit.source_locator)throw Error('Source field binding changed');
  if(record.literal_id){if(typeof shard.literals?.[record.literal_id]!=='string')throw Error('Missing source literal');record.evidence_text=shard.literals[record.literal_id];}
  const enriched={...unit,...record};unitsById.set(unit.id,enriched);return enriched;
 }
 async function ensureLens(extraLenses=[]){
  const ticket=++lensTicket;
  if(!nav||browse==='papers'&&!selection.length&&!extraLenses.length){lensLoading=false;lensFailure=false;return;}
  const requested=[currentLens(),...extraLenses.map(id=>nav.lenses.find(l=>l.id===id))].filter(Boolean);
  const needed=(nav.unit_shards||[]).filter(s=>requested.some(l=>s.stream===l.stream&&s.fields.some(f=>l.fields.includes(f))));
  if(!needed.length){lensLoading=false;lensFailure=false;return;}
  lensLoading=needed.some(s=>!loadedShards.has(s.url));lensFailure=false;render();
  const outcomes=await Promise.allSettled(needed.map(async shard=>{
   if(!unitShards.has(shard.url))unitShards.set(shard.url,fetch('paper-cards-data/'+shard.url).then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).then(d=>{for(const u of N.decodeUnits(d,nav)){if(!unitsById.has(u.id)){nav.units.push(u);unitsById.set(u.id,u);}}loadedShards.add(shard.url);}).catch(e=>{unitShards.delete(shard.url);throw e;}));
   return unitShards.get(shard.url);
  }));
  if(ticket!==lensTicket)return;lensFailure=outcomes.some(r=>r.status==='rejected');lensLoading=false;
 }
 async function loadNavigation(){try{const response=await fetch('paper-cards-data/coding-navigation.v1.json');if(!response.ok)throw Error(response.status);nav=await response.json();if(nav.snapshot!==data.snapshot){nav=null;throw Error('Coding and paper snapshots differ');}unitsById=new Map(nav.units.map(u=>[u.id,u]));navError=false;if(!lens)lens=designLens()?.id||'';}catch{navError=true;}render();}
 document.addEventListener('keydown',()=>{keyboardFocus=true;},true);
 document.addEventListener('pointerdown',()=>{keyboardFocus=false;},true);
 document.addEventListener('error',e=>{if(e.target.tagName==='IMG'){e.target.hidden=true;const caption=e.target.closest('figure')?.querySelector('figcaption');if(caption)caption.textContent='Illustration unavailable; recorded evidence below';}},true);
 document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  const keyboard=e.detail===0;if(keyboard)keyboardFocus=true;
  if(b.dataset.family)navigate(b.dataset.family,keyboard);else if(b.dataset.node)navigate(b.dataset.node,keyboard);else if(b.dataset.lens)changeLens(b.dataset.lens,keyboard);else if(b.dataset.field)changeField(b.dataset.field,keyboard);else if(b.hasAttribute('data-reset-field'))changeLens(lens,keyboard);
  else if(b.hasAttribute('data-reset-code'))resetCode(keyboard);else if(b.dataset.removeCode){selection=selection.filter(id=>id!==b.dataset.removeCode);updateURL();render();if(keyboard)focusSelection();}
  else if(b.dataset.paper)open(paperById.get(b.dataset.paper),null,unitsById.get(b.dataset.unit));
  else if(b.dataset.pin)pin(b.dataset.pin);else if(b.id==='open-comparison')compare();
  else if(b.hasAttribute('data-close-compare'))comparison.close();
  else if(b.dataset.compareOpen){const item=pinnedItem(b.dataset.compareOpen);comparison.close();open(item.p,null,item.u);}
  else if(b.id==='retry-coding')loadNavigation().then(()=>ensureLens()).then(render);else if(b.id==='retry-lens')ensureLens().then(render);
 });
 detail.addEventListener('click',e=>{const b=e.target.closest('[data-card]');if(b)open(selected,b.dataset.card,null);if(e.target.closest('[data-retry-card]'))open(selected,active.id,selectedUnit);C.sectionClick(e,detail);if(e.target.id==='close-detail')closeDetail();if(e.target.closest('[data-full-card]')){e.preventDefault();$('full-card').focus();$('full-card').scrollIntoView({block:'start'});}});
 detail.addEventListener('cancel',e=>{e.preventDefault();closeDetail();});
 for(const[key,c]of Object.entries(controls))c.addEventListener('change',()=>{
  if(key==='scope'&&c.value)controls.view.value=['comparison_only','retained_full_text_correction'].includes(c.value)?'all':(['pending','awaiting_owner_check'].includes(c.value)?'pending':c.value==='prior_work'?'theory':'ai');
  if(key==='view')controls.scope.value='';limit=24;updateURL();render();
 });
 $('gallery-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{limit=24;if(!selection.length)browse='papers';updateURL(false);render();if($('gallery-search').value)vocabulary();},180);});
 $('clear-filters').addEventListener('click',()=>{Object.values(controls).forEach(c=>c.value='');controls.view.value=analysis?'all':'ai';$('gallery-search').value='';selection=[];field='';lens=designLens()?.id||'';browse=analysis?'papers':'design';limit=24;notice('');updateURL();ensureLens().then(render);render();});
 $('more-papers').addEventListener('click',()=>{limit+=24;render();savePosition();});
 $('all-papers').addEventListener('click',()=>{browse=browse==='papers'?'design':'papers';selection=[];field='';limit=24;if(browse==='papers'){controls.view.value='all';controls.stream.value='';}else{controls.view.value='ai';lens=designLens()?.id||'';}updateURL();ensureLens().then(render);render();});
 window.addEventListener('popstate',async()=>{if(!data)return;restoring=true;await readURL();restoring=false;requestAnimationFrame(()=>window.scrollTo(0,history.state?.scrollY||0));});
 (async()=>{
  try{data=await C.index();papers=data.papers;paperById=new Map(papers.map(p=>[p.id,p]));controls.view.innerHTML=C.options(papers);for(const y of [...new Set(papers.map(p=>p.year).filter(Boolean))].sort().reverse())controls.year.append(new Option(y,y));
   const analysisId=new URLSearchParams(location.search).get('analysis');if(analysisId){const response=await fetch('research-data/research-workspace.json');if(!response.ok)throw Error('Analysis index unavailable');const workspace=await response.json();analysis=workspace.analyses.find(row=>row.id===analysisId);if(!analysis)throw Error('Unknown analysis');const context=document.createElement('div');context.className='gallery-analysis-context';context.innerHTML='<span>Analysis</span><strong>'+esc(analysis.title)+'</strong><p>Available cards for papers cited in this section.</p><a href="research.html#analysis-'+esc(analysis.id)+'">← Back to analysis</a><a href="card-gallery.html">Browse the whole gallery →</a>';document.querySelector('.gallery-intro').append(context);}
   await Promise.all([loadNavigation(),fetch('assets/design-space-atlas/media.v1.json').then(r=>r.ok?r.json():null).then(d=>{media=d;}).catch(()=>{})]);restoring=true;await readURL();restoring=false;
  }catch{$('gallery-count').textContent='The paper index could not be loaded. Reload to retry.';$('card-results').innerHTML='<div class="empty-state"><h3>Paper index unavailable</h3><p>Your filters remain in the URL.</p><a href="card-gallery.html'+esc(location.search)+'">Reload the gallery</a></div>';}
 })();
})();
