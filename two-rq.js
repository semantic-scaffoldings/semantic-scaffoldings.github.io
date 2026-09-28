(() => {
 document.querySelectorAll('.annual-chart').forEach(chart=>{
  const points=[...chart.querySelectorAll('.annual-segment')],status=chart.querySelector('.annual-status');
  points.forEach((point,i)=>{
   const show=()=>{status.textContent=point.getAttribute('aria-label');};
   point.addEventListener('pointerenter',show);
   point.addEventListener('focus',()=>{points.forEach(p=>p.tabIndex=p===point?0:-1);show();});
   point.addEventListener('click',()=>{point.focus();show();});
   point.addEventListener('keydown',event=>{
    if(['Enter',' '].includes(event.key)){event.preventDefault();show();return;}
    const next={ArrowRight:Math.min(i+2,points.length-2+i%2),ArrowLeft:Math.max(i%2,i-2),ArrowUp:i%2===0?i+1:i,ArrowDown:i%2===1?i-1:i,Home:0,End:points.length-1}[event.key];
    if(next!==undefined){event.preventDefault();points[next].focus();}
   });
  });
 });
 document.querySelectorAll('.trend-chart').forEach(chart=>{
  const status=chart.querySelector('.trend-tooltip');
  const selector=chart.querySelector('.domain-select');
  if(selector){
   const panels=[...chart.querySelectorAll('.trend-panel')],buttons=[...chart.querySelectorAll('[data-domain]')];
   const choose=key=>{selector.value=key;panels.forEach(panel=>{panel.hidden=panel.dataset.category!==key;});buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.domain===key)));status.textContent='Hover or select a point for counts. Use arrow keys to move through years.';};
   chart.classList.add('domain-enhanced');
   selector.addEventListener('change',()=>choose(selector.value));
   buttons.forEach(button=>button.addEventListener('click',()=>{choose(button.dataset.domain);chart.querySelector('.domain-explorer').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}));
   choose(buttons[0].dataset.domain);
  }
  chart.querySelectorAll('.trend-panel,.family-series').forEach(panel=>{
   const points=[...panel.querySelectorAll('.trend-point')],tip=panel.querySelector('.trend-point-tooltip');
   const family=panel.classList.contains('family-series');
   const highlight=()=>{if(family){chart.classList.add('has-family-focus');chart.querySelectorAll('.family-series').forEach(s=>s.classList.toggle('is-active',s===panel));}};
   const clear=()=>{if(tip)tip.hidden=true;if(family){chart.classList.remove('has-family-focus');panel.classList.remove('is-active');}};
   if(family)panel.addEventListener('pointerenter',highlight);
   panel.addEventListener('pointerleave',()=>{if(!panel.contains(document.activeElement))clear();});
   panel.addEventListener('focusout',e=>{if(!panel.contains(e.relatedTarget))clear();});
   points.forEach((point,i)=>{
    const show=()=>{status.textContent=point.getAttribute('aria-label');if(tip){tip.textContent=status.textContent;tip.hidden=false;}highlight();};
    point.addEventListener('pointerenter',show);
    point.addEventListener('focus',()=>{points.forEach(p=>p.tabIndex=p===point?0:-1);show();});
    point.addEventListener('click',()=>{point.focus();show();});
    point.addEventListener('keydown',e=>{
     if(['Enter',' '].includes(e.key)){e.preventDefault();show();return;}
     const next={ArrowRight:Math.min(i+1,points.length-1),ArrowLeft:Math.max(i-1,0),Home:0,End:points.length-1}[e.key];
     if(next!==undefined){e.preventDefault();points[next].focus();}
    });
   });
  });
 });
})();
