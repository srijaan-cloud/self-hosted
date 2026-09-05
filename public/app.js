document.getElementById('year').textContent = new Date().getFullYear();

// ---------- Gallery + Carousel ----------

async function loadGallery() {
  try {
    const res = await fetch('/api/gallery');
    const { photos } = await res.json();
    renderCarousel(photos);
    renderGalleryGrid(photos);
  } catch (err) {
    console.error('Failed to load gallery', err);
  }
}

function renderCarousel(photos) {
  const el = document.getElementById('carousel');
  if (!photos.length) return; // keep the "Photos coming soon" placeholder
  el.innerHTML =
    photos.map((p, i) => `<img src="${p.url}" alt="${p.caption || 'Shriya Function Hall'}" class="${i === 0 ? 'active' : ''}" data-i="${i}">`).join('') +
    `<div class="caption" id="carouselCaption">${photos[0].caption || ''}</div>` +
    (photos.length > 1
      ? `<button class="nav-btn prev" type="button" aria-label="Previous">&lsaquo;</button>
         <button class="nav-btn next" type="button" aria-label="Next">&rsaquo;</button>
         <div class="dots">${photos.map((_, i) => `<span data-i="${i}" class="${i === 0 ? 'active' : ''}"></span>`).join('')}</div>`
      : '');

  let current = 0;
  const imgs = el.querySelectorAll('img');
  const dots = el.querySelectorAll('.dots span');
  const captionEl = document.getElementById('carouselCaption');

  function show(i) {
    current = (i + photos.length) % photos.length;
    imgs.forEach((img, idx) => img.classList.toggle('active', idx === current));
    dots.forEach((dot, idx) => dot.classList.toggle('active', idx === current));
    if (captionEl) captionEl.textContent = photos[current].caption || '';
  }

  el.querySelector('.prev')?.addEventListener('click', () => show(current - 1));
  el.querySelector('.next')?.addEventListener('click', () => show(current + 1));
  dots.forEach((dot) => dot.addEventListener('click', () => show(Number(dot.dataset.i))));

  if (photos.length > 1) {
    setInterval(() => show(current + 1), 5000);
  }
}

function renderGalleryGrid(photos) {
  const el = document.getElementById('galleryGrid');
  if (!photos.length) return; // keep placeholder text
  el.innerHTML = photos.map((p) => `<img src="${p.url}" alt="${p.caption || 'Shriya Function Hall event'}" loading="lazy">`).join('');
}

loadGallery();
