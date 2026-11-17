import { html } from '../html.js';

/**
 * A labelled bar: meter({ label: 'Spent today', value: '$142 of $400', ratio: 0.355 }). Tones: default, warning,
 * danger, live. The words carry the meaning; the bar is a second signal (role="meter" for screen readers).
 */
export function meter({ label, value, ratio = 0, tone }) {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  const pct = Math.round(r * 100);
  return html`<div class="meter${tone ? ` meter--${tone}` : ''}"><div class="meter__head"><span>${label}</span><span>${value}</span></div><div class="meter__track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${value}"><div class="meter__fill meter__fill--p${pct}"></div></div></div>`;
}
