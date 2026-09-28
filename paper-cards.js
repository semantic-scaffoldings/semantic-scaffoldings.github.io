/* Shared presentation of released cards; no research decisions are made here. */
var PaperCards = (() => {
 'use strict';
 const names={mechanism:'Mechanism',lineage:'Theory lineage',claim:'Knowledge claims'};
 const views={ai:'AI systems',theory:'Theory & prior work',pending:'Awaiting scope check',all:'All papers & archive'};
 const scopeNames={retained_ai_indication:'',owner_checked_ai:'',awaiting_owner_check:'Awaiting AI-scope check',pending:'Awaiting scope reconciliation',comparison_only:'Non-AI comparison',routed_review:'Review routed to Stream 2',retained_full_text_correction:'Earlier full-text correction',excluded_current_card:'Excluded by current card',prior_work:'Theory & prior work'};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const venue=s=>String(s||'').replaceAll('C_and_C','C&C');
 const human=s=>String(s||'').replaceAll('_',' ');
 const fieldLabels={theory_position_tldr:'Theoretical connection',human_facing_because:'Connection to human activity',author_claim_text:'Claim made by the authors',counterevidence_and_limits:'Counterevidence and limitations',evidence_basis:'Supporting evidence',applies_to:'Applies to',source_role:'Role of this source',operationalization:'Use in the design',supporting_passage:'Supporting passage',record_id:'Paper record',work_id:'Source record'};
 const brief=(s,n=250)=>{s=String(s||'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n).replace(/\s+\S*$/,'')+'…':s;};
 const value=(rows,key)=>(rows||[]).find(r=>r.key===key)?.value||'';
 const safeHref=s=>/^(?:https?:\/\/|[^:\\]*$)/i.test(String(s))?String(s):'#';
 let indexPromise,searchPromise;const shards=new Map();
 async function json(url){const r=await fetch(url);if(!r.ok)throw Error(r.status);return r.json();}
 function index(){return indexPromise||(indexPromise=json('paper-cards-data/index.json').catch(e=>{indexPromise=null;throw e;}));}
 function vocabulary(){return searchPromise||(searchPromise=json('paper-cards-data/search.json').catch(e=>{searchPromise=null;throw e;}));}
 async function detail(card){if(!shards.has(card.url))shards.set(card.url,json('paper-cards-data/'+card.url).catch(e=>{shards.delete(card.url);throw e;}));const shard=await shards.get(card.url),c=shard.cards.find(c=>c.id===card.id);if(!c)throw Error('Missing card');return c;}
 function inView(p,view='ai'){
  if(view==='all')return true;
  if(!p.cards.some(c=>c.evidence_use?.status!=='excluded'))return false;
  // Stream 2 needs no AI: a retained claim card shows even when the paper's Stream 1 card is a non-AI comparison.
  if(view==='theory')return p.cards.some(c=>c.type==='claim'&&c.evidence_use?.status!=='excluded');
  if(view==='pending')return ['pending','awaiting_owner_check'].includes(p.scope);
  return ['retained_ai_indication','owner_checked_ai'].includes(p.scope);
 }
 function matches(p,f={},search={}){
  const q=(f.q||'').trim().toLocaleLowerCase();
  return inView(p,f.view||'ai')&&(!q||(p.title+' '+p.venue+' '+venue(p.venue)+' '+(p.publication_label||'')+' '+p.year+' '+(search[p.id]||'')).toLocaleLowerCase().includes(q))&&
   (!f.type||p.cards.some(c=>c.type===f.type&&(f.view==='all'||c.evidence_use?.status!=='excluded')))&&(!f.stream||p.streams.includes(f.stream))&&(!f.learning||p.learning===f.learning)&&(!f.year||p.year===f.year)&&(!f.scope||p.scope===f.scope);
 }
 function options(papers){return Object.entries(views).map(([key,label])=>`<option value="${key}">${esc(label)} · ${papers.filter(p=>inView(p,key)).length.toLocaleString()}</option>`).join('');}
 function galleryURL(f={},card){const q=new URLSearchParams();for(const [k,v] of Object.entries(f))if(v)q.set(k,v);if(card)q.set('card',card.id||card);return 'card-gallery.html'+(q.size?'?'+q:'');}
 function tile(p,selected){const archived=p.cards.every(c=>c.evidence_use?.status==='excluded');return `<button class="paper-tile" type="button" data-paper="${esc(p.id)}" aria-pressed="${selected===p.id}"><strong>${esc(p.title)}</strong><small>${esc([p.year,venue(p.venue)||p.publication_label,...p.streams].filter(Boolean).join(' · '))}</small><span class="tile-types">${[...new Set(p.cards.map(c=>c.type))].map(t=>`<span>${names[t]}</span>`).join('')}${archived?'<span>Archived · excluded</span>':''}</span></button>`;}
 function rows(items){return (items||[]).map(r=>`<div class="card-row"><div class="card-key">${esc(fieldLabels[r.key]||human(r.key))}</div><div class="card-value">${esc(r.value)}${r.href?` <a href="${esc(safeHref(r.href))}">${esc(r.link==='the round 1 reading card'?'Mechanism card for this paper':r.link||'Linked card')} →</a>`:''}${(r.quotes||[]).map(q=>`<blockquote>${esc(q)}</blockquote>`).join('')}</div></div>`).join('');}
 // Notes retain their source text; only the card's list, quote and inline-code
 // notation is interpreted. Never insert source-provided HTML into the reader.
 function notes(markdown){
  const items=[];let item=null,part=null;
  const start=()=>{item=[];items.push(item);part=null;};
  const add=(type,text)=>{if(!item)start();part={type,text};item.push(part);};
  for(const line of String(markdown||'').split(/\r?\n/)){
   const text=line.trim(),entry=text.match(/^[-*]\s+(?:`?notes?`?\s*:\s*)?(.*)$/i);
   if(!text){part=null;continue;}
   if(entry){start();if(entry[1])add('p',entry[1]);}
   else if(text.startsWith('>'))add('blockquote',text.replace(/^>\s?/,''));
   else if(part)part.text+=' '+text;
   else add('p',text);
  }
  const inline=text=>String(text).split(/(`[^`\n]+`)/g).map(bit=>bit.startsWith('`')&&bit.endsWith('`')?'<code>'+esc(bit.slice(1,-1))+'</code>':esc(bit)).join('');
  return items.length?'<div class="card-notes">'+items.map((parts,n)=>'<div class="card-row"><div class="card-key">Note '+(n+1)+'</div><div class="card-value">'+parts.map(p=>'<'+p.type+'>'+inline(p.text)+'</'+p.type+'>').join('')+'</div></div>').join('')+'</div>':'';
 }
 const humanWorkKeys=new Set(['externalised_to_tool','externalised_to_representation','externalised_to_scaffold','retained_by_person','still_required_of_the_person','still_required_of_person']);
 function sections(c,kind){
  if(kind==='stream1')return [
   ['workflow','Workflow changes · RQ1',(c.shifts||[]).map(s=>'<h4>Shift '+esc(s.n)+'</h4>'+rows(s.entries)).join('')],
   ['human-work','Human activity · RQ1',rows((c.rq3_entries||[]).filter(r=>humanWorkKeys.has(r.key)))],
   ['mechanisms','Scaffold design · RQ2',(c.mechanisms||[]).map(m=>'<h4>'+esc(value(m.entries,'author_term')||m.id)+'</h4>'+rows(m.entries)).join('')],
   ['learning','Learning & support · RQ2',rows((c.rq3_entries||[]).filter(r=>!humanWorkKeys.has(r.key)))],
   ['claims','Measures & comparisons · RQ2',evaluation(c)],
   ['conditions','Conditions & limitations',[...(c.limitations||[]),...(c.boundary_conditions||[])].map(q=>'<p>'+esc(q)+'</p>').join('')],
   ['codes','Recorded codes',rows((c.paper_code_entries||[]).filter(r=>r.key!=='outcome_layer'))],
   ['source','Source & provenance',rows(c.identity_entries)],
   ['notes','Codebook notes',notes(c.notes)]
  ].filter(s=>s[2]);
  return (c.sections||[]).map((s,i)=>['section-'+i,s.title.replace(/\s*[—–-]\s*RQ\d(?:\.\d)?/g,'').replace(/^(\d+) (sources?) the paper stands on$/,'$1 documented $2 · RQ2'),(s.note?'<p>'+esc(s.note)+'</p>':'')+(s.items||[]).map(i=>(i.heading?'<h4>'+esc(i.heading)+'</h4>':'')+(i.evidence_use_note?'<p class="card-use-note">'+esc(i.evidence_use_note)+'</p>':'')+(i.small?'<p>'+esc(i.small)+'</p>':'')+(i.lead?'<p>'+esc(i.lead)+'</p>':'')+rows(i.rows)).join('')]);
 }
 function evaluation(c){
  const body=rows((c.paper_code_entries||[]).filter(r=>r.key==='outcome_layer'))+rows(c.claim_entries);
  return body?'<p class="card-measurement-guide"><a href="living-paper.html#tab:measurement-matrix">Process, artifact & learning: measurement guide ↗</a></p>'+body:'';
 }
 function overview(c,kind){
  if(kind==='stream1')return [
   ['Activity',c.work_domain],
   ['Work people retain',value(c.rq3_entries,'retained_by_person')],
   ['Design support',(c.mechanisms||[]).slice(0,2).map(m=>value(m.entries,'author_term')||value(m.entries,'facet')).filter(Boolean).join('; ')],
   ['Measured outcomes',(c.paper_code_entries||[]).filter(r=>r.key==='outcome_layer').map(r=>r.value).join('; ')],
   ['Learning assessment',value(c.rq3_entries,'learning_evidence')||value(c.rq3_entries,'learning_measured')]
  ].filter(x=>x[1]);
  const all=(c.sections||[]).flatMap(s=>(s.items||[]).flatMap(i=>i.rows||[]));
  return [
   ['Connection',value(all,'theory_position_tldr')],
   ['Claim recorded',value(all,'author_claim_text')],
   ['Applies to',value(all,'applies_to')||value(all,'human_facing_because')],
   ['Evidence & limits',value(all,'counterevidence_and_limits')||value(all,'evidence_basis')]
  ].filter(x=>x[1]);
 }
 function readerLine(card){
  const r=card.reader||{},labels={runtime_audit:'Read by',session_audit:'Read by',card_record:'Recorded reader',protocol_record:'Assigned reader'};
  if(!r.model)return '';
  return `<p class="card-reader">${labels[r.basis]||'Recorded model'} <strong>${esc(r.model)}</strong>${r.effort?' · '+esc(r.effort)+' effort':''}</p>`;
 }
 function citationLine(p){
  const m=p.citation_metadata;if(!m)return '';
  const date=m.observed_at?new Date(m.observed_at+'T12:00:00Z').toLocaleDateString('en',{day:'numeric',month:'short',year:'numeric'}):'retained snapshot';
  return `<p class="detail-meta">${m.count.toLocaleString()}${m.lower_bound?'+':''} citations · Semantic Scholar · ${esc(date)}</p>`;
 }
 function renderCard(p,card,c,prefix){
  const ss=sections(c,card.kind),ov=overview(c,card.kind);
  const notice=card.evidence_use?.status==='excluded'?`<p class="card-use-note">Archived card · ${esc(card.evidence_use.label)}. <a href="research.html#stream2-selection">Current selection</a></p>`:'';
  return `<article class="card-reading"><p class="eyebrow">${esc(p.streams.join(' · '))}</p><h2>${esc(p.title)}</h2>${notice}<p class="detail-meta">${esc([p.year,venue(p.venue)||p.publication_label,scopeNames[p.scope]??human(p.scope)].filter(Boolean).join(' · '))}${p.doi?` · <a href="https://doi.org/${esc(encodeURI(p.doi))}">DOI ↗</a>`:''}</p>${citationLine(p)}<div class="detail-tabs" role="group" aria-label="Available cards for this paper">${p.cards.map(x=>`<button type="button" data-card="${esc(x.id)}" aria-pressed="${x.id===card.id}">${names[x.type]}</button>`).join('')}</div>${readerLine(card)}${ov.length?`<section class="card-overview" aria-label="Card overview"><p class="eyebrow">At a glance</p><dl>${ov.map(([title,copy])=>`<div><dt>${esc(title)}</dt><dd>${esc(brief(copy))}</dd></div>`).join('')}</dl></section>`:''}<nav class="card-section-nav" aria-label="Sections in this card">${ss.map(([key,title])=>`<button type="button" data-card-section="${prefix}-${key}">${esc(title)}</button>`).join('')}</nav>${ss.map(([key,title,body])=>`<section class="card-section" id="${prefix}-${key}" tabindex="-1"><h3>${esc(title)}</h3>${body}</section>`).join('')}<details class="card-provenance"><summary>Card details</summary><p>${esc(card.provenance)}<br>Card ID: ${esc(card.id)}</p></details></article>`;
 }
 function sectionClick(e,container){const b=e.target.closest('[data-card-section]');if(!b)return;const section=container.querySelector('[id="'+b.dataset.cardSection+'"]');if(section){section.focus({preventScroll:true});section.scrollIntoView({block:'start',behavior:'instant'});}}
 return {names,views,scopeNames,esc,human,index,vocabulary,detail,inView,matches,options,galleryURL,tile,overview,sections,renderCard,sectionClick};
})();
