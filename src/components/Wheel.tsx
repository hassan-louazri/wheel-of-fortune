import { useTranslation } from 'react-i18next';
import type { RefCallback } from 'react';
import type { Language, WheelSegment } from '../config/schema';
import { segmentAngles } from '../game/geometry';

export function Wheel({ segments, disabled, rotorRef }: {
  segments: readonly WheelSegment[];
  disabled: boolean;
  rotorRef: RefCallback<SVGGElement>;
}) {
  const { t, i18n } = useTranslation();
  const language: Language = i18n.language === 'en' ? 'en' : 'fr';

  return (
    <svg className={`wheel${disabled ? ' wheel-disabled' : ''}`} viewBox="0 0 360 370"
      role="img" aria-label={t(disabled ? 'disabledWheelLabel' : 'wheelLabel')}>
      <title>{t(disabled ? 'disabledWheelLabel' : 'wheelLabel')}</title>
      <g ref={rotorRef} className="wheel-rotor">
        {segments.map((segment, index) => {
          const angles = segmentAngles(index, segments.length);
          const start = angles.start * Math.PI / 180;
          const end = angles.end * Math.PI / 180;
          const label = segment.label[language];
          return (
            <g key={segment.id}>
              <path d={`M 180 185 L ${180 + 180 * Math.cos(start)} ${185 + 180 * Math.sin(start)} A 180 180 0 0 1 ${180 + 180 * Math.cos(end)} ${185 + 180 * Math.sin(end)} Z`}
                fill={index % 2 === 0 ? '#000000' : '#dee4e7'} />
              <text x="342" y="185" dy="0.35em" textAnchor="end" fill={index % 2 === 0 ? '#ffffff' : '#000000'}
                transform={`rotate(${angles.center} 180 185)`}>
                <title>{label}</title>
                {label.length > 21 ? `${label.slice(0, 20)}…` : label}
              </text>
            </g>
          );
        })}
      </g>
      <path className="wheel-pointer" d="M 140 15 L 220 15 L 180 55 Z" fill="#dee4e7" />
    </svg>
  );
}
