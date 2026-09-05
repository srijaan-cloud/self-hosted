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
