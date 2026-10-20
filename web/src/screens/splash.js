// Launch moment: the play mark from the native launch screen slides aside, the name
// appears and a test-card stripe draws underneath.
import { h } from '../util.js';
import MARK from '../../assets/mark.svg';

export function splash(root) {
  const el = h('div.splash', null, h('div.splash-inner', null, h('div.splash-mark', { html: MARK }), h('div.splash-words', null, h('div.splash-name', { text: 'IPTV Player' }), h('div.splash-bars', null, ['#F4F0E6', '#FFC83A', '#48D6E0', '#5BD98C', '#D36BD9', '#FF5148', '#3B6FE0'].map((c) => h('i', { style: `background:${c}` }))))));
  root.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('go')));
  return {
    el,
    done() {
      el.classList.add('out');
      setTimeout(() => el.parentNode && el.parentNode.removeChild(el), 450);
    },
  };
}
