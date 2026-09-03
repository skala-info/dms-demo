/* app.js — the DMS demo1 operator console.
 *
 * One page, no framework, no build step. It is a client of /api/v1 like any other: every
 * number on this screen came out of the same endpoints the README curls, with the same
 * API key, through the same auth. Nothing here reaches into the database, and no business
 * rule is re-implemented — a rule the UI needed would be a rule in the wrong place.
 */
(() => {
  'use strict';

  // ------------------------------------------------------------------ helpers

  const $ = (sel, root = document) => root.querySelector(sel);

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /**
   * Money arrives as a decimal string with a sibling currency and stays one: grouping is
   * string work, and arithmetic is done in integer minor units. There is no float here
   * either.
   */
  function money(decimal, currency) {
    if (decimal === null || decimal === undefined) return '—';
    const [whole, frac = '00'] = String(decimal).split('.');
    const negative = whole.startsWith('-');
    const grouped = (negative ? whole.slice(1) : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '-' : ''}${grouped}.${frac}${currency ? ` ${currency}` : ''}`;
  }

  function toMinor(decimal) {
    const [whole, frac = ''] = String(decimal ?? '0').split('.');
    const negative = whole.trim().startsWith('-');
    const digits = (negative ? whole.trim().slice(1) : whole.trim()) || '0';
    const minor = (Number.parseInt(digits, 10) || 0) * 100 + (Number.parseInt(`${frac}00`.slice(0, 2), 10) || 0);
    return negative ? -minor : minor;
  }

  function fromMinor(minor) {
    const negative = minor < 0;
    const abs = Math.abs(minor);
    return `${negative ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  }

  const today = () => new Date().toISOString().slice(0, 10);
  const day = (iso) => (iso ? String(iso).slice(0, 10) : '—');
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

  const TONE = {
    ACTIVE: 'ok', POSTED: 'ok', SENT: 'ok', ISSUED: 'ok',
    QUEUED: 'warn', RETRYING: 'warn', CLOSED: 'warn',
    REVERSED: 'bad', VOIDED: 'bad', FAILED: 'bad', SUPPRESSED: 'bad', DELETED: 'bad',
  };
  const pill = (text, tone) => `<span class="pill ${tone ?? TONE[text] ?? ''}">${esc(text)}</span>`;

  const bar = (percent) => {
    const width = Math.max(0, Math.min(100, Number(percent) || 0));
    return `<div class="bar${width >= 100 ? ' done' : ''}"><i style="width:${width}%"></i></div>`;
  };

  const empty = (text) => `<div class="empty">${esc(text)}</div>`;

  const table = (columns, rows) => (rows.length
    ? `<div class="table-wrap"><table>
         <thead><tr>${columns.map((c) => `<th${c.right ? ' class="right"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
         <tbody>${rows.join('')}</tbody>
       </table></div>`
    : empty('Nothing here yet.'));

  const options = (items, selected, toValue, toLabel) => items
    .map((i) => `<option value="${esc(toValue(i))}"${toValue(i) === selected ? ' selected' : ''}>${esc(toLabel(i))}</option>`)
    .join('');

  // ------------------------------------------------------------------ the API client

  const KEY_STORAGE = 'dms.demo1.api-key';
  let apiKey = localStorage.getItem(KEY_STORAGE) || 'demo-key';

  function setConnection(ok, note) {
    const el = $('#conn');
    el.className = `conn ${ok ? 'ok' : 'bad'}`;
    el.lastElementChild.textContent = note || (ok ? 'connected' : 'disconnected');
  }

  async function api(method, path, { body, headers } = {}) {
    let response;
    try {
      response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      setConnection(false, 'server unreachable');
      throw new Error('The demo1 server is not reachable. Is `npm start` still running?');
    }

    const text = await response.text();
    let payload = null;
    if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }

    if (!response.ok) {
      setConnection(false, response.status === 401 ? 'API key rejected' : 'connected');
      const error = new Error((payload && (payload.detail || payload.title)) || `HTTP ${response.status}`);
      error.status = response.status;
      error.problem = payload;
      throw error;
    }

    setConnection(true);
    return payload;
  }

  const get = (path) => api('GET', path);
  const post = (path, body, headers) => api('POST', path, { body, headers });
  const rows = (envelope) => (envelope && envelope.data) || [];

  // ------------------------------------------------------------------ toast

  let toastTimer = null;

  function problemHtml(error) {
    const problem = error.problem;
    if (!problem) return esc(error.message);
    let html = esc(problem.detail || problem.title || error.message);
    if (Array.isArray(problem.errors) && problem.errors.length) {
      html += `<ul>${problem.errors.map((e) => `<li><b>${esc(e.field)}</b> — ${esc(e.message)}</li>`).join('')}</ul>`;
    }
    if (Array.isArray(problem.duplicate_candidates) && problem.duplicate_candidates.length) {
      html += `<ul>${problem.duplicate_candidates
        .map((c) => `<li>${esc(c.display_name || c.donation_date || c.id)}</li>`).join('')}</ul>`;
    }
    return html;
  }

  function toast(title, detail, tone = 'ok') {
    const el = $('#toast');
    el.className = `toast ${tone}`;
    el.innerHTML = `<div class="t">${esc(title)}</div>${detail ? `<div class="muted">${detail}</div>` : ''}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
  }

  const failed = (title, error) => toast(title, problemHtml(error), 'bad');

  // ------------------------------------------------------------------ routing

  const ROUTES = [];
  const route = (pattern, view) => ROUTES.push({ pattern, view });

  const currentPath = () => {
    const raw = location.hash.replace(/^#/, '') || '/';
    return raw.startsWith('/') ? raw : `/${raw}`;
  };

  const go = (path) => { location.hash = `#${path}`; };

  function highlightNav(path) {
    let best = null;
    for (const link of document.querySelectorAll('#nav a')) {
      link.classList.remove('active');
      const target = link.dataset.route;
      const matches = target === '/'
        ? path === '/'
        : path === target || path.startsWith(`${target}/`) || path.startsWith(`${target}?`);
      if (matches && (!best || target.length > best.dataset.route.length)) best = link;
    }
    if (best) best.classList.add('active');
  }

  let renderToken = 0;

  async function render() {
    const path = currentPath();
    const token = ++renderToken;
    highlightNav(path);

    // Every view binds its handlers to the container by delegation, so the container is
    // replaced rather than refilled: refilling it would leave the previous view's
    // listeners attached and fire the next submit once per render.
    const view = document.createElement('section');
    view.id = 'view';
    view.className = 'view';
    $('#view').replaceWith(view);

    const match = ROUTES
      .map((r) => { const m = r.pattern.exec(path); return m ? { view: r.view, args: m.slice(1).map(decodeURIComponent) } : null; })
      .find(Boolean);

    if (!match) {
      setHeading('Not found', path);
      view.innerHTML = `<div class="panel"><div class="panel-body">No such page. <a href="#/">Back to the overview</a>.</div></div>`;
      return;
    }

    view.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const result = await match.view(...match.args);
      if (token !== renderToken) return;
      setHeading(result.title, result.subtitle);
      view.innerHTML = result.html;
      if (result.onMount) result.onMount(view);
    } catch (error) {
      if (token !== renderToken) return;
      setHeading('Something went wrong');
      view.innerHTML = `<div class="panel"><div class="panel-body">
        <b>This view could not be loaded.</b>
        <div class="muted" style="margin-top:6px">${problemHtml(error)}</div>
      </div></div>`;
      failed('Request failed', error);
    }
  }

  function setHeading(title, subtitle) {
    $('#view-title').textContent = title;
    $('#view-sub').textContent = subtitle || '';
  }

  // ------------------------------------------------------------------ form plumbing

  /** Trimmed, empty-dropped form values; checkboxes always report a real boolean. */
  function fields(form) {
    const out = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim();
    }
    for (const box of form.querySelectorAll('input[type=checkbox]')) out[box.name] = box.checked;
    return out;
  }

  function bind(root, selector, event, handler) {
    root.addEventListener(event, (e) => {
      const target = e.target.closest(selector);
      if (target && root.contains(target)) handler(e, target);
    });
  }

  /** Run a mutation with the submit button disabled, then re-render on success. */
  async function submitting(form, run, successTitle) {
    const button = form.querySelector('button[type=submit]');
    if (button) button.disabled = true;
    try {
      const result = await run();
      toast(successTitle, '', 'ok');
      form.reset();
      await render();
      return result;
    } catch (error) {
      failed('Rejected by the API', error);
      return null;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function act(run, successTitle, detail) {
    try {
      const result = await run();
      toast(successTitle, detail || '', 'ok');
      await render();
      return result;
    } catch (error) {
      failed('Rejected by the API', error);
      return null;
    }
  }

  // ------------------------------------------------------------------ overview

  route(/^\/$/, async () => {
    const [org, campaignsEnv, donorsEnv, donationsEnv, commsEnv, statsEnv] = await Promise.all([
      get('/api/v1/organization'),
      get('/api/v1/campaigns?limit=200'),
      get('/api/v1/donors?limit=200'),
      get('/api/v1/donations?limit=200'),
      get('/api/v1/communications?limit=200'),
      get('/api/v1/stats'),
    ]);

    const organization = org.data;
    const campaigns = rows(campaignsEnv);
    const donors = rows(donorsEnv);
    const donations = rows(donationsEnv);
    const communications = rows(commsEnv);

    const progress = await Promise.all(
      campaigns.map((c) => get(`/api/v1/campaigns/${c.id}/progress`).then((r) => r.data)),
    );

    const posted = donations.filter((d) => d.status === 'POSTED');
    const raisedMinor = progress.reduce((sum, p) => sum + toMinor(p.raised), 0);
    const count = (status) => communications.filter((c) => c.status === status).length;

    const byId = new Map(donors.map((d) => [d.id, d]));
    const donorName = (id) => (byId.get(id) ? byId.get(id).display_name : id.slice(0, 8));

    // Two part-to-whole splits of the same money: which campaign holds it, and how it
    // arrived. Both are few-slice and well separated, which is the only case a ring
    // reads honestly — the size bands and the mail outcomes stay bars on the Stats page,
    // because their values sit close together and a ring would hide exactly that.
    const byCampaign = shareOf(
      campaigns
        .map((campaign, i) => ({ label: campaign.name, value: toMinor(progress[i].raised) }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value),
      { currency: organization.default_currency, totalLabel: 'Campaign' },
    );

    const byMethod = shareOf(
      (statsEnv.data.by_method || [])
        .map((m) => ({ label: methodLabel(m.method), value: toMinor(m.amount) }))
        .filter((row) => row.value > 0),
      { currency: statsEnv.data.currency, totalLabel: 'Method' },
    );

    const cards = campaigns.map((campaign, i) => {
      const p = progress[i];
      return `<article class="panel campaign-card">
        <div class="head">
          <h3><a href="#/campaigns/${esc(campaign.id)}">${esc(campaign.name)}</a></h3>
          ${pill(campaign.status)}
        </div>
        ${bar(p.percent)}
        <div class="figures">
          <span><b>${esc(money(p.raised, p.currency))}</b> raised</span>
          <span>${esc(String(p.percent))}% of ${esc(money(p.goal, ''))}</span>
        </div>
        <div class="figures faint">
          <span>${p.donor_count} donor${p.donor_count === 1 ? '' : 's'} · ${p.donation_count} gift${p.donation_count === 1 ? '' : 's'}</span>
          <span>${p.days_remaining === null || p.days_remaining === undefined ? 'no end date' : `${p.days_remaining} days left`}</span>
        </div>
      </article>`;
    }).join('');

    const recentDonations = posted.slice(0, 6).map((d) => `<tr>
      <td class="nowrap">${esc(day(d.donation_date))}</td>
      <td><a href="#/donors/${esc(d.donor_id)}">${esc(donorName(d.donor_id))}</a></td>
      <td class="right nowrap">${esc(money(d.amount, d.currency))}</td>
      <td>${pill(d.status)}</td>
    </tr>`);

    const recentMail = communications.slice(0, 6).map((c) => `<tr>
      <td><a href="#/communications/${esc(c.id)}">${esc(c.subject || c.template_key)}</a></td>
      <td>${esc(c.to || '—')}</td>
      <td>${pill(c.status)}${c.suppression_reason ? ` <span class="faint mono">${esc(c.suppression_reason)}</span>` : ''}</td>
    </tr>`);

    return {
      title: organization.name,
      subtitle: `${organization.tax_id} · ${organization.default_currency} · next receipt number ${organization.receipt_next_number}`,
      html: `
        <div class="grid stats">
          <div class="stat"><div class="k">Raised</div><div class="v">${esc(money(fromMinor(raisedMinor), organization.default_currency))}</div><div class="n">across ${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}</div></div>
          <div class="stat"><div class="k">Donors</div><div class="v">${donors.length}</div><div class="n">${donors.filter((d) => d.preferences.progress_updates_opt_in && !d.preferences.no_email).length} reachable by email</div></div>
          <div class="stat"><div class="k">Donations</div><div class="v">${posted.length}</div><div class="n">${donations.length - posted.length} reversed</div></div>
          <div class="stat"><div class="k">Email sent</div><div class="v">${count('SENT')}</div><div class="n">${count('QUEUED')} queued · ${count('SUPPRESSED')} suppressed · ${count('FAILED')} failed</div></div>
        </div>

        <div>
          <div class="panel-head" style="border:0;padding:0 0 12px"><h2>Campaigns</h2><a class="btn btn-sm" href="#/campaigns">Manage</a></div>
          ${campaigns.length ? `<div class="grid grid-3">${cards}</div>` : `<div class="panel">${empty('No campaigns yet — create one from the Campaigns tab.')}</div>`}
        </div>

        ${byCampaign.slices.length || byMethod.slices.length ? `<div class="grid grid-2">
          ${byCampaign.slices.length ? chartCard('share-campaign', 'Raised by campaign',
            'share of everything given to date', byCampaign.table, { legend: byCampaign.legend }) : ''}
          ${byMethod.slices.length ? chartCard('share-method', 'How the money arrives',
            'share of everything given to date', byMethod.table, { legend: byMethod.legend }) : ''}
        </div>` : ''}

        <div class="grid grid-2">
          <div class="panel">
            <div class="panel-head"><h2>Latest donations</h2><a class="btn btn-sm" href="#/donations">All</a></div>
            <div class="panel-body tight">${table(
              [{ label: 'Date' }, { label: 'Donor' }, { label: 'Amount', right: true }, { label: 'Status' }], recentDonations,
            )}</div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>Latest email</h2><a class="btn btn-sm" href="#/communications">All</a></div>
            <div class="panel-body tight">${table(
              [{ label: 'Subject' }, { label: 'To' }, { label: 'Status' }], recentMail,
            )}</div>
          </div>
        </div>`,
      onMount(root) {
        bindTableToggles(root);
        const rings = [
          ['share-campaign', byCampaign, 'Raised by campaign'],
          ['share-method', byMethod, 'How the money arrives'],
        ];
        for (const [id, share, title] of rings) {
          const container = root.querySelector(`[data-chart="${id}"]`);
          if (!container) continue;
          mountChart(container, (width) => donutChart(share.slices, width, {
            title,
            centre: compactMajor(share.total),
            centreNote: organization.default_currency,
          }));
          attachTips(container);
        }
      },
    };
  });

  // ------------------------------------------------------------------ donors

  route(/^\/donors$/, async () => {
    const [donorsEnv, campaignsEnv] = await Promise.all([
      get('/api/v1/donors?limit=200'),
      get('/api/v1/campaigns?limit=200'),
    ]);
    const donors = rows(donorsEnv);
    const campaigns = rows(campaignsEnv);

    const list = donors.map((d) => {
      const prefs = [
        d.preferences.no_email ? pill('no email', 'bad') : '',
        d.preferences.no_solicitation ? pill('no solicitation', 'warn') : '',
        d.preferences.progress_updates_opt_in ? pill('progress updates', 'ok') : pill('opted out', ''),
        d.email_bounced ? pill('bounced', 'bad') : '',
      ].filter(Boolean).join('');
      return `<tr class="clickable" data-act="open-donor" data-id="${esc(d.id)}">
        <td class="mono">${esc(d.number)}</td>
        <td><b>${esc(d.display_name)}</b></td>
        <td>${esc(d.email || '—')}</td>
        <td>${prefs}</td>
        <td>${pill(d.status)}</td>
      </tr>`;
    });

    return {
      title: 'Donors',
      subtitle: `${donors.length} record${donors.length === 1 ? '' : 's'}`,
      html: `
        <div class="panel">
          <div class="panel-head"><h2>Register a donor</h2><span class="faint">a welcome email is queued if you pick a campaign</span></div>
          <div class="panel-body">
            <form id="donor-form">
              <div class="form-grid">
                <label class="field"><span>Type</span>
                  <select name="type"><option value="INDIVIDUAL">Individual</option><option value="ORGANIZATION">Organization</option></select>
                </label>
                <label class="field"><span>First name</span><input name="first_name" autocomplete="off"></label>
                <label class="field"><span>Last name</span><input name="last_name" autocomplete="off"></label>
                <label class="field"><span>Organization name</span><input name="organization_name" autocomplete="off"></label>
                <label class="field"><span>Email</span><input name="email" type="email" autocomplete="off"></label>
                <label class="field"><span>Phone</span><input name="phone" autocomplete="off"></label>
                <label class="field"><span>Welcome campaign</span>
                  <select name="welcome_campaign_id"><option value="">— none —</option>${options(campaigns, '', (c) => c.id, (c) => `${c.code} · ${c.name}`)}</select>
                </label>
              </div>
              <div class="form-grid" style="margin-top:12px">
                <label class="field checkline"><input type="checkbox" name="progress_updates_opt_in" checked><span>Send campaign progress updates</span></label>
                <label class="field checkline"><input type="checkbox" name="no_email"><span>Do not email at all</span></label>
                <label class="field checkline"><input type="checkbox" name="no_solicitation"><span>Do not solicit</span></label>
              </div>
              <div class="form-actions"><button class="btn btn-primary" type="submit">Register donor</button></div>
            </form>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>All donors</h2></div>
          <div class="panel-body tight">${table(
            [{ label: 'No.' }, { label: 'Name' }, { label: 'Email' }, { label: 'Preferences' }, { label: 'Status' }], list,
          )}</div>
        </div>`,
      onMount(root) {
        bind(root, 'tr[data-act=open-donor]', 'click', (e, tr) => go(`/donors/${tr.dataset.id}`));
        bind(root, '#donor-form', 'submit', (e, form) => {
          e.preventDefault();
          const body = fields(form);
          submitting(form, async () => {
            try {
              return await post('/api/v1/donors', body);
            } catch (error) {
              if (error.status === 409 && error.problem && error.problem.code === 'DUPLICATE_SUSPECTED'
                  && confirm('A donor with this email already exists. Register a second record anyway?')) {
                return post('/api/v1/donors?allow_duplicate=true', body);
              }
              throw error;
            }
          }, 'Donor registered');
        });
      },
    };
  });

  route(/^\/donors\/([^/]+)$/, async (id) => {
    const [donorEnv, summaryEnv, donationsEnv, commsEnv] = await Promise.all([
      get(`/api/v1/donors/${id}`),
      get(`/api/v1/donors/${id}/summary`),
      get(`/api/v1/donors/${id}/donations?limit=200`),
      get(`/api/v1/donors/${id}/communications?limit=200`),
    ]);
    const donor = donorEnv.data;
    const s = summaryEnv.data;

    const gifts = rows(donationsEnv).map((d) => `<tr>
      <td class="nowrap">${esc(day(d.donation_date))}</td>
      <td class="right nowrap">${esc(money(d.amount, d.currency))}</td>
      <td>${esc(d.method)}</td>
      <td>${pill(d.status)}</td>
      <td class="mono">${esc(d.reference || '—')}</td>
    </tr>`);

    const timeline = rows(commsEnv).map((c) => `<tr class="clickable" data-act="open-comm" data-id="${esc(c.id)}">
      <td class="nowrap">${esc(stamp(c.sent_at || c.created_at))}</td>
      <td>${esc(c.subject || c.template_key)}<div class="faint mono">${esc(c.template_key)}</div></td>
      <td>${pill(c.status)}</td>
      <td class="muted">${esc(c.suppression_reason || c.last_error || '')}</td>
    </tr>`);

    return {
      title: donor.display_name,
      subtitle: `Donor ${donor.number} · ${donor.email || 'no email on file'}`,
      html: `
        <div><a class="back" href="#/donors">← All donors</a></div>

        <div class="grid stats">
          <div class="stat"><div class="k">Lifetime</div><div class="v">${esc(money(s.total_amount, s.currency))}</div><div class="n">${s.donation_count} gift${s.donation_count === 1 ? '' : 's'}</div></div>
          <div class="stat"><div class="k">Average</div><div class="v">${esc(money(s.average_amount, s.currency))}</div><div class="n">largest ${esc(money(s.largest_donation && s.largest_donation.amount, s.currency))}</div></div>
          <div class="stat"><div class="k">This year</div><div class="v">${esc(money(s.ytd_amount, s.currency))}</div><div class="n">${s.campaigns_supported ? `${s.campaigns_supported.length} campaign(s)` : ''}</div></div>
          <div class="stat"><div class="k">Last gift</div><div class="v">${esc(s.last_donation ? day(s.last_donation.date) : '—')}</div><div class="n">first ${esc(s.first_donation ? day(s.first_donation.date) : '—')}</div></div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Contact preferences</h2><span class="faint">changes take effect on the next queued message</span></div>
          <div class="panel-body">
            <form id="prefs-form">
              <div class="form-grid">
                <label class="field checkline"><input type="checkbox" name="progress_updates_opt_in"${donor.preferences.progress_updates_opt_in ? ' checked' : ''}><span>Campaign progress updates</span></label>
                <label class="field checkline"><input type="checkbox" name="no_email"${donor.preferences.no_email ? ' checked' : ''}><span>Do not email at all</span></label>
                <label class="field checkline"><input type="checkbox" name="no_solicitation"${donor.preferences.no_solicitation ? ' checked' : ''}><span>Do not solicit</span></label>
              </div>
              <div class="form-actions">
                <button class="btn btn-primary" type="submit">Save preferences</button>
                <span class="faint">version ${esc(donor.version)} — saved with If-Match, so a stale form is rejected</span>
              </div>
            </form>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Donations</h2></div>
          <div class="panel-body tight">${table(
            [{ label: 'Date' }, { label: 'Amount', right: true }, { label: 'Method' }, { label: 'Status' }, { label: 'Reference' }], gifts,
          )}</div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Communications</h2><span class="faint">suppressed messages are recorded, not skipped</span></div>
          <div class="panel-body tight">${table(
            [{ label: 'When' }, { label: 'Message' }, { label: 'Status' }, { label: 'Why / error' }], timeline,
          )}</div>
        </div>`,
      onMount(root) {
        bind(root, 'tr[data-act=open-comm]', 'click', (e, tr) => go(`/communications/${tr.dataset.id}`));
        bind(root, '#prefs-form', 'submit', (e, form) => {
          e.preventDefault();
          const body = fields(form);
          submitting(form, () => api('PATCH', `/api/v1/donors/${id}`, {
            body, headers: { 'If-Match': `"${donor.version}"` },
          }), 'Preferences saved');
        });
      },
    };
  });

  // ------------------------------------------------------------------ donations

  const METHODS = ['CASH', 'CHECK', 'CREDIT_CARD', 'BANK_TRANSFER', 'IN_KIND', 'OTHER'];

  route(/^\/donations$/, async () => {
    const [donorsEnv, fundsEnv, campaignsEnv, donationsEnv, orgEnv] = await Promise.all([
      get('/api/v1/donors?limit=200'),
      get('/api/v1/funds?limit=200'),
      get('/api/v1/campaigns?limit=200'),
      get('/api/v1/donations?limit=200'),
      get('/api/v1/organization'),
    ]);
    const donors = rows(donorsEnv);
    const funds = rows(fundsEnv);
    const campaigns = rows(campaignsEnv);
    const donations = rows(donationsEnv);
    const currency = orgEnv.data.default_currency;

    const donorName = new Map(donors.map((d) => [d.id, d.display_name]));
    const campaignName = new Map(campaigns.map((c) => [c.id, c.code]));

    const allocationRow = () => `<div class="alloc-row" data-alloc>
      <label class="field"><span>Fund</span><select data-alloc-fund>${options(funds, '', (f) => f.id, (f) => `${f.code} · ${f.name}`)}</select></label>
      <label class="field"><span>Campaign</span><select data-alloc-campaign><option value="">— unallocated —</option>${options(campaigns, '', (c) => c.id, (c) => `${c.code} · ${c.name}`)}</select></label>
      <label class="field"><span>Amount</span><input data-alloc-amount inputmode="decimal" placeholder="0.00"></label>
      <button class="btn btn-sm" type="button" data-act="alloc-remove" title="Remove this line">×</button>
    </div>`;

    const list = donations.map((d) => `<tr>
      <td class="nowrap">${esc(day(d.donation_date))}</td>
      <td><a href="#/donors/${esc(d.donor_id)}">${esc(donorName.get(d.donor_id) || d.donor_id.slice(0, 8))}</a></td>
      <td class="right nowrap">${esc(money(d.amount, d.currency))}</td>
      <td>${esc(d.method)}</td>
      <td>${(d.campaign_ids || []).map((c) => `<span class="pill">${esc(campaignName.get(c) || c.slice(0, 6))}</span>`).join('') || '<span class="faint">—</span>'}</td>
      <td>${pill(d.status)}${d.reversal_reason ? `<div class="faint">${esc(d.reversal_reason)}</div>` : ''}</td>
      <td class="right">${d.status === 'POSTED'
        ? `<button class="btn btn-sm btn-danger" type="button" data-act="reverse" data-id="${esc(d.id)}">Reverse</button>`
        : ''}</td>
    </tr>`);

    return {
      title: 'Donations',
      subtitle: `${donations.length} recorded · every gift posts, receipts and notifies in one transaction`,
      html: `
        <div class="panel">
          <div class="panel-head"><h2>Record a donation</h2><span class="faint">sent with an Idempotency-Key, so a double click cannot double-charge</span></div>
          <div class="panel-body">
            ${donors.length && funds.length ? `<form id="donation-form">
              <div class="form-grid">
                <label class="field"><span>Donor</span><select name="donor_id" required>${options(donors, '', (d) => d.id, (d) => d.display_name)}</select></label>
                <label class="field"><span>Amount</span><input name="amount" id="donation-amount" inputmode="decimal" placeholder="0.00" required></label>
                <label class="field"><span>Currency</span><input name="currency" value="${esc(currency)}"></label>
                <label class="field"><span>Date</span><input name="donation_date" type="date" value="${esc(today())}" max="${esc(today())}"></label>
                <label class="field"><span>Method</span><select name="method">${options(METHODS, 'CHECK', (m) => m, (m) => m.replace(/_/g, ' '))}</select></label>
                <label class="field"><span>Reference</span><input name="reference" placeholder="cheque no., txn id"></label>
                <label class="field"><span>Value of goods received</span><input name="fair_market_value" inputmode="decimal" placeholder="0.00"></label>
                <label class="field"><span>Memo</span><input name="memo"></label>
              </div>

              <div style="margin-top:16px">
                <div class="panel-head" style="border:0;padding:0 0 8px">
                  <h2>Allocations</h2>
                  <button class="btn btn-sm" type="button" data-act="alloc-add">Add line</button>
                </div>
                <div id="allocations">${allocationRow()}</div>
                <div class="alloc-note" id="alloc-note"></div>
              </div>

              <div class="form-actions"><button class="btn btn-primary" type="submit">Record donation</button></div>
            </form>` : empty('Register a donor and create a fund first.')}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Donation register</h2></div>
          <div class="panel-body tight">${table(
            [{ label: 'Date' }, { label: 'Donor' }, { label: 'Amount', right: true }, { label: 'Method' },
              { label: 'Campaigns' }, { label: 'Status' }, { label: '', right: true }], list,
          )}</div>
        </div>`,
      onMount(root) {
        const form = root.querySelector('#donation-form');

        function recount() {
          if (!form) return;
          const total = toMinor(form.querySelector('#donation-amount').value || '0');
          const lines = Array.from(root.querySelectorAll('[data-alloc]'));
          const allocated = lines.reduce((sum, line) => sum + toMinor(line.querySelector('[data-alloc-amount]').value || '0'), 0);
          const note = root.querySelector('#alloc-note');
          const balanced = allocated === total;
          note.className = `alloc-note${balanced || total === 0 ? '' : ' bad'}`;
          if (total === 0) {
            note.textContent = 'Enter an amount above — the allocations must then sum to it exactly.';
          } else {
            note.textContent = balanced
              ? `Allocated ${money(fromMinor(allocated), '')} — balanced.`
              : `Allocated ${money(fromMinor(allocated), '')} of ${money(fromMinor(total), '')} — ${money(fromMinor(total - allocated), '')} unallocated. The API rejects anything that does not sum exactly.`;
          }
        }

        if (form) {
          bind(root, '[data-act=alloc-add]', 'click', () => {
            root.querySelector('#allocations').insertAdjacentHTML('beforeend', allocationRow());
            recount();
          });
          bind(root, '[data-act=alloc-remove]', 'click', (e, button) => {
            const lines = root.querySelectorAll('[data-alloc]');
            if (lines.length > 1) button.closest('[data-alloc]').remove();
            recount();
          });
          // With a single line the split is not a decision: mirror the donation amount.
          bind(root, '#donation-amount', 'input', () => {
            const lines = root.querySelectorAll('[data-alloc]');
            if (lines.length === 1) lines[0].querySelector('[data-alloc-amount]').value = form.querySelector('#donation-amount').value;
            recount();
          });
          bind(root, '[data-alloc-amount]', 'input', recount);
          recount();

          bind(root, '#donation-form', 'submit', (e) => {
            e.preventDefault();
            const body = fields(form);
            body.allocations = Array.from(root.querySelectorAll('[data-alloc]')).map((line) => ({
              fund_id: line.querySelector('[data-alloc-fund]').value,
              campaign_id: line.querySelector('[data-alloc-campaign]').value || null,
              amount: line.querySelector('[data-alloc-amount]').value.trim(),
            }));
            const key = uuid();
            submitting(form, async () => {
              const send = (path) => post(path, body, { 'Idempotency-Key': key });
              try {
                return await send('/api/v1/donations');
              } catch (error) {
                if (error.status === 409 && error.problem && error.problem.code === 'DUPLICATE_SUSPECTED'
                    && confirm('The same donor, amount and date is already recorded. Record it again anyway?')) {
                  return post('/api/v1/donations?allow_duplicate=true', body, { 'Idempotency-Key': uuid() });
                }
                throw error;
              }
            }, 'Donation recorded — receipt issued and email queued');
          });
        }

        bind(root, '[data-act=reverse]', 'click', (e, button) => {
          const reason = prompt('Why is this donation being reversed?', 'Cheque returned unpaid');
          if (reason === null) return;
          act(() => post(`/api/v1/donations/${button.dataset.id}/reverse`, { reason: reason || 'Correction' }),
            'Donation reversed', 'The receipt is voided and the donor is told.');
        });
      },
    };
  });

  // ------------------------------------------------------------------ campaigns

  route(/^\/campaigns$/, async () => {
    const [campaignsEnv, fundsEnv] = await Promise.all([
      get('/api/v1/campaigns?limit=200'),
      get('/api/v1/funds?limit=200'),
    ]);
    const campaigns = rows(campaignsEnv);
    const funds = rows(fundsEnv);
    const progress = await Promise.all(campaigns.map((c) => get(`/api/v1/campaigns/${c.id}/progress`).then((r) => r.data)));

    const cards = campaigns.map((campaign, i) => {
      const p = progress[i];
      return `<article class="panel campaign-card">
        <div class="head">
          <h3><a href="#/campaigns/${esc(campaign.id)}">${esc(campaign.name)}</a></h3>
          ${pill(campaign.status)}
        </div>
        <div class="faint mono">${esc(campaign.code)}${campaign.end_date ? ` · ends ${esc(campaign.end_date)}` : ''}</div>
        ${bar(p.percent)}
        <div class="figures"><span><b>${esc(money(p.raised, p.currency))}</b> of ${esc(money(p.goal, ''))}</span><span>${esc(String(p.percent))}%</span></div>
        <div class="figures faint"><span>${p.donor_count} donors</span><span>${(campaign.milestones_reached || []).length ? `milestones ${(campaign.milestones_reached || []).join(', ')}%` : 'no milestone yet'}</span></div>
      </article>`;
    }).join('');

    const fundRows = funds.map((f) => `<tr>
      <td class="mono">${esc(f.code)}</td><td>${esc(f.name)}</td>
      <td>${esc(f.restriction)}</td><td>${f.is_active ? pill('ACTIVE') : pill('inactive', 'bad')}</td>
    </tr>`);

    return {
      title: 'Campaigns',
      subtitle: `${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'} · ${funds.length} fund${funds.length === 1 ? '' : 's'}`,
      html: `
        ${campaigns.length ? `<div class="grid grid-3">${cards}</div>` : ''}

        <div class="grid grid-2">
          <div class="panel">
            <div class="panel-head"><h2>New campaign</h2></div>
            <div class="panel-body">
              <form id="campaign-form">
                <div class="form-grid">
                  <label class="field"><span>Code</span><input name="code" required placeholder="WELL26"></label>
                  <label class="field"><span>Name</span><input name="name" required placeholder="Twelve Wells"></label>
                  <label class="field"><span>Goal</span><input name="goal" inputmode="decimal" placeholder="50000.00"></label>
                  <label class="field"><span>Currency</span><input name="currency" value="USD"></label>
                  <label class="field"><span>Start date</span><input name="start_date" type="date"></label>
                  <label class="field"><span>End date</span><input name="end_date" type="date"></label>
                </div>
                <div class="form-actions"><button class="btn btn-primary" type="submit">Create campaign</button></div>
              </form>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h2>New fund</h2></div>
            <div class="panel-body">
              <form id="fund-form">
                <div class="form-grid">
                  <label class="field"><span>Code</span><input name="code" required placeholder="WATER"></label>
                  <label class="field"><span>Name</span><input name="name" required placeholder="Clean Water Fund"></label>
                  <label class="field"><span>Restriction</span>
                    <select name="restriction">${options(['UNRESTRICTED', 'TEMPORARILY_RESTRICTED', 'PERMANENTLY_RESTRICTED'], 'UNRESTRICTED', (r) => r, (r) => r.replace(/_/g, ' '))}</select>
                  </label>
                </div>
                <div class="form-actions"><button class="btn btn-primary" type="submit">Create fund</button></div>
              </form>
              <div style="margin-top:16px">${table(
                [{ label: 'Code' }, { label: 'Name' }, { label: 'Restriction' }, { label: 'Status' }], fundRows,
              )}</div>
            </div>
          </div>
        </div>`,
      onMount(root) {
        bind(root, '#campaign-form', 'submit', (e, form) => {
          e.preventDefault();
          submitting(form, () => post('/api/v1/campaigns', fields(form)), 'Campaign created');
        });
        bind(root, '#fund-form', 'submit', (e, form) => {
          e.preventDefault();
          submitting(form, () => post('/api/v1/funds', fields(form)), 'Fund created');
        });
      },
    };
  });

  route(/^\/campaigns\/([^/]+)$/, async (id) => {
    const [campaignEnv, progressEnv, donorsEnv] = await Promise.all([
      get(`/api/v1/campaigns/${id}`),
      get(`/api/v1/campaigns/${id}/progress`),
      get(`/api/v1/campaigns/${id}/donors`),
    ]);
    const campaign = campaignEnv.data;
    const p = progressEnv.data;

    const supporters = rows(donorsEnv).map((d) => `<tr class="clickable" data-act="open-donor" data-id="${esc(d.donor_id)}">
      <td><b>${esc(d.display_name)}</b></td>
      <td>${esc(d.email || '—')}</td>
      <td class="right nowrap">${esc(money(d.total_amount, d.currency))}</td>
      <td class="right">${d.donation_count}</td>
      <td>${d.receives_progress_updates ? pill('updates on', 'ok') : pill('updates off', 'warn')}</td>
    </tr>`);

    return {
      title: campaign.name,
      subtitle: `${campaign.code} · ${campaign.status}${campaign.end_date ? ` · ends ${campaign.end_date}` : ''}`,
      html: `
        <div><a class="back" href="#/campaigns">← All campaigns</a></div>

        <div class="panel">
          <div class="panel-head">
            <h2>Progress</h2>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm" type="button" data-act="send-update"${campaign.status === 'CLOSED' ? ' disabled' : ''}>Send progress update</button>
              <button class="btn btn-sm btn-danger" type="button" data-act="close-campaign"${campaign.status === 'CLOSED' ? ' disabled' : ''}>Close campaign</button>
            </div>
          </div>
          <div class="panel-body">
            ${bar(p.percent)}
            <div class="grid stats" style="margin-top:16px">
              <div class="stat"><div class="k">Raised</div><div class="v">${esc(money(p.raised, p.currency))}</div><div class="n">${esc(String(p.percent))}% of ${esc(money(p.goal, p.currency))}</div></div>
              <div class="stat"><div class="k">Remaining</div><div class="v">${esc(money(p.remaining, p.currency))}</div><div class="n">${p.goal_reached ? 'goal reached' : 'still to raise'}</div></div>
              <div class="stat"><div class="k">Donors</div><div class="v">${p.donor_count}</div><div class="n">${p.donation_count} gifts · avg ${esc(money(p.average_donation, ''))}</div></div>
              <div class="stat"><div class="k">Milestones</div><div class="v">${(campaign.milestones_reached || []).length ? `${(campaign.milestones_reached || []).join('% · ')}%` : '—'}</div><div class="n">${campaign.last_update_sent_at ? `last update ${day(campaign.last_update_sent_at)}` : 'no update sent yet'}</div></div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Supporters</h2><span class="faint">a progress update reaches only those with updates on</span></div>
          <div class="panel-body tight">${table(
            [{ label: 'Donor' }, { label: 'Email' }, { label: 'Given', right: true }, { label: 'Gifts', right: true }, { label: 'Progress updates' }], supporters,
          )}</div>
        </div>`,
      onMount(root) {
        bind(root, 'tr[data-act=open-donor]', 'click', (e, tr) => go(`/donors/${tr.dataset.id}`));
        bind(root, '[data-act=send-update]', 'click', () => {
          act(() => post(`/api/v1/campaigns/${id}/send-update`, {}),
            'Progress update queued', 'Run jobs to send it.');
        });
        bind(root, '[data-act=close-campaign]', 'click', () => {
          const reason = prompt('Closing note for the donors (optional):', '');
          if (reason === null) return;
          act(() => post(`/api/v1/campaigns/${id}/close`, { reason: reason || null }),
            'Campaign closed', 'A closing email is queued for every supporter.');
        });
      },
    };
  });

  // ------------------------------------------------------------------ communications

  const COMM_STATUSES = ['', 'QUEUED', 'SENT', 'SUPPRESSED', 'FAILED'];

  route(/^\/communications(?:\?.*)?$/, async () => {
    const filter = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || '';
    const [commsEnv, donorsEnv] = await Promise.all([
      get(`/api/v1/communications?limit=200${filter ? `&status=${encodeURIComponent(filter)}` : ''}`),
      get('/api/v1/donors?limit=200'),
    ]);
    const communications = rows(commsEnv);
    const donorName = new Map(rows(donorsEnv).map((d) => [d.id, d.display_name]));

    const list = communications.map((c) => `<tr class="clickable" data-act="open-comm" data-id="${esc(c.id)}">
      <td class="nowrap">${esc(stamp(c.sent_at || c.created_at))}</td>
      <td><a href="#/donors/${esc(c.donor_id)}">${esc(donorName.get(c.donor_id) || '—')}</a><div class="faint">${esc(c.to || 'no address')}</div></td>
      <td>${esc(c.subject || '—')}<div class="faint mono">${esc(c.template_key)}</div></td>
      <td>${pill(c.status)}${c.attempts > 1 ? ` <span class="faint">${c.attempts} attempts</span>` : ''}</td>
      <td class="muted">${esc(c.suppression_reason || c.last_error || '')}</td>
    </tr>`);

    return {
      title: 'Communications',
      subtitle: 'every message this system decided to send — including the ones it decided not to',
      html: `
        <div class="panel">
          <div class="panel-head">
            <h2>Message log</h2>
            <label class="field" style="flex-direction:row;align-items:center;gap:8px">
              <span>Status</span>
              <select id="comm-filter" style="width:auto">${options(COMM_STATUSES, filter, (s) => s, (s) => s || 'all')}</select>
            </label>
          </div>
          <div class="panel-body tight">${table(
            [{ label: 'When' }, { label: 'Donor' }, { label: 'Message' }, { label: 'Status' }, { label: 'Why / error' }], list,
          )}</div>
        </div>`,
      onMount(root) {
        bind(root, 'tr[data-act=open-comm]', 'click', (e, tr) => go(`/communications/${tr.dataset.id}`));
        bind(root, '#comm-filter', 'change', (e, select) => {
          go(select.value ? `/communications?status=${encodeURIComponent(select.value)}` : '/communications');
        });
      },
    };
  });

  route(/^\/communications\/([^/?]+)$/, async (id) => {
    const comm = (await get(`/api/v1/communications/${id}`)).data;

    return {
      title: comm.subject || comm.template_key,
      subtitle: `${comm.channel} · ${comm.template_key} · ${comm.status}`,
      html: `
        <div><a class="back" href="#/communications">← All communications</a></div>
        <div class="preview">
          <div class="panel">
            <div class="panel-head"><h2>Rendered message</h2><span class="faint">exactly what lands in the donor's inbox</span></div>
            <div class="panel-body">
              ${comm.html
                ? `<iframe sandbox="" title="email preview" srcdoc="${esc(comm.html)}"></iframe>`
                : `<pre class="mono" style="white-space:pre-wrap">${esc(comm.text || 'No body was rendered.')}</pre>`}
            </div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>Delivery</h2></div>
            <div class="panel-body">
              <dl class="meta">
                <dt>To</dt><dd>${esc(comm.to || '—')}</dd>
                <dt>Donor</dt><dd><a href="#/donors/${esc(comm.donor_id)}">open record</a></dd>
                <dt>Status</dt><dd>${pill(comm.status)}</dd>
                <dt>Kind</dt><dd>${esc(comm.kind || '—')}</dd>
                <dt>Trigger</dt><dd>${esc(comm.trigger || '—')}</dd>
                <dt>Attempts</dt><dd>${esc(comm.attempts)}</dd>
                <dt>Suppressed</dt><dd>${esc(comm.suppression_reason || 'no')}</dd>
                <dt>Last error</dt><dd>${esc(comm.last_error || '—')}</dd>
                <dt>Next attempt</dt><dd>${esc(comm.next_attempt_at ? stamp(comm.next_attempt_at) : '—')}</dd>
                <dt>Created</dt><dd>${esc(stamp(comm.created_at))}</dd>
                <dt>Sent</dt><dd>${esc(comm.sent_at ? stamp(comm.sent_at) : '—')}</dd>
                <dt>About</dt><dd>${comm.related ? `${esc(comm.related.type)} <span class="mono">${esc(comm.related.id.slice(0, 8))}</span>` : '—'}</dd>
              </dl>
              ${(comm.warnings || []).length ? `<div class="alloc-note bad" style="margin-top:12px">${comm.warnings.map(esc).join('<br>')}</div>` : ''}
            </div>
          </div>
        </div>`,
    };
  });

  // ------------------------------------------------------------------ activity

  route(/^\/activity$/, async () => {
    const [eventsEnv, auditEnv] = await Promise.all([
      get('/api/v1/events?limit=100'),
      get('/api/v1/audit-entries?limit=100'),
    ]);

    const events = rows(eventsEnv).map((e) => `<tr>
      <td class="nowrap">${esc(stamp(e.occurred_at))}</td>
      <td class="mono">${esc(e.event_type)}</td>
      <td>${e.published_at ? pill('published', 'ok') : pill('pending', 'warn')}</td>
      <td class="mono faint">${esc(JSON.stringify(e.data || {}).slice(0, 120))}</td>
    </tr>`);

    const entries = rows(auditEnv).map((a) => `<tr>
      <td class="nowrap">${esc(stamp(a.occurred_at))}</td>
      <td>${esc(a.actor)}</td>
      <td class="mono">${esc(a.entity_type)}</td>
      <td>${esc(a.operation)}</td>
      <td class="mono faint">${esc(Object.keys(a.changes || {}).join(', ') || '—')}</td>
    </tr>`);

    return {
      title: 'Activity',
      subtitle: 'the transactional outbox and the audit trail',
      html: `
        <div class="panel">
          <div class="panel-head"><h2>Domain events</h2><span class="faint">pending events are dispatched by “Run jobs”</span></div>
          <div class="panel-body tight">${table(
            [{ label: 'When' }, { label: 'Event' }, { label: 'State' }, { label: 'Data' }], events,
          )}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Audit trail</h2></div>
          <div class="panel-body tight">${table(
            [{ label: 'When' }, { label: 'Actor' }, { label: 'Entity' }, { label: 'Operation' }, { label: 'Changed' }], entries,
          )}</div>
        </div>`,
    };
  });


  // ------------------------------------------------------------------ charts
  //
  // Hand-drawn SVG, in keeping with the rest of demo1: no charting library, no CDN, no
  // build step. Marks follow one spec — thin bars capped at 24px with a 4px rounded data
  // end, hairline solid gridlines, values in ink rather than in the series colour — and
  // every chart ships a table twin, so nothing is readable only by hovering.

  /** Pixel geometry is the one place fractions are allowed; money above stays integral. */
  const scale = (value, max, length) => (max <= 0 ? 0 : (value / max) * length);

  /** A clean axis top: 1, 2, 5 or 10 times a power of ten, never a raw maximum. */
  function niceMax(value) {
    if (!(value > 0)) return 1;
    const magnitude = 10 ** (String(Math.trunc(value)).length - 1);
    for (const step of [1, 2, 5, 10]) if (step * magnitude >= value) return step * magnitude;
    return 10 * magnitude;
  }

  /** 1,284 · 12.9K · 4.2M — integer arithmetic only, from minor units. */
  function compactMajor(minor) {
    const major = Math.trunc(Math.abs(minor) / 100);
    const sign = minor < 0 ? '-' : '';
    if (major < 10000) return sign + String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (major < 1000000) {
      const tenths = Math.round(major / 100);
      return `${sign}${Math.trunc(tenths / 10)}.${tenths % 10}K`;
    }
    const tenths = Math.round(major / 100000);
    return `${sign}${Math.trunc(tenths / 10)}.${tenths % 10}M`;
  }

  const compactCount = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  /**
   * An axis picks ONE unit from its maximum and formats every tick in it - otherwise the
   * same axis reads "5,000" next to "10.0K" and the reader converts in their head.
   */
  function axisFormatter(maxMinor) {
    const maxMajor = Math.trunc(maxMinor / 100);
    const oneDecimal = (minor, unit) => {
      const tenths = Math.round((Math.trunc(minor / 100) * 10) / unit);
      return `${Math.trunc(tenths / 10)}.${tenths % 10}`;
    };
    if (maxMajor >= 1000000) return (minor) => (minor === 0 ? '0' : `${oneDecimal(minor, 1000000)}M`);
    if (maxMajor >= 10000) return (minor) => (minor === 0 ? '0' : `${oneDecimal(minor, 1000)}K`);
    return compactMajor;
  }

  /** Bars grow from the baseline: square where they meet it, 4px rounded at the data end. */
  function topRoundedBar(x, y, w, h, r = 4) {
    if (h <= 0.5) return '';
    const radius = Math.min(r, w / 2, h);
    return `M${x},${y + h}L${x},${y + radius}Q${x},${y} ${x + radius},${y}`
      + `L${x + w - radius},${y}Q${x + w},${y} ${x + w},${y + radius}L${x + w},${y + h}Z`;
  }

  function endRoundedBar(x, y, w, h, r = 4) {
    if (w <= 0.5) return '';
    const radius = Math.min(r, w, h / 2);
    return `M${x},${y}L${x + w - radius},${y}Q${x + w},${y} ${x + w},${y + radius}`
      + `L${x + w},${y + h - radius}Q${x + w},${y + h} ${x + w - radius},${y + h}L${x},${y + h}Z`;
  }

  /**
   * Columns over time. One series, so no legend box — the card title names it. Only the
   * largest column is direct-labelled; the axis and the tooltip carry the rest.
   */
  function columnChart(rows, width, { format = compactMajor, tickFactory = null, title = '' } = {}) {
    const height = 240;
    const pad = { top: 26, right: 10, bottom: 34, left: 54 };
    const plotW = Math.max(40, width - pad.left - pad.right);
    const plotH = height - pad.top - pad.bottom;
    const max = niceMax(Math.max(0, ...rows.map((r) => r.value)));
    // The tick unit follows the axis top, not the largest bar: an axis that tops out at
    // 10,000 must not label its midpoint "5,000" and its top "10.0K".
    const tickText = tickFactory ? tickFactory(max) : format;
    const band = plotW / Math.max(1, rows.length);
    const barW = Math.max(3, Math.min(24, band - 8));
    const baseline = pad.top + plotH;
    const yOf = (value) => baseline - scale(value, max, plotH);
    const peak = rows.reduce((best, r, i) => (r.value > rows[best].value ? i : best), 0);
    // With a crowded axis, label every nth column rather than overlapping the ticks.
    const every = Math.ceil(rows.length / Math.max(1, Math.floor(plotW / 54)));

    const gridlines = [0, max / 2, max].map((value) => {
      const y = Math.round(yOf(value)) + 0.5;
      const rule = value === 0 ? 'axis' : 'grid';
      return `<line class="${rule}" x1="${pad.left}" y1="${y}" x2="${pad.left + plotW}" y2="${y}"/>`
        + `<text class="tick" x="${pad.left - 8}" y="${y + 4}" text-anchor="end">${esc(tickText(value))}</text>`;
    }).join('');

    const marks = rows.map((row, i) => {
      const x = pad.left + i * band + (band - barW) / 2;
      const y = yOf(row.value);
      const label = i === peak && row.value > 0
        ? `<text class="val" x="${x + barW / 2}" y="${y - 7}" text-anchor="middle">${esc(format(row.value))}</text>`
        : '';
      return `<path class="mark" d="${topRoundedBar(x, y, barW, baseline - y)}"/>${label}`;
    }).join('');

    const axis = rows.map((row, i) => (i % every === 0
      ? `<text class="tick" x="${pad.left + i * band + band / 2}" y="${height - 12}" text-anchor="middle">${esc(row.label)}</text>`
      : '')).join('');

    // The hit target is the whole column band, full plot height — never the painted bar.
    const hits = rows.map((row, i) => `<rect class="hit" x="${pad.left + i * band}" y="${pad.top}"
      width="${band}" height="${plotH}" tabindex="0" role="button"
      data-value="${esc(row.tipValue)}" data-label="${esc(row.tipLabel)}"${row.tipNote ? ` data-note="${esc(row.tipNote)}"` : ''}/>`).join('');

    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
      ${gridlines}${marks}${axis}${hits}</svg>`;
  }

  /** Horizontal bars: category on the left, value at the tip in a reserved gutter. */
  function barChart(rows, width, { format = compactMajor, title = '' } = {}) {
    const rowH = 32;
    // The label gutter is measured from the longest label, not guessed: at a narrow width
    // a fixed guess puts "Bank transfer" underneath its own bar.
    const longest = rows.reduce((n, r) => Math.max(n, String(r.label).length), 0);
    const labelW = Math.max(80, Math.min(Math.round(width * 0.42), Math.round(longest * 7.1) + 14));
    const gutter = 76;
    const height = Math.max(rowH, rows.length * rowH) + 8;
    const plotW = Math.max(30, width - labelW - gutter);
    const max = niceMax(Math.max(0, ...rows.map((r) => r.value)));
    const barH = Math.min(24, rowH - 12);

    const marks = rows.map((row, i) => {
      const y = i * rowH + (rowH - barH) / 2;
      const w = scale(row.value, max, plotW);
      return `<text class="cat" x="0" y="${y + barH / 2 + 4}">${esc(row.label)}</text>`
        + `<path class="mark" d="${endRoundedBar(labelW, y, w, barH)}"/>`
        + `<text class="val" x="${labelW + w + 8}" y="${y + barH / 2 + 4}">${esc(format(row.value))}</text>`
        + `<rect class="hit" x="0" y="${i * rowH}" width="${width}" height="${rowH}" tabindex="0" role="button"
             data-value="${esc(row.tipValue)}" data-label="${esc(row.tipLabel)}"${row.tipNote ? ` data-note="${esc(row.tipNote)}"` : ''}/>`;
    }).join('');

    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">${marks}</svg>`;
  }

  /**
   * One stacked bar of message outcomes. These are states, not series, so they wear the
   * reserved status colours — and never carry meaning by colour alone: every segment is
   * named in the legend, and the table twin repeats the numbers.
   *
   * Segment order is deliberate: sent · queued · failed · suppressed keeps the two
   * closest status hues (warning and serious) from ever touching.
   */
  const OUTCOME_ORDER = ['SENT', 'QUEUED', 'FAILED', 'SUPPRESSED'];
  const OUTCOME_LABEL = { SENT: 'Sent', QUEUED: 'Queued', FAILED: 'Failed', SUPPRESSED: 'Suppressed' };

  function stackedStatusBar(segments, width, { title = '' } = {}) {
    const height = 56;
    const barH = 28;
    const gap = 2; // the surface gap does the separating — never a stroke
    const total = segments.reduce((sum, s) => sum + s.count, 0);
    if (total === 0) return '';
    const drawable = segments.filter((s) => s.count > 0);
    const span = width - gap * Math.max(0, drawable.length - 1);

    let x = 0;
    const parts = drawable.map((segment) => {
      const w = scale(segment.count, total, span);
      const text = `${OUTCOME_LABEL[segment.status]} ${segment.count}`;
      // Only label inside when it genuinely fits; otherwise the legend and tooltip carry it.
      const fits = w > text.length * 6.4 + 16;
      const piece = `<rect class="st-${segment.status}" x="${x}" y="0" width="${Math.max(0, w)}" height="${barH}" rx="3"/>`
        + (fits ? `<text class="val-in val-on-${esc(segment.status)}" x="${x + w / 2}" y="${barH / 2 + 4}" text-anchor="middle">${esc(text)}</text>` : '')
        + `<rect class="hit" x="${x}" y="0" width="${Math.max(0, w)}" height="${barH}" tabindex="0" role="button"
             data-value="${esc(String(segment.count))}" data-label="${esc(OUTCOME_LABEL[segment.status])}"
             data-note="${esc(`${percentOfTotal(segment.count, total)}% of ${total} messages`)}"/>`;
      x += w + gap;
      return piece;
    }).join('');

    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">${parts}</svg>`;
  }

  /** Integer percent for prose; never used to draw geometry. */
  const percentOfTotal = (part, total) => (total ? Math.round((part / total) * 100) : 0);


  /**
   * A donut — part-to-whole at a glance.
   *
   * A ring is only honest when the slices are few and clearly different sizes: judging
   * two similar arcs against each other is the one thing a pie is genuinely bad at. So
   * anything whose job is *comparison* stays a bar, and this form is reserved for "what
   * share of the whole" with at most five segments, the tail folded into "Other".
   *
   * Slices are separated by a real gap in the surface, never by a stroke, and every slice
   * is named and valued in the legend beside it — colour is never the only channel.
   */
  function donutChart(slices, width, { title = '', centre = '', centreNote = '' } = {}) {
    const height = 212;
    const cy = height / 2;
    const outer = Math.min(cy - 10, 94);
    const inner = Math.round(outer * 0.6);
    const mid = (outer + inner) / 2;
    const cx = Math.round(width / 2);

    const total = slices.reduce((sum, s) => sum + s.value, 0);
    if (total <= 0) return '';

    const point = (angle, radius) => [
      (cx + radius * Math.cos(angle)).toFixed(1),
      (cy + radius * Math.sin(angle)).toFixed(1),
    ];

    // 2px of arc, expressed as an angle — the surface gap, not a border.
    const gap = slices.length > 1 ? 2 / outer : 0;
    let cursor = -Math.PI / 2;

    const parts = slices.map((slice) => {
      const sweep = (slice.value / total) * Math.PI * 2;
      const inset = sweep > gap * 2 ? gap / 2 : 0;
      const a0 = cursor + inset;
      const a1 = cursor + sweep - inset;
      const middle = cursor + sweep / 2;
      cursor += sweep;
      if (a1 <= a0) return '';

      const [x1, y1] = point(a0, outer);
      const [x2, y2] = point(a1, outer);
      const [x3, y3] = point(a1, inner);
      const [x4, y4] = point(a0, inner);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M${x1},${y1}A${outer},${outer} 0 ${large} 1 ${x2},${y2}`
        + `L${x3},${y3}A${inner},${inner} 0 ${large} 0 ${x4},${y4}Z`;

      // Label inside the band only where the arc genuinely has room for it.
      const share = percentOfTotal(slice.value, total);
      const text = `${share}%`;
      const room = sweep * mid > text.length * 8 + 14 && outer - inner > 16;
      const [lx, ly] = point(middle, mid);
      const label = room
        ? `<text class="slice-label" x="${lx}" y="${Number(ly) + 4}" text-anchor="middle">${esc(text)}</text>`
        : '';

      return `<path class="slice ${esc(slice.slot)}" d="${d}" tabindex="0" role="button"
        data-value="${esc(slice.tipValue)}" data-label="${esc(slice.label)}"
        data-note="${esc(`${share}% of ${slice.tipTotal}`)}"/>${label}`;
    }).join('');

    const centreText = centre
      ? `<text class="donut-total" x="${cx}" y="${cy - 1}" text-anchor="middle">${esc(centre)}</text>`
        + (centreNote ? `<text class="donut-note" x="${cx}" y="${cy + 15}" text-anchor="middle">${esc(centreNote)}</text>` : '')
      : '';

    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
      ${parts}${centreText}</svg>`;
  }

  /** Slots are assigned in fixed order and follow the entity, never its rank on screen. */
  const CAT_SLOTS = ['cat-1', 'cat-2', 'cat-3', 'cat-4'];

  /**
   * At most four named slices plus "Other": past that, a ring stops being readable and
   * the honest move is to fold the tail rather than invent a fifth and sixth hue.
   */
  function foldTail(rows, limit = 4) {
    if (rows.length <= limit) return rows;
    const tail = rows.slice(limit);
    return [
      ...rows.slice(0, limit),
      {
        label: `Other (${tail.length})`,
        value: tail.reduce((sum, r) => sum + r.value, 0),
        other: true,
      },
    ];
  }

  /** Build the slices, the legend beside them, and the table twin from one list of rows. */
  function shareOf(rows, { currency, totalLabel }) {
    const slices = foldTail(rows).map((row, i) => ({
      ...row,
      slot: row.other ? 'cat-other' : CAT_SLOTS[i],
    }));
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    const withTips = slices.map((slice) => ({
      ...slice,
      tipValue: money(fromMinor(slice.value), currency),
      tipTotal: money(fromMinor(total), currency),
    }));

    const legend = `<div class="legend">${withTips.map((slice) => `<span class="item" tabindex="0"
        data-value="${esc(slice.tipValue)}" data-label="${esc(slice.label)}"
        data-note="${esc(`${percentOfTotal(slice.value, total)}% of ${slice.tipTotal}`)}">
        <span class="sw sw-${esc(slice.slot)}"></span>${esc(slice.label)}
        <b>${esc(money(fromMinor(slice.value), ''))}</b></span>`).join('')}</div>`;

    const table = dataTable(
      [{ label: totalLabel }, { label: 'Raised', right: true }, { label: 'Share', right: true }],
      withTips.map((slice) => `<tr><td>${esc(slice.label)}</td>
        <td class="right">${esc(money(fromMinor(slice.value), ''))}</td>
        <td class="right">${percentOfTotal(slice.value, total)}%</td></tr>`),
    );

    return { slices: withTips, total, legend, table };
  }

  /** Draw at the container's real width, and redraw when that width changes. */
  function mountChart(container, draw) {
    const plot = container.querySelector('.plot');
    let lastWidth = 0;
    const paint = () => {
      const width = Math.max(260, Math.round(container.clientWidth));
      if (width === lastWidth) return;
      lastWidth = width;
      plot.innerHTML = draw(width);
    };
    paint();
    if (window.ResizeObserver) new ResizeObserver(paint).observe(container);
  }

  /**
   * Hover and keyboard-focus readout. Labels come from the API, so they go in as text
   * nodes, never as markup. Values lead; the label follows.
   */
  function attachTips(container) {
    const tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.hidden = true;
    container.appendChild(tip);

    const show = (target) => {
      tip.textContent = '';
      const value = document.createElement('div');
      value.className = 'tip-v';
      value.textContent = target.dataset.value;
      const label = document.createElement('div');
      label.className = 'tip-l';
      label.textContent = target.dataset.label;
      tip.append(value, label);
      if (target.dataset.note) {
        const note = document.createElement('div');
        note.className = 'tip-l';
        note.textContent = target.dataset.note;
        tip.append(note);
      }
      tip.hidden = false;

      const box = container.getBoundingClientRect();
      const mark = target.getBoundingClientRect();
      const left = Math.max(4, Math.min(
        mark.left - box.left + mark.width / 2 - tip.offsetWidth / 2,
        box.width - tip.offsetWidth - 4,
      ));
      const above = mark.top - box.top - tip.offsetHeight - 10;
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(above < 0 ? mark.bottom - box.top + 10 : above)}px`;
    };

    const hide = () => { tip.hidden = true; };
    container.addEventListener('pointermove', (e) => {
      const target = e.target.closest('[data-value]');
      if (target) show(target); else hide();
    });
    container.addEventListener('pointerleave', hide);
    container.addEventListener('focusin', (e) => {
      const target = e.target.closest('[data-value]');
      if (target) show(target);
    });
    container.addEventListener('focusout', hide);
  }

  /** Every chart card: a title, a chart/table switch, the plot, and the table twin. */
  function chartCard(id, heading, note, tableHtml, { legend = '' } = {}) {
    return `<section class="panel" data-card="${esc(id)}">
      <div class="panel-head">
        <div><h2>${esc(heading)}</h2>${note ? `<div class="faint" style="font-size:12px;margin-top:2px">${esc(note)}</div>` : ''}</div>
        <button class="btn btn-sm" type="button" data-act="toggle-table" data-target="${esc(id)}" aria-pressed="false">Table</button>
      </div>
      <div class="panel-body">
        <div class="chart" data-chart="${esc(id)}"><div class="plot"></div>${legend}</div>
        <div class="table-wrap" data-table="${esc(id)}" hidden>${tableHtml}</div>
      </div>
    </section>`;
  }

  /** The chart/table switch, shared by every view that renders a chart card. */
  function bindTableToggles(root) {
    bind(root, '[data-act=toggle-table]', 'click', (e, button) => {
      const id = button.dataset.target;
      const chart = root.querySelector(`[data-chart="${id}"]`);
      const twin = root.querySelector(`[data-table="${id}"]`);
      const showTable = twin.hidden;
      twin.hidden = !showTable;
      chart.hidden = showTable;
      button.setAttribute('aria-pressed', String(showTable));
      button.textContent = showTable ? 'Chart' : 'Table';
    });
  }

  const dataTable = (columns, rows) => `<table class="viz">
    <thead><tr>${columns.map((c) => `<th${c.right ? ' class="right"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;

  // ------------------------------------------------------------------ stats

  const RANGES = [
    { key: '30d', label: '30 days' },
    { key: '90d', label: '90 days' },
    { key: '12m', label: '12 months' },
    { key: 'all', label: 'All time' },
  ];

  /** The range presets, resolved to the `from` date the API understands. */
  function rangeFrom(key) {
    if (key === 'all') return null;
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (key === '30d') day.setUTCDate(day.getUTCDate() - 29);
    else if (key === '90d') day.setUTCDate(day.getUTCDate() - 89);
    else day.setUTCMonth(day.getUTCMonth() - 11, 1);
    return day.toISOString().slice(0, 10);
  }

  /** BANK_TRANSFER -> 'Bank transfer': easier to read, and narrower in the label gutter. */
  const methodLabel = (method) => {
    const words = String(method).replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  };

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (month) => {
    const [year, index] = month.split('-');
    return `${MONTH_NAMES[Number(index) - 1]}${index === '01' ? ` ’${year.slice(2)}` : ''}`;
  };

  route(/^\/stats(?:\?.*)?$/, async () => {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const range = RANGES.some((r) => r.key === params.get('range')) ? params.get('range') : '12m';
    const from = rangeFrom(range);

    const stats = (await get(`/api/v1/stats${from ? `?from=${encodeURIComponent(from)}` : ''}`)).data;
    const currency = stats.currency;
    const rangeLabel = (RANGES.find((r) => r.key === range) || {}).label;

    // --- to date: the hero, the supporting figures, and progress against each goal
    const meters = stats.campaigns.map((campaign) => {
      const p = campaign.progress;
      return `<div class="meter-row">
        <div class="name"><a href="#/campaigns/${esc(campaign.id)}">${esc(campaign.name)}</a>
          <div class="faint mono" style="font-size:11px">${esc(campaign.code)}</div></div>
        ${bar(p.percent)}
        <div class="figures"><b>${esc(money(p.raised, currency))}</b><br>${esc(String(p.percent))}% of ${esc(money(p.goal, ''))}</div>
      </div>`;
    }).join('');

    // --- in the selected period
    const monthRows = stats.by_month.map((m) => ({
      label: monthLabel(m.month),
      value: toMinor(m.amount),
      tipValue: money(m.amount, currency),
      tipLabel: monthLabel(m.month),
      tipNote: `${m.count} gift${m.count === 1 ? '' : 's'} · ${money(m.cumulative, currency)} cumulative`,
    }));

    const sizeRows = stats.size_distribution.map((b) => ({
      label: b.label,
      value: b.count,
      tipValue: `${b.count} gift${b.count === 1 ? '' : 's'}`,
      tipLabel: `${b.label} ${currency}`,
      tipNote: `${money(b.amount, currency)} in total`,
    }));

    const methodRows = stats.by_method.map((m) => ({
      label: methodLabel(m.method),
      value: toMinor(m.amount),
      tipValue: money(m.amount, currency),
      tipLabel: methodLabel(m.method),
      tipNote: `${m.count} gift${m.count === 1 ? '' : 's'}`,
    }));

    const outcomes = OUTCOME_ORDER
      .map((status) => (stats.email.outcomes.find((o) => o.status === status) || { status, count: 0 }));
    const emailTotal = outcomes.reduce((sum, o) => sum + o.count, 0);

    const legend = `<div class="legend">${outcomes.map((o) => `<span class="item">
        <span class="sw sw-${esc(o.status)}"></span>${esc(OUTCOME_LABEL[o.status])} <b>${o.count}</b></span>`).join('')}</div>`;

    const suppression = stats.email.suppression_reasons.length
      ? `<div class="faint" style="margin-top:10px;font-size:12px">Suppressed because: ${
        stats.email.suppression_reasons.map((r) => `${esc(r.reason.toLowerCase().replace(/_/g, ' '))} (${r.count})`).join(' · ')}</div>`
      : '';

    const topDonorRows = stats.top_donors.map((d) => `<tr>
      <td><a href="#/donors/${esc(d.donor_id)}">${esc(d.display_name || d.donor_id.slice(0, 8))}</a></td>
      <td class="right nowrap">${esc(money(d.amount, currency))}</td>
      <td class="right">${d.count}</td>
    </tr>`);

    const noData = stats.period.gift_count === 0;

    return {
      title: 'Stats',
      subtitle: `${money(stats.lifetime.raised, currency)} raised to date · charts below cover the last ${rangeLabel.toLowerCase()}`,
      html: `
        <div class="grid grid-2">
          <div class="panel"><div class="panel-body">
            <div class="hero">
              <span class="k">Raised to date</span>
              <span class="v">${esc(money(stats.lifetime.raised, currency))}</span>
              <span class="n">${stats.lifetime.gift_count} gift${stats.lifetime.gift_count === 1 ? '' : 's'} from
                ${stats.lifetime.donor_count} donor${stats.lifetime.donor_count === 1 ? '' : 's'}</span>
            </div>
          </div></div>
          <div class="grid stats" style="align-content:start">
            <div class="stat"><div class="k">Average gift</div><div class="v">${esc(money(stats.lifetime.average_gift, ''))}</div><div class="n">${esc(currency)}</div></div>
            <div class="stat"><div class="k">Largest gift</div><div class="v">${esc(money(stats.lifetime.largest_gift, ''))}</div><div class="n">${esc(currency)}</div></div>
          </div>
        </div>

        <section class="panel">
          <div class="panel-head"><h2>Progress to goal</h2><span class="faint">to date, not scoped by the range below</span></div>
          <div class="panel-body">${stats.campaigns.length ? meters : empty('No campaigns yet.')}</div>
        </section>

        <div class="filter-row">
          <span class="lbl">Range</span>
          <div class="range" role="group" aria-label="Date range">
            ${RANGES.map((r) => `<button type="button" data-act="range" data-range="${r.key}" aria-pressed="${r.key === range}">${esc(r.label)}</button>`).join('')}
          </div>
          <span class="faint">${esc(money(stats.period.raised, currency))} from ${stats.period.gift_count} gift${stats.period.gift_count === 1 ? '' : 's'}
            · ${stats.period.donor_count} donor${stats.period.donor_count === 1 ? '' : 's'} · ${stats.period.new_donors} newly registered</span>
        </div>

        ${noData ? `<div class="panel"><div class="chart-empty">No gifts in the last ${esc(rangeLabel.toLowerCase())}. Try a wider range.</div></div>` : `
        ${chartCard('months', 'Raised by month', `${currency}, gifts that count towards a campaign's progress`,
          dataTable([{ label: 'Month' }, { label: 'Raised', right: true }, { label: 'Gifts', right: true }, { label: 'Cumulative', right: true }],
            stats.by_month.map((m) => `<tr><td>${esc(monthLabel(m.month))}</td><td class="right">${esc(money(m.amount, ''))}</td>
              <td class="right">${m.count}</td><td class="right">${esc(money(m.cumulative, ''))}</td></tr>`)))}

        <div class="grid grid-2">
          ${chartCard('sizes', 'Gifts by size', `how many gifts fell in each band, ${currency}`,
            dataTable([{ label: 'Band' }, { label: 'Gifts', right: true }, { label: 'Total', right: true }],
              stats.size_distribution.map((b) => `<tr><td>${esc(b.label)}</td><td class="right">${b.count}</td>
                <td class="right">${esc(money(b.amount, ''))}</td></tr>`)))}

          ${chartCard('methods', 'How gifts arrive', `${currency} by payment method`,
            dataTable([{ label: 'Method' }, { label: 'Raised', right: true }, { label: 'Gifts', right: true }],
              stats.by_method.map((m) => `<tr><td>${esc(methodLabel(m.method))}</td>
                <td class="right">${esc(money(m.amount, ''))}</td><td class="right">${m.count}</td></tr>`)))}
        </div>

        ${emailTotal ? chartCard('email', 'What happened to the mail',
          `${emailTotal} message${emailTotal === 1 ? '' : 's'} — suppressed messages are recorded, not skipped`,
          dataTable([{ label: 'Outcome' }, { label: 'Messages', right: true }, { label: 'Share', right: true }],
            outcomes.map((o) => `<tr><td>${esc(OUTCOME_LABEL[o.status])}</td><td class="right">${o.count}</td>
              <td class="right">${percentOfTotal(o.count, emailTotal)}%</td></tr>`)),
          { legend: legend + suppression }) : ''}

        <section class="panel">
          <div class="panel-head"><h2>Who gave the most</h2><span class="faint">in the selected range</span></div>
          <div class="panel-body tight">${table(
            [{ label: 'Donor' }, { label: 'Given', right: true }, { label: 'Gifts', right: true }], topDonorRows,
          )}</div>
        </section>`}`,
      onMount(root) {
        bind(root, '[data-act=range]', 'click', (e, button) => {
          // Refetch keeps the frame: dim what is there rather than flashing a skeleton.
          root.style.opacity = '0.55';
          go(`/stats?range=${button.dataset.range}`);
        });

        bindTableToggles(root);

        if (noData) return;

        const charts = [
          ['months', (width) => columnChart(monthRows, width, {
            tickFactory: axisFormatter,
            title: 'Raised by month',
          })],
          ['sizes', (width) => barChart(sizeRows, width, { format: compactCount, title: 'Gifts by size band' })],
          ['methods', (width) => barChart(methodRows, width, { title: 'Raised by payment method' })],
          ['email', (width) => stackedStatusBar(outcomes, width, { title: 'Message outcomes' })],
        ];
        for (const [id, draw] of charts) {
          const container = root.querySelector(`[data-chart="${id}"]`);
          if (!container) continue;
          mountChart(container, draw);
          attachTips(container);
        }
      },
    };
  });

  // ------------------------------------------------------------------ boot

  const keyInput = $('#api-key');
  keyInput.value = apiKey;
  keyInput.addEventListener('change', () => {
    apiKey = keyInput.value.trim();
    localStorage.setItem(KEY_STORAGE, apiKey);
    render();
  });

  $('#run-jobs').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const run = (await post('/api/v1/jobs/run', { include_digests: false })).data;
      const { outbox, mail } = run.counts;
      toast('Jobs run', `${outbox.dispatched} event(s) dispatched, ${outbox.queued} message(s) queued, `
        + `${outbox.suppressed} suppressed · ${mail.sent} email sent, ${mail.retried} retried, ${mail.failed} failed`, 'ok');
      await render();
    } catch (error) {
      failed('The job run failed', error);
    } finally {
      button.disabled = false;
    }
  });

  $('#refresh').addEventListener('click', () => render());
  window.addEventListener('hashchange', render);

  render();
})();
