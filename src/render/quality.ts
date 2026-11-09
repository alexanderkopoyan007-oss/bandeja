// Quality presets (Phase 8). What each one changes is chosen by what it costs on the GPU (DECISIONS.md, Phase 8):
// pixels drawn (the pixel-ratio cap and a render scale under it), the key light's shadow map, and the bloom pass.
// "high" is the game as it was before Phase 8. "auto" is high with the render scale adapting to hold 60 Hz
// (Game.adapt).

export interface QualityPreset {
  name: string;
  /** Most device pixels per CSS pixel. */
  maxDpr: number;
  /** Render scale under that cap (1 = native). */
  scale: number;
  /** Key light shadow map size (0: no shadows from it). */
  shadow: number;
  /** Lens bloom (an HDR target and blur passes). */
  bloom: boolean;
}

export const QUALITY: Record<'low' | 'medium' | 'high' | 'ultra', QualityPreset> = {
  low: { name: 'Low', maxDpr: 1, scale: 0.75, shadow: 1024, bloom: false },
  medium: { name: 'Medium', maxDpr: 1, scale: 1, shadow: 2048, bloom: true },
  high: { name: 'High', maxDpr: 2, scale: 1, shadow: 2048, bloom: true },
  ultra: { name: 'Ultra', maxDpr: 2, scale: 1, shadow: 4096, bloom: true },
};

export type QualityKey = keyof typeof QUALITY;

export function qualityPreset(key: string | null | undefined): QualityPreset {
  return (QUALITY as Record<string, QualityPreset>)[key ?? 'high'] ?? QUALITY.high;
}

/** Custom quality (Settings, M8): the preset's three costs chosen one by one. */
export const RESOLUTIONS = {
  /** Half the CSS pixels' width and height. */
  half: { maxDpr: 1, scale: 0.5 },
  /** Low's. */
  three: { maxDpr: 1, scale: 0.75 },
  /** One pixel per CSS pixel (Medium's). */
  full: { maxDpr: 1, scale: 1 },
  /** Every device pixel, up to two per CSS pixel (High's). */
  sharp: { maxDpr: 2, scale: 1 },
} as const;
export const SHADOW_MAPS = { off: 0, low: 1024, high: 2048, ultra: 4096 } as const;

export function customPreset(resolution: keyof typeof RESOLUTIONS, shadows: keyof typeof SHADOW_MAPS, glow: boolean): QualityPreset {
  const r = RESOLUTIONS[resolution] ?? RESOLUTIONS.sharp;
  return { name: 'Custom', maxDpr: r.maxDpr, scale: r.scale, shadow: SHADOW_MAPS[shadows] ?? 2048, bloom: glow };
}
