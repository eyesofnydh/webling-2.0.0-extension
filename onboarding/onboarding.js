/** Webling — first-run tour. */

const Sprite = globalThis.WeblingSprite;
const $ = (id) => document.getElementById(id);

const steps = [...document.querySelectorAll('.step')];
const dots = $('dots');
let current = 0;

$('heroSprite').innerHTML = Sprite.frameSvg('idle', 'classic', { uid: 'tour-hero' });
$('brandIcon').innerHTML = Sprite.iconSvg(48);
$('babyChip').insertAdjacentHTML('afterbegin', Sprite.babySpiderSvg(18));
$('themeRow').innerHTML = ['classic', 'midnight', 'sunset', 'forest']
  .map((p, i) => Sprite.frameSvg(i % 2 ? 'celebrate' : 'idle', p, { uid: `tour-${p}`, acc: ['', 'crown', 'flower', 'star'][i] }))
  .join('');

steps.forEach((_, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dot';
  b.setAttribute('aria-label', `Step ${i + 1} of ${steps.length}`);
  b.addEventListener('click', () => show(i));
  dots.appendChild(b);
});

function show(i) {
  current = Math.max(0, Math.min(steps.length - 1, i));
  steps.forEach((s, idx) => { s.hidden = idx !== current; });
  [...dots.children].forEach((d, idx) => d.setAttribute('aria-current', idx === current ? 'step' : 'false'));
  $('back').disabled = current === 0;
  $('next').textContent = current === steps.length - 1 ? 'Start browsing' : 'Next';
}

async function finish() {
  try {
    await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: { personality: $('personality').value } });
    await chrome.runtime.sendMessage({ type: 'COMPLETE_ONBOARDING' });
  } catch { /* ignore */ }
  window.close();
}

$('next').addEventListener('click', () => (current === steps.length - 1 ? finish() : show(current + 1)));
$('back').addEventListener('click', () => show(current - 1));
$('skip').addEventListener('click', finish);
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement) return;
  if (e.key === 'ArrowRight') show(current + 1);
  else if (e.key === 'ArrowLeft') show(current - 1);
});

(async () => {
  try {
    const cmds = await chrome.commands.getAll();
    const summon = cmds.find((c) => c.name === 'summon-webling');
    const keys = (summon && summon.shortcut) || 'Alt+Shift+S';
    $('kSummon').parentElement.innerHTML = keys.split('+').map((k) => `<kbd>${k}</kbd>`).join('<span>+</span>');
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (resp && resp.success) $('personality').value = resp.data.personality;
  } catch { /* ignore */ }
})();

show(0);
