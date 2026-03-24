const _confettiFired = new Set();

export function launchConfetti(unitId) {
  if (_confettiFired.has(unitId)) return;
  _confettiFired.add(unitId);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2'];
  const pieces = Array.from({ length: 90 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height * 0.5,
    w: Math.random() * 9 + 4,
    h: Math.random() * 4 + 2,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.18,
    vx: (Math.random() - 0.5) * 2.5,
    vy: Math.random() * 2.5 + 1.5,
    opacity: 1,
  }));

  const duration = 3800;
  let startTime = null;

  function draw(ts) {
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const piece of pieces) {
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.rotation += piece.rotationSpeed;
      piece.vy += 0.04;
      if (elapsed > duration * 0.55) piece.opacity = Math.max(0, piece.opacity - 0.018);
      if (piece.y < canvas.height && piece.opacity > 0) alive = true;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rotation);
      ctx.globalAlpha = piece.opacity;
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(draw);
    else canvas.remove();
  }

  requestAnimationFrame(draw);
}
