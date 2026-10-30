// The UPDATES panel on the title screen. Renders shared/changelog.js, which is
// also what docs/CHANGELOG.md is generated from, so the menu and the docs can
// never disagree.
import { CHANGELOG, CHANGELOG_NOTE } from '../../shared/changelog.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeText = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// The changelog is authored in light markdown: **bold** and `code`.
export function inline(text) {
  return escapeText(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function blockHtml(b) {
  if (b.h) return `<h4>${inline(b.h)}</h4>`;
  if (b.p) return `<p>${inline(b.p)}</p>`;
  if (b.ul) return `<ul>${b.ul.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`;
  if (b.table) {
    const head = b.table.head.map((h) => `<th>${inline(h)}</th>`).join('');
    const rows = b.table.rows
      .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      .join('');
    return `<table class="cl-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  }
  return '';
}

/** The full body for one entry (all blocks), newest entry first by default. */
export function renderEntry(id) {
  const entry = CHANGELOG.find((e) => e.id === id) || CHANGELOG[CHANGELOG.length - 1];
  if (!entry) return '';
  const tagline = entry.tagline ? `<div class="cl-tagline">${inline(entry.tagline)}</div>` : '';
  const note = id === CHANGELOG[0].id && CHANGELOG_NOTE.length
    ? `<div class="cl-note">${CHANGELOG_NOTE.map(inline).join('<br><br>')}</div>`
    : '';
  return `${tagline}${entry.blocks.map(blockHtml).join('')}${note}`;
}

/** Tab buttons, newest first. */
export function renderTabs(activeId) {
  return CHANGELOG.slice()
    .reverse()
    .map((e) => {
      const active = e.id === activeId ? ' active' : '';
      return `<button class="cl-tab${active}" data-entry="${escapeText(e.id)}"` +
        `${active ? ' aria-current="true"' : ''}>${inline(e.version)}</button>`;
    })
    .join('');
}

/** Default tab: the newest entry (the one people want to read first). */
export const DEFAULT_ENTRY = CHANGELOG.length ? CHANGELOG[CHANGELOG.length - 1].id : null;

/** The newest version, for the button label, so it never goes stale. */
export const LATEST_VERSION = CHANGELOG.length ? CHANGELOG[CHANGELOG.length - 1].version : '';
