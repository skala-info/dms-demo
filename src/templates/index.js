// templates/index.js — the template catalogue.
//
// `kind` drives suppression (see domain/donor.js `suppressionReason`):
//   TRANSACTIONAL — the donor asked for this by acting (registering, giving)
//   STEWARDSHIP   — progress updates the donor can opt out of independently
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, htmlToText } from './render.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();
const load = (file) => {
  if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(dir, file), 'utf8'));
  return cache.get(file);
};

export const TEMPLATES = {
  welcome: {
    file: 'welcome.html',
    kind: 'TRANSACTIONAL',
    subject: 'Welcome to {{ org.name }}',
  },
  donation_thank_you: {
    file: 'donation_thank_you.html',
    kind: 'TRANSACTIONAL',
    subject: 'Thank you for your gift of {{ donation.currency }} {{ donation.amount }}',
  },
  campaign_milestone: {
    file: 'campaign_milestone.html',
    kind: 'STEWARDSHIP',
    subject: '{{ campaign.name }} is {{ milestone.percent }}% funded',
  },
  campaign_goal_reached: {
    file: 'campaign_goal_reached.html',
    kind: 'STEWARDSHIP',
    subject: '{{ campaign.name }} reached its goal',
  },
  campaign_progress_digest: {
    file: 'campaign_progress_digest.html',
    kind: 'STEWARDSHIP',
    subject: 'Progress update: {{ campaign.name }} is {{ campaign.percent }}% funded',
  },
  campaign_closed: {
    file: 'campaign_closed.html',
    kind: 'STEWARDSHIP',
    subject: '{{ campaign.name }} has closed at {{ campaign.percent }}% of goal',
  },
  donation_reversed: {
    file: 'donation_reversed.html',
    kind: 'TRANSACTIONAL',
    subject: 'Your gift to {{ org.name }} has been reversed',
  },
};

export const templateKind = (key) => TEMPLATES[key]?.kind ?? 'STEWARDSHIP';

/**
 * Render one message.
 * @returns {{subject:string, html:string, text:string, warnings:Array}}
 */
export function renderTemplate(key, context) {
  const tpl = TEMPLATES[key];
  if (!tpl) throw new Error(`Unknown template ${key}`);

  const warnings = [];
  const ctx = { ...context };

  if (ctx.campaign) {
    const p = render(load('_progress.html'), ctx);
    ctx.progress = p.html;
    warnings.push(...p.warnings);
  }

  const body = render(load(tpl.file), ctx);
  warnings.push(...body.warnings);

  const page = render(load('layout.html'), { ...ctx, content: body.html });
  warnings.push(...page.warnings);

  // A subject line is plain text, not HTML. The renderer escapes every merge field —
  // right for the body, wrong here: an organisation or campaign called "Youth & Emerging
  // Leaders" would otherwise arrive in the inbox as "Youth &amp; Emerging Leaders".
  const subject = render(tpl.subject, ctx);
  warnings.push(...subject.warnings);

  return {
    subject: htmlToText(subject.html),
    html: page.html,
    text: htmlToText(page.html),
    warnings,
  };
}
