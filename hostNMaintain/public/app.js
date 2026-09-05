// ---------- Twinkling starfield ----------
(function starfield() {
  const canvas = document.getElementById('magic-canvas');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stars = [];
  let width, height;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    const count = Math.round((width * height) / 9000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.3 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.015 + 0.005,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      const twinkle = reduceMotion ? 0.6 : 0.4 + 0.6 * Math.abs(Math.sin(s.phase + t * s.speed));
      ctx.globalAlpha = twinkle * 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!reduceMotion) requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();

// ---------- Site content (admin-editable copy) ----------
// The HTML already contains the same copy as DEFAULT_SITE_CONTENT on the
// server, so this only overwrites anything an admin has actually changed via
// /admin.html — if the fetch fails, the static defaults already in the page
// just stay put.
(function siteContent() {
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s ?? '';
    return div.innerHTML;
  }

  // Splits on `sep` at most `parts - 1` times, so if a field's own text
  // happens to contain the delimiter, it stays intact in the last field
  // instead of silently shifting every field after it.
  function splitFields(line, sep, parts) {
    const out = [];
    let rest = line;
    for (let i = 1; i < parts; i++) {
      const idx = rest.indexOf(sep);
      if (idx === -1) break;
      out.push(rest.slice(0, idx).trim());
      rest = rest.slice(idx + sep.length);
    }
    out.push(rest.trim());
    return out;
  }

  function parseLines(text, sep, parts) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (sep ? splitFields(l, sep, parts) : l));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el && value != null) el.textContent = value;
  }

  function renderTrustPills(text) {
    const el = document.getElementById('trust-row');
    if (!el) return;
    el.innerHTML = parseLines(text)
      .map((line) => `<span class="trust-pill">${escapeHtml(line)}</span>`)
      .join('');
  }

  function renderWhatCards(text) {
    const el = document.getElementById('what-cards');
    if (!el) return;
    el.innerHTML = parseLines(text, ' :: ', 3)
      .map(
        ([icon, title, desc]) => `
        <div class="magic-card">
          <div class="card-icon">${escapeHtml(icon)}</div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(desc)}</p>
        </div>`
      )
      .join('');
  }

  function renderProcessSteps(text) {
    const el = document.getElementById('process-grid');
    if (!el) return;
    el.innerHTML = parseLines(text, ' :: ', 2)
      .map(
        ([title, desc], i) => `
        <div class="process-card">
          <div class="process-number">${String(i + 1).padStart(2, '0')}</div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(desc)}</p>
        </div>`
      )
      .join('');
  }

  function renderFeatures(text) {
    const el = document.getElementById('feature-grid');
    if (!el) return;
    el.innerHTML = parseLines(text, ' :: ', 3)
      .map(
        ([icon, title, desc]) => `
        <div class="feature-item">
          <span class="feature-icon">${escapeHtml(icon)}</span>
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(desc)}</p>
          </div>
        </div>`
      )
      .join('');
  }

  function renderClients(text) {
    const el = document.getElementById('clients-dynamic');
    if (!el) return;
    el.innerHTML = parseLines(text, ' :: ', 4)
      .map(([name, desc, url, imageUrl]) => {
        const displayUrl = String(url || '').replace(/^https?:\/\//, '');
        // A client with a photo URL gets that; Tapasya (no photo set) keeps
        // its hand-drawn construction icon as a special case; anything else
        // falls back to a plain initials badge.
        const visual = imageUrl
          ? `<div class="client-visual client-visual-photo" aria-hidden="true"><img src="${escapeHtml(imageUrl)}" alt="" /></div>`
          : name.trim() === 'Tapasya Constructions'
          ? `<div class="client-visual client-visual-construction" aria-hidden="true">
                <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="10" y="30" width="14" height="40" fill="currentColor" opacity="0.85"/>
                  <rect x="30" y="18" width="14" height="52" fill="currentColor" opacity="0.7"/>
                  <rect x="50" y="8" width="14" height="62" fill="currentColor" opacity="0.9"/>
                  <rect x="70" y="24" width="14" height="46" fill="currentColor" opacity="0.6"/>
                  <path d="M64 8 L100 8 M100 8 L100 30 M100 8 L88 20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
                </svg>
              </div>`
            : `<div class="client-visual client-visual-generic" aria-hidden="true">${escapeHtml(
                name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '✨'
              )}</div>`;
        return `
        <a class="client-card" href="${escapeHtml(url)}" target="_blank" rel="noopener">
          ${visual}
          <div class="client-body">
            <div class="client-name">${escapeHtml(name)} <span class="client-link-arrow">↗</span></div>
            <p class="client-desc">${escapeHtml(desc)}</p>
            <span class="client-url">${escapeHtml(displayUrl)}</span>
          </div>
        </a>`;
      })
      .join('');
  }

  fetch('/api/site-content')
    .then((r) => r.json())
    .then((content) => {
      setText('hero-eyebrow', content.eyebrow);
      setText('hero-headline-main', content.headline_main);
      setText('hero-headline-accent', content.headline_accent);
      setText('hero-sub', content.hero_sub);
      renderTrustPills(content.trust_pills);
      setText('what-heading', content.what_heading);
      renderWhatCards(content.what_cards);
      setText('process-heading', content.process_heading);
      renderProcessSteps(content.process_steps);
      setText('features-heading', content.features_heading);
      renderFeatures(content.features);
      setText('clients-heading', content.clients_heading);
      setText('clients-sub', content.clients_sub);
      renderClients(content.clients);
      setText('contact-heading', content.contact_heading);
      setText('contact-sub', content.contact_sub);
      setText('footer-text', content.footer_text);
      return content.google_login_enabled;
    })
    .catch(() => false)
    .then((googleLoginEnabled) => {
      const loginLink = document.getElementById('header-login-link');
      const identity = document.getElementById('header-identity');
      if (!loginLink || !identity) return;

      fetch('/api/auth/me')
        .then((r) => r.json())
        .then((me) => {
          if (me.loggedIn) {
            loginLink.hidden = true;
            identity.hidden = false;
            document.getElementById('header-identity-name').textContent = me.name;
          } else {
            identity.hidden = true;
            loginLink.hidden = !googleLoginEnabled;
          }
        })
        .catch(() => {
          loginLink.hidden = !googleLoginEnabled;
        });
    });
})();

// ---------- Reveal-on-scroll ----------
(function revealOnScroll() {
  const targets = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 }
  );
  targets.forEach((el) => observer.observe(el));
})();

// ---------- Contact form ----------
(function contactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return; // this script also runs on pages with no contact form (e.g. login.html)
  const status = document.getElementById('cf-status');
  const submitBtn = document.getElementById('cf-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());

    if (!data.name?.trim() || !data.email?.trim() || !data.message?.trim()) {
      status.textContent = 'Please fill in your name, email, and a short message.';
      status.className = 'form-status err';
      return;
    }

    submitBtn.disabled = true;
    status.textContent = 'Sending…';
    status.className = 'form-status';

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('request_failed');

      form.reset();
      status.textContent = '✨ Got it — thank you! We’ll be in touch within a day or two.';
      status.className = 'form-status ok';
    } catch {
      status.textContent = 'Something went wrong sending that — please try again in a moment.';
      status.className = 'form-status err';
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
