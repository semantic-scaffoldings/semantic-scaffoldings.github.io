/* Transform-only shelf motion, asleep when offscreen. No animation library. */
(() => {
  'use strict';
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('.reader-chart-viewport,.reader-teaser-viewport').forEach(view=>{
    view.addEventListener('keydown',event=>{
      if(event.target!==view||event.ctrlKey||event.metaKey||event.altKey||view.scrollWidth<=view.clientWidth)return;
      const step=Math.max(80,Math.round(view.clientWidth*.7));
      const next={ArrowRight:view.scrollLeft+step,ArrowLeft:view.scrollLeft-step,Home:0,End:view.scrollWidth-view.clientWidth}[event.key];
      if(next===undefined)return;
      event.preventDefault();event.stopPropagation();
      view.scrollTo({left:Math.max(0,Math.min(next,view.scrollWidth-view.clientWidth)),behavior:'instant'});
    });
  });
  const routeMap=document.querySelector('.paper-route-map');
  if(routeMap){
    const tabs=[...routeMap.querySelectorAll('[role=tab]')];
    const show=(tab,focus=false)=>{
      tabs.forEach(t=>{const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;document.getElementById(t.getAttribute('aria-controls')).hidden=!active;});
      if(focus)tab.focus();
    };
    tabs.forEach((tab,index)=>{
      tab.addEventListener('click',()=>show(tab));
      tab.addEventListener('keydown',e=>{
        let next=index;
        if(e.key==='ArrowRight')next=(index+1)%tabs.length;
        else if(e.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
        else if(e.key==='Home')next=0;
        else if(e.key==='End')next=tabs.length-1;
        else return;
        e.preventDefault();show(tabs[next],true);
      });
    });
    // Previews never fetch or fabricate an abstract: use the current section's
    // first prose paragraph, clearly labelled as an excerpt.
    const peek=document.createElement('aside');peek.className='paper-section-peek';peek.hidden=true;
    peek.setAttribute('role','dialog');peek.setAttribute('aria-label','Section preview');document.body.append(peek);
    let trigger, timer, restoringFocus=false;
    const close=()=>{clearTimeout(timer);peek.hidden=true;trigger?.setAttribute('aria-expanded','false');};
    const restoreFocus=link=>{restoringFocus=true;try{link?.focus({preventScroll:true});}finally{restoringFocus=false;}};
    const hideSoon=()=>{clearTimeout(timer);timer=setTimeout(close,180);};
    function sectionContent(link){
      const target=document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if(!target)return null;
      const heading=target.querySelector('h2,h3')||target;
      const prose='p.paper-paragraph,p:not([class]),.paper-abstract p';
      let paragraph=target.querySelector(prose);
      // Subsection anchors are headings; their prose is a sibling, not a child.
      // Stay within this parent and stop at the next peer or ancestor heading.
      if(!paragraph&&/^H[1-6]$/.test(target.tagName)){
        const level=Number(target.tagName.slice(1));
        for(let node=target.nextElementSibling;node;node=node.nextElementSibling){
          if(/^H[1-6]$/.test(node.tagName)&&Number(node.tagName.slice(1))<=level)break;
          if(node.matches(prose)){paragraph=node;break;}
        }
      }
      return paragraph?{heading,paragraph}:null;
    }
    function open(link){
      const content=sectionContent(link);if(!content)return;
      clearTimeout(timer);trigger?.setAttribute('aria-expanded','false');trigger=link;
      const {heading,paragraph}=content;
      const text=paragraph.textContent.replace(/\s+/g,' ').trim();
      const excerpt=text.length>300?text.slice(0,300).replace(/\s+\S*$/,'')+'…':text;
      const label=document.createElement('p');label.className='reader-kicker';label.textContent='From this section';
      const title=document.createElement('h2');title.textContent=heading.textContent.trim();
      const body=document.createElement('p');body.textContent=excerpt;
      const go=document.createElement('a');go.href=link.getAttribute('href');go.textContent='Read this section →';go.onclick=close;
      const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='×';dismiss.setAttribute('aria-label','Close section preview');dismiss.onclick=()=>{close();restoreFocus(link);};
      peek.replaceChildren(dismiss,label,title,body,go);peek.hidden=false;link.setAttribute('aria-expanded','true');
      const rect=link.getBoundingClientRect(),width=peek.getBoundingClientRect().width,height=peek.getBoundingClientRect().height;
      peek.style.left=Math.min(innerWidth-width-16,Math.max(16,rect.right+18))+'px';
      peek.style.top=Math.max(76,Math.min(innerHeight-height-16,rect.top-8))+'px';
    }
    const attachPreviews=()=>document.querySelectorAll('#lpr-reader-tools .paper-contents a[href^="#"]').forEach(link=>{
      if(!sectionContent(link))return;
      let pointerFocus=false;
      link.setAttribute('aria-haspopup','dialog');link.setAttribute('aria-expanded','false');
      link.addEventListener('pointerenter',event=>{if(event.pointerType==='touch')return;clearTimeout(timer);timer=setTimeout(()=>open(link),180);});
      link.addEventListener('pointerleave',hideSoon);
      // A touch-induced focus preview can cover the link before its click lands.
      link.addEventListener('pointerdown',()=>{pointerFocus=true;close();});
      link.addEventListener('pointercancel',()=>{pointerFocus=false;});
      link.addEventListener('focus',()=>{if(!restoringFocus&&!pointerFocus)open(link);pointerFocus=false;});
      link.addEventListener('blur',()=>{pointerFocus=false;hideSoon();});
      // The title is a native section link. Hover and focus offer an optional
      // preview, while a click, tap, or Enter goes straight to the passage.
      link.addEventListener('click',()=>{pointerFocus=false;close();});
    });
    if(document.readyState!=='complete')addEventListener('DOMContentLoaded',attachPreviews,{once:true});else attachPreviews();
    peek.addEventListener('pointerenter',()=>clearTimeout(timer));peek.addEventListener('pointerleave',hideSoon);
    peek.addEventListener('focusin',()=>clearTimeout(timer));peek.addEventListener('focusout',hideSoon);
    addEventListener('keydown',e=>{if(e.key==='Escape'&&!peek.hidden){const last=trigger;close();restoreFocus(last);}});
    document.addEventListener('pointerdown',e=>{if(!peek.hidden&&!peek.contains(e.target)&&e.target!==trigger)close();});
    addEventListener('scroll',()=>{if(!peek.hidden)close();},{passive:true});
  }
  const topLink=document.querySelector('.reader-back-top');
  let topPending=false;
  function updateTop(){topPending=false;topLink?.classList.toggle('is-hidden',scrollY<500);}
  function queueTop(){if(!topPending){topPending=true;requestAnimationFrame(updateTop);}}
  if(topLink){
    updateTop();addEventListener('scroll',queueTop,{passive:true});
    topLink.addEventListener('click',event=>{event.preventDefault();window.scrollTo({top:0,behavior:motion.matches?'instant':'smooth'});document.querySelector('.publication-nav__brand,.site-header .brand')?.focus({preventScroll:true});history.replaceState(null,'',location.pathname+location.search);});
  }
  document.querySelectorAll('[data-reader-copy-citation]').forEach(button=>{
    button.addEventListener('click',async()=>{
      const card=button.closest('.reader-citation-actions'),field=card.querySelector('[data-citation-bibtex]'),status=card.querySelector('[data-copy-citation-status]');
      let copied=false;
      try{await navigator.clipboard.writeText(field.value);copied=true;}catch{
        const temporary=document.createElement('textarea');temporary.value=field.value;
        temporary.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';
        document.body.append(temporary);temporary.select();
        try{copied=document.execCommand('copy');}catch{copied=false;}finally{temporary.remove();button.focus({preventScroll:true});}
      }
      status.textContent=copied?'Copied':'Select and copy the citation below.';
      if(!copied){field.focus();field.select();}
    });
  });
  const library=document.querySelector('.discovery-library');
  if(!library)return;
  const preview=document.getElementById('shelf-preview');
  // The preview contains an action, so it is a labelled group rather than a tooltip.
  preview.setAttribute('role','group');preview.setAttribute('aria-label','Paper preview');
  const palettes=[['#637768','#8f785b','#b9663f','#8c9390','#536e72','#b17a4e','#7a8270'],['#738171','#a77659','#5c7374','#958d70','#b75b35','#66778a','#9b8066']];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>n.toLocaleString();
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const books=[];
  let loaded=false,inView=false,frame=0,lastY=scrollY,lastTime=performance.now(),sway=0;
  let active=null,hovered=null,focused=null,hoverPreview=false,hideTimer=0,restoringShelfFocus=false;
  function shuffle(items){const out=items.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
  function spineMarks(id){
    const seed=[...id].reduce((sum,c)=>sum+c.charCodeAt(0),0),paths=[];
    for(let word=0;word<3+seed%2;word++){
      const y=5+word*15,x=5+(seed+word)%3;
      paths.push('M'+x+' '+y+'c3 -1 3 2 0 3s-3 3 0 4 3 3 -1 5');
    }
    return '<svg class="shelf-book-marks" viewBox="0 0 14 70" aria-hidden="true"><path d="'+paths.join(' ')+'"/><path d="M4 66h6" opacity=".45"/></svg>';
  }
  function placePreview(link){
    const box=link.getBoundingClientRect();
    const above=box.top-78>=innerHeight-box.bottom-22;
    const room=above?box.top-78:innerHeight-box.bottom-22;
    preview.style.maxHeight=Math.max(120,room-16)+'px';
    const rect=preview.getBoundingClientRect();
    preview.style.left=clamp(box.left+box.width/2-rect.width/2,16,innerWidth-rect.width-16)+'px';
    preview.style.top=(above?box.top-rect.height-12:box.bottom+12)+'px';
  }
  function closePreview(){if(active)active.removeAttribute('aria-describedby');active=null;preview.hidden=true;}
  function scheduleHide(){clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(!hovered&&!focused&&!hoverPreview&&!preview.contains(document.activeElement))closePreview();},120);}
  function citationLabel(paper){
    const meta=paper.citation_metadata;
    if(!meta)return '';
    const date=meta.observed_at?new Date(meta.observed_at+'T12:00:00Z').toLocaleDateString('en',{month:'short',year:'numeric'}):'retained snapshot';
    return '<small title="Count recorded '+esc(date)+'">'+fmt(meta.count)+(meta.lower_bound?'+':'')+' citations</small>';
  }
  function show(link,paper,stream){
    clearTimeout(hideTimer);if(active&&active!==link)active.removeAttribute('aria-describedby');active=link;
    preview.innerHTML='<p class="reader-kicker">'+(stream==='stream1'?'Stream 1 · AI systems':'Stream 2 · Prior knowledge')+'</p><h3>'+esc(paper.title)+'</h3><p class="shelf-preview-meta">'+esc([paper.year,paper.venue||paper.publication_label].filter(Boolean).join(' · '))+'</p><div class="shelf-preview-foot">'+citationLabel(paper)+'</div>';
    const openCard=document.createElement('a');openCard.href=link.href;openCard.target='_blank';openCard.rel='noopener';openCard.textContent='Open card ↗';openCard.setAttribute('aria-label','Open evidence card in a new tab');preview.querySelector('.shelf-preview-foot').append(openCard);
    preview.hidden=false;link.setAttribute('aria-describedby','shelf-preview');placePreview(link);
  }
  function paint(){
    frame=0;if(document.hidden||!inView)return;
    const now=performance.now(),distance=scrollY-lastY;
    sway=distance?clamp(distance/Math.max(16,now-lastTime)*1.2,-2,2):sway*.82;
    lastY=scrollY;lastTime=now;
    const total=books.reduce((n,g)=>n+g.items.filter(e=>!e.hidden).length,0);let index=0;
    for(const group of books){
      const rect=group.stage.getBoundingClientRect();
      const progress=clamp((innerHeight-rect.top-28)/Math.max(60,Math.min(210,rect.height-28)),0,1);
      group.items.forEach((slot,i)=>{
        if(slot.hidden)return;
        const reveal=motion.matches?1:clamp((progress-index++/Math.max(1,total-1)*.36)/.6,0,1);
        const ease=1-Math.pow(1-reveal,3);
        slot.style.transform='translateY('+((1-ease)*52).toFixed(2)+'px) rotateZ('+(motion.matches?0:sway*(i%2?.7:1)).toFixed(2)+'deg)';
        slot.style.opacity=(.1+.9*ease).toFixed(2);
      });
    }
    if(active)placePreview(active);
    if(!motion.matches&&Math.abs(sway)>.02)frame=requestAnimationFrame(paint);
  }
  function wake(){if(inView&&!frame&&!document.hidden)frame=requestAnimationFrame(paint);}
  function fitShelves(){
    for(const group of books){
      let used=0;const available=Math.max(0,group.row.clientWidth-12);
      for(const slot of group.items){used+=parseFloat(slot.style.getPropertyValue('--book-w'))+3;slot.hidden=used>available;}
    }
  }
  async function load(){
    if(loaded)return;loaded=true;
    try{
      const response=await fetch(library.dataset.catalog||'paper-cards-data/shelf-catalog.json');
      if(!response.ok)throw Error('Shelf catalog unavailable');const catalog=await response.json();
      library.querySelectorAll('[data-shelf]').forEach((shelf,groupIndex)=>{
        const stream=shelf.dataset.shelf,row=shelf.querySelector('.shelf-books'),stage=shelf.querySelector('.shelf-stage');
        const items=[];
        for(const paper of shuffle(catalog.streams[stream])){
          const width=12+(paper.citations===null?0:Math.min(30,7*Math.log10(1+paper.citations)));
          // A bounded pool fills wide windows and can reveal more on resize.
          if(items.length>=256)break;
          const height=74+Math.min(68,11*Math.sqrt(Math.max(0,2026-paper.year)));
          const slot=document.createElement('div');slot.className='shelf-slot';slot.setAttribute('role','listitem');
          slot.style.setProperty('--book-w',width.toFixed(1)+'px');slot.style.setProperty('--book-h',height.toFixed(1)+'px');slot.style.setProperty('--book-color',palettes[groupIndex][items.length%palettes[groupIndex].length]);
          const link=document.createElement('a');link.className='shelf-book';link.href=paper.href;link.target='_blank';link.rel='noopener';link.dataset.card=paper.card;
          link.dataset.binding=['cloth','linen','leather'][items.length%3];
          link.setAttribute('aria-label',paper.title+' · '+paper.year+((paper.venue||paper.publication_label)?' · '+(paper.venue||paper.publication_label):'')+'. Open evidence card in a new tab.');
          link.innerHTML=spineMarks(paper.card)+'<span class="shelf-book-stamp" aria-hidden="true">◈</span>';
          link.addEventListener('pointerenter',()=>{hovered=link;show(link,paper,stream);});
          link.addEventListener('pointerleave',()=>{hovered=null;scheduleHide();});
          link.addEventListener('focus',()=>{focused=link;if(!restoringShelfFocus)show(link,paper,stream);});
          link.addEventListener('blur',()=>{focused=null;scheduleHide();});
          slot.append(link);row.append(slot);items.push(slot);
        }
        books.push({stage,row,items});
      });
      fitShelves();library.dataset.loaded='true';wake();
    }catch{library.querySelector('.shelf-load-status').textContent='The shelves could not load. Both gallery links above are still available.';}
  }
  preview.addEventListener('pointerenter',()=>{hoverPreview=true;clearTimeout(hideTimer);});
  preview.addEventListener('pointerleave',()=>{hoverPreview=false;scheduleHide();});
  preview.addEventListener('focusin',()=>clearTimeout(hideTimer));
  preview.addEventListener('focusout',scheduleHide);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){
    const restore=preview.contains(document.activeElement)?active:null;closePreview();
    if(restore){restoringShelfFocus=true;try{restore.focus({preventScroll:true});}finally{restoringShelfFocus=false;}}
  }});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;sway=0;}else wake();});
  addEventListener('scroll',()=>{if(!inView)return;wake();},{passive:true});
  addEventListener('resize',()=>{closePreview();fitShelves();wake();},{passive:true});
  motion.addEventListener('change',()=>{sway=0;wake();});
  if('IntersectionObserver' in window){
    const preload=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){load();preload.disconnect();}},{rootMargin:'1000px'});preload.observe(library);
    new IntersectionObserver(entries=>{inView=entries.some(e=>e.isIntersecting);if(inView){lastY=scrollY;lastTime=performance.now();wake();}else{cancelAnimationFrame(frame);frame=0;sway=0;closePreview();}},{rootMargin:'60px'}).observe(library);
  }else{inView=true;load();}
})();
