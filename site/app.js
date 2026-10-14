const translate = document.querySelector('#translate-demo');
const translations = [...document.querySelectorAll('[data-translation]')];
const state = document.querySelector('.demo-state');
let generation = 0;
translate.addEventListener('click', () => {
  const enabled = translate.getAttribute('aria-pressed') !== 'true';
  translate.setAttribute('aria-pressed', String(enabled));
  translate.innerHTML = enabled ? '<span aria-hidden="true">译</span> 恢复原文' : '<span aria-hidden="true">译</span> 试试双语阅读';
  const current = ++generation;
  translations.forEach(node => { node.hidden = true; });
  state.textContent = enabled ? '原文保留，译文在旁。' : '原文，始终在这里。';
  if (enabled) translations.forEach((node, index) => setTimeout(() => { if (generation === current) node.hidden = false; }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : index * 260));
});
const word = document.querySelector('#word-demo');
const card = document.querySelector('#word-card');
function closeWord() { card.hidden = true; word.setAttribute('aria-expanded', 'false'); }
word.addEventListener('click', () => { card.hidden = !card.hidden; word.setAttribute('aria-expanded', String(!card.hidden)); });
document.querySelector('#close-word').addEventListener('click', () => { closeWord(); word.focus(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !card.hidden) { closeWord(); word.focus(); } });
document.addEventListener('click', event => { if (!word.contains(event.target) && !card.contains(event.target)) closeWord(); });
// Enhancement only: the release page remains usable if GitHub's API is unavailable.
fetch('https://api.github.com/repos/vibe-ideas/cloudys-gloss/releases/latest', { signal: AbortSignal.timeout(5000) })
  .then(response => { if (!response.ok) throw new Error('Release unavailable'); return response.json(); })
  .then(release => {
    const asset = release.assets?.find(item => /^cloudys-gloss-[0-9.]+-chrome\.zip$/.test(item.name));
    if (asset && new URL(asset.browser_download_url).origin === 'https://github.com') document.querySelector('[data-download="chrome"]').href = asset.browser_download_url;
  }).catch(() => {});

const navigation = document.querySelector('#main-nav');
const menuToggle = document.querySelector('.menu-toggle');
const mobileNavigation = matchMedia('(max-width: 760px)');
function closeNavigation(restoreFocus = false) {
  const wasOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  navigation.classList.remove('is-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', '打开导航');
  if (wasOpen && restoreFocus) menuToggle.focus();
}
menuToggle.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  navigation.classList.toggle('is-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
});
navigation.addEventListener('click', event => { if (event.target.closest('a')) closeNavigation(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeNavigation(true); });
document.addEventListener('click', event => { if (!event.target.closest('.nav')) closeNavigation(); });
mobileNavigation.addEventListener('change', () => closeNavigation());
