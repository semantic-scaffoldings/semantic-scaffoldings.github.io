/* Progressive enhancement: examples and contents remain readable without JS. */
(() => {
  const example = document.querySelector('.learning-example');
  if (example) {
    const buttons = [...example.querySelectorAll('[data-example-choice]')];
    const panels = [...example.querySelectorAll('[data-example-panel]')];
    const choose = key => {
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.exampleChoice === key)));
      panels.forEach(panel => { panel.hidden = panel.dataset.examplePanel !== key; });
    };
    buttons.forEach(button => button.addEventListener('click', () => choose(button.dataset.exampleChoice)));
    example.querySelector('.example-choices').hidden = false;
    choose(buttons[0].dataset.exampleChoice);
  }
  const contents = document.querySelector('.paper-toc .contents');
  if (!contents) return;
  const wide = window.matchMedia('(min-width: 1081px)');
  const adaptContents = () => { contents.open = wide.matches; };
  adaptContents();
  wide.addEventListener('change', adaptContents);
  const links = [...contents.querySelectorAll('a[href^="#"]')];
  const sections = links.map(link => document.getElementById(link.hash.slice(1))).filter(Boolean);
  const mark = id => links.forEach(link => {
    if (link.hash === '#' + id) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  links.forEach(link => link.addEventListener('click', () => {
    mark(link.hash.slice(1));
    if (!wide.matches) contents.open = false;
  }));
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const active = sections.filter(section => section.getBoundingClientRect().top <= 150).at(-1);
    if (active) mark(active.id);
  };
  window.addEventListener('scroll', () => {
    if (!scheduled) { scheduled = true; window.requestAnimationFrame(update); }
  }, {passive:true});
  update();
})();
