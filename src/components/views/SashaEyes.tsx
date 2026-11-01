import React, { useEffect, useState, useRef } from 'react';

export const SashaEyes: React.FC = () => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);
  const eyeRef = useRef<HTMLDivElement>(null);

  // 1. Kedip Alami (Natural Blinking) dengan interval acak 3.5s - 5.5s & durasi ~140ms
  useEffect(() => {
    let blinkTimer: NodeJS.Timeout;
    let resetTimer: NodeJS.Timeout;

    const scheduleNextBlink = () => {
      const delay = 3500 + Math.random() * 2000;
      blinkTimer = setTimeout(() => {
        setIsBlinking(true);
        resetTimer = setTimeout(() => {
          setIsBlinking(false);
          scheduleNextBlink();
        }, 140);
      }, delay);
    };

    scheduleNextBlink();
    return () => {
      clearTimeout(blinkTimer);
      clearTimeout(resetTimer);
    };
  }, []);

  // 2. Lirikan Kursor Halus (Fluid Cursor Tracking) dengan resting gaze decay
  useEffect(() => {
    let idleTimer: NodeJS.Timeout;

    const handleMouseMove = (e: MouseEvent) => {
      if (!eyeRef.current) return;
      const rect = eyeRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;
      const dist = Math.hypot(dx, dy);

      // Area deteksi: bila kursor turun jauh ke area desktop (dy > 300px atau dist > 440px),
      // pupil bertransisi perlahan kembali ke posisi netral di tengah (resting gaze)
      if (dy > 300 || dist > 440) {
        setOffset({ x: 0, y: 0 });
        return;
      }

      // Translasi pupil luwes: batas translasi 5.2px horizontal & 3.6px vertikal
      const angle = Math.atan2(dy, dx);
      const intensity = Math.min(dist / 140, 1);

      setOffset({
        x: Math.cos(angle) * intensity * 5.2,
        y: Math.sin(angle) * intensity * 3.6,
      });

      // Kembalikan ke posisi netral jika mouse berhenti bergerak selama 2.8s
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        setOffset({ x: 0, y: 0 });
      }, 2800);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(idleTimer);
    };
  }, []);

  const smoothTransition = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)';

  return (
    <div ref={eyeRef} className="flex items-center justify-center select-none w-full h-full pointer-events-none">
      <svg
        viewBox="0 0 160 46"
        className="w-[124px] h-[34px] overflow-visible"
        style={{ filter: 'drop-shadow(0 0 6px rgba(152, 187, 214, 0.4))' }}
      >
        <defs>
          <mask id="leftTaremeMask">
            <rect width="160" height="46" fill="black" />
            <circle cx="36" cy="27" r="16.5" fill="white" />
            <polygon points="16,0 56,0 56,15 16,23" fill="black" />
            <circle cx="37.5" cy="26" r="10.8" fill="black" />
          </mask>
          <mask id="rightTaremeMask">
            <rect width="160" height="46" fill="black" />
            <circle cx="124" cy="27" r="16.5" fill="white" />
            <polygon points="104,0 144,0 144,23 104,15" fill="black" />
            <circle cx="122.5" cy="26" r="10.8" fill="black" />
          </mask>
        </defs>

        {/* Mata Kiri (✖) */}
        <g
          style={{
            transformOrigin: '36px 26px',
            transform: `scaleY(${isBlinking ? 0.05 : 1})`,
            transition: isBlinking ? 'transform 0.07s ease-in' : 'transform 0.11s ease-out',
          }}
        >
          {/* Mangkuk tareme sabit (paralaks halus) */}
          <g
            style={{
              transform: `translate(${offset.x * 0.35}px, ${offset.y * 0.35}px)`,
              transition: smoothTransition,
            }}
          >
            <rect width="160" height="46" fill="#98BBD6" mask="url(#leftTaremeMask)" />
          </g>
          {/* Pupil ✖ dengan translasi responsif */}
          <g
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px)`,
              transformOrigin: '37.5px 26px',
              transition: smoothTransition,
            }}
          >
            <path
              d="M 33.5 22 L 41.5 30 M 41.5 22 L 33.5 30"
              stroke="#98BBD6"
              strokeWidth="3.2"
              strokeLinecap="round"
            />
          </g>
        </g>

        {/* Mata Kanan (♥) */}
        <g
          style={{
            transformOrigin: '124px 26px',
            transform: `scaleY(${isBlinking ? 0.05 : 1})`,
            transition: isBlinking ? 'transform 0.07s ease-in' : 'transform 0.11s ease-out',
          }}
        >
          {/* Mangkuk tareme sabit (paralaks halus) */}
          <g
            style={{
              transform: `translate(${offset.x * 0.35}px, ${offset.y * 0.35}px)`,
              transition: smoothTransition,
            }}
          >
            <rect width="160" height="46" fill="#98BBD6" mask="url(#rightTaremeMask)" />
          </g>
          {/* Pupil ♥ dengan translasi responsif */}
          <g
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px)`,
              transformOrigin: '122.5px 26px',
              transition: smoothTransition,
            }}
          >
            <path
              d="M 122.5 29 C 122.5 29, 118 26.2, 118 23.8 C 118 22.2, 119.5 21, 121 21 C 122 21, 122.5 21.8, 122.5 21.8 C 122.5 21.8, 123 21, 124 21 C 125.5 21, 127 22.2, 127 23.8 C 127 26.2, 122.5 29, 122.5 29 Z"
              fill="#98BBD6"
            />
          </g>
        </g>
      </svg>
    </div>
  );
};
