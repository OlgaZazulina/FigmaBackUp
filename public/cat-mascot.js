(function () {
  const BUBBLE_IDLE = 'Без бэкапа как без корма';
  const BUBBLE_RUNNING = 'На вайбе, катим бэкап в облачный лоток';
  const ANIMATION_PATH = '/Cat_playing_animation_modified.json';

  let animation = null;
  let isRunning = false;

  function hideCat() {
    const root = document.getElementById('backup-cat');
    if (root) root.classList.add('hidden');
  }

  function updateBubbleText() {
    const bubble = document.querySelector('.backup-cat-bubble');
    if (!bubble) return;
    bubble.textContent = isRunning ? BUBBLE_RUNNING : BUBBLE_IDLE;
  }

  function setIdleFrame() {
    if (!animation) return;
    animation.loop = false;
    animation.stop();
    animation.goToAndStop(0, true);
  }

  function setRunningAnimation() {
    if (!animation) return;
    animation.loop = true;
    animation.play();
  }

  function initCatMascot() {
    const container = document.getElementById('backup-cat-lottie');
    const root = document.getElementById('backup-cat');
    if (!container || !root) return;

    if (typeof lottie === 'undefined') {
      console.warn('[cat-mascot] lottie-web not loaded');
      hideCat();
      return;
    }

    animation = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path: ANIMATION_PATH,
    });

    animation.addEventListener('DOMLoaded', () => {
      if (isRunning) {
        setRunningAnimation();
      } else {
        setIdleFrame();
      }
      root.removeAttribute('aria-hidden');
    });

    animation.addEventListener('data_failed', () => {
      console.warn('[cat-mascot] failed to load animation JSON');
      hideCat();
    });

    updateBubbleText();
  }

  function syncCatMascot(running) {
    isRunning = Boolean(running);
    updateBubbleText();
    if (!animation) return;
    if (isRunning) {
      setRunningAnimation();
    } else {
      setIdleFrame();
    }
  }

  window.initCatMascot = initCatMascot;
  window.syncCatMascot = syncCatMascot;
})();
