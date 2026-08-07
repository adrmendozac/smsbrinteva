// Progressive enhancement for the closing sequence of a hosted itinerary page
// (lib/hosted.js renderHostedPage): the contact card, its buttons, and
// the site footer right after it. Every element here is fully visible and
// usable from CSS alone — this only adds a reveal-on-scroll and tactile
// hover/press feedback via the vendored GSAP core (gsap.min.js, loaded just
// before this file). If GSAP fails to load for any reason, this bails
// immediately and the page stays exactly as CSS already rendered it —
// nothing here is required for the page to work. The masthead stays still;
// only the itinerary content receives a restrained one-time reveal.
(function () {
  if (!window.gsap) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var text = document.querySelector('.text');

  if (text && !reduceMotion) {
    gsap.from(text, {
      opacity: 0,
      y: 30,
      duration: 1,
      ease: 'power2.out',
      clearProps: 'transform,opacity',
    });
  }

  function revealOnScroll(el, distance, duration) {
    if (!el || reduceMotion) return;
    var play = function () {
      gsap.fromTo(
        el,
        { opacity: 0, y: distance },
        { opacity: 1, y: 0, duration: duration, ease: 'power3.out' }
      );
    };
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            play();
            obs.disconnect();
          }
        });
      }, { threshold: 0.25 });
      observer.observe(el);
    } else {
      play();
    }
  }

  revealOnScroll(document.querySelector('.contact'), 28, 0.9);
  revealOnScroll(document.querySelector('.site-footer'), 16, 0.7);

  var detailsToggle = document.querySelector('[data-toggle-details]');
  var dayDetails = Array.prototype.slice.call(document.querySelectorAll('.day-details'));

  function updateDetailsToggle() {
    var allOpen = dayDetails.every(function (detail) {
      return detail.open;
    });
    detailsToggle.textContent = allOpen
      ? detailsToggle.dataset.collapseLabel
      : detailsToggle.dataset.expandLabel;
    detailsToggle.setAttribute('aria-expanded', String(allOpen));
  }

  if (detailsToggle && dayDetails.length) {
    detailsToggle.addEventListener('click', function () {
      var shouldOpen = !dayDetails.every(function (detail) {
        return detail.open;
      });
      dayDetails.forEach(function (detail) {
        detail.open = shouldOpen;
      });
      updateDetailsToggle();
    });
    dayDetails.forEach(function (detail) {
      detail.addEventListener('toggle', updateDetailsToggle);
    });
  }

  var printButton = document.querySelector('[data-print-itinerary]');
  if (printButton) {
    printButton.addEventListener('click', function () {
      window.print();
    });
  }

  document.querySelectorAll('[data-share-itinerary]').forEach(function (shareButton) {
    var shareLabel = shareButton.querySelector('[data-share-label]');
    var originalLabel = shareLabel ? shareLabel.textContent : '';
    shareButton.addEventListener('click', async function () {
      var title = document.querySelector('h1').textContent;
      var data = { title: title, text: 'Itinerario de ' + title, url: window.location.href };
      try {
        // Safari on iOS supports this API and opens the native system share sheet.
        if (navigator.share) {
          await navigator.share(data);
          return;
        }
        await navigator.clipboard.writeText(data.url);
        if (shareLabel) shareLabel.textContent = 'Enlace copiado';
        window.setTimeout(function () {
          if (shareLabel) shareLabel.textContent = originalLabel;
        }, 2000);
      } catch (error) {
        if (error.name !== 'AbortError') window.prompt('Copie este enlace:', data.url);
      }
    });
  });

  document.querySelectorAll('.contact-button').forEach(function (button) {
    var icon = button.querySelector('.contact-icon');
    var liftY = gsap.quickTo(button, 'y', { duration: 0.2, ease: 'power2.out' });
    var iconScale = icon ? gsap.quickTo(icon, 'scale', { duration: 0.25, ease: 'back.out(2)' }) : null;

    button.addEventListener('pointerenter', function () {
      liftY(-3);
      if (iconScale) iconScale(1.08);
    });
    button.addEventListener('pointerleave', function () {
      liftY(0);
      if (iconScale) iconScale(1);
    });
    button.addEventListener('pointerdown', function () {
      gsap.to(button, { scale: 0.97, duration: 0.12, ease: 'power2.out' });
    });
    button.addEventListener('pointerup', function () {
      gsap.to(button, { scale: 1, duration: 0.2, ease: 'back.out(3)' });
    });
  });
})();
