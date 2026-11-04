import { useEffect } from 'react';
import { THEMES, themeById } from './themes';
import type { AppSettings, UiModes } from '../shared/types';

/** Applies the selected theme's CSS variables + custom background to :root. */
export function useAppearance(appearance: AppSettings['appearance']) {
  useEffect(() => {
    const theme = themeById(appearance.theme);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.vars)) {
      root.style.setProperty(k, v);
    }
    // Custom-theme overlay: if the user has tweaked any colors via the
    // Theme tab's editor, apply them ON TOP of the base theme. Lets them
    // tint an existing preset without recreating every variable from
    // scratch.
    if (appearance.customColors) {
      for (const [k, v] of Object.entries(appearance.customColors)) {
        if (v) root.style.setProperty(k, v);
      }
    }

    // Custom user CSS — injected (or refreshed) via a stable <style id="uvs-user-css">
    // tag at the end of <head>. Removing the rule is just emptying the
    // tag's text; we don't delete it so subsequent edits stay cheap.
    const STYLE_ID = 'uvs-user-css';
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    // Hard cap so a malformed settings.json import can't ship megabytes
    // of CSS into the DOM. 200 KB is generous for hand-written overrides.
    const css = (appearance.customCss ?? '').slice(0, 200_000);
    if (styleEl.textContent !== css) styleEl.textContent = css;

    root.dataset.themeDark = theme.dark ? '1' : '0';

    // Background layer is a fixed element we create once.
    let bg = document.getElementById('app-bg') as HTMLDivElement | null;
    if (!bg) {
      bg = document.createElement('div');
      bg.id = 'app-bg';
      document.body.prepend(bg);
    }
    if (appearance.backgroundData) {
      bg.style.backgroundImage = `url(${appearance.backgroundData})`;
      bg.style.opacity = String(appearance.backgroundOpacity);
      bg.style.filter = `blur(${appearance.backgroundBlur}px)`;
      bg.style.display = 'block';
    } else {
      bg.style.display = 'none';
    }
  }, [appearance]);
}

/**
 * Applies UI/launch modes (spec §1/§9) as data-attributes on <html>, which
 * the stylesheet keys off: OLED, acrylic, compact, streamer, minimal, and the
 * desktop/vr layout variant. Keeping these as attributes means zero per-mode
 * component branching — it's all CSS.
 */
export function useUiModes(ui: UiModes) {
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.mode = ui.launchMode; // 'desktop' | 'vr'
    r.dataset.compact = ui.compact ? '1' : '0';
    r.dataset.streamer = ui.streamer ? '1' : '0';
    r.dataset.oled = ui.oled ? '1' : '0';
    r.dataset.acrylic = ui.acrylic ? '1' : '0';
    r.dataset.minimal = ui.minimalUi ? '1' : '0';
  }, [ui]);
}

/** Grid of theme swatches. */
export function ThemePicker(props: { current: string; onPick: (id: string) => void }) {
  return (
    <div className="theme-grid">
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={`theme-card ${props.current === t.id ? 'on' : ''}`}
          onClick={() => props.onPick(t.id)}
          title={t.name}
        >
          <div className="theme-swatch">
            {t.preview.map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </div>
          <span className="theme-name">{t.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Background upload + tuning controls. */
export function BackgroundPicker(props: {
  appearance: AppSettings['appearance'];
  onChange: (patch: Partial<AppSettings['appearance']>) => void;
}) {
  const { appearance, onChange } = props;

  const onFile = (file: File | null) => {
    if (!file) return;
    // Accept images and gifs; cap at ~8MB to keep settings.json sane.
    if (file.size > 8 * 1024 * 1024) {
      alert('Please pick an image/GIF under 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange({ backgroundData: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <div className="bg-picker">
      <div className="bg-row">
        <label className="btn ghost file-btn">
          Upload image / GIF
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            hidden
          />
        </label>
        {appearance.backgroundData && (
          <button className="btn ghost tiny" onClick={() => onChange({ backgroundData: '' })}>
            Remove
          </button>
        )}
      </div>

      {appearance.backgroundData && (
        <>
          <div className="bg-preview">
            <img src={appearance.backgroundData} alt="background preview" />
          </div>
          <label className="slider-row">
            Opacity {Math.round(appearance.backgroundOpacity * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={appearance.backgroundOpacity * 100}
              onChange={(e) => onChange({ backgroundOpacity: Number(e.target.value) / 100 })}
            />
          </label>
          <label className="slider-row">
            Blur {appearance.backgroundBlur}px
            <input
              type="range"
              min={0}
              max={20}
              value={appearance.backgroundBlur}
              onChange={(e) => onChange({ backgroundBlur: Number(e.target.value) })}
            />
          </label>
        </>
      )}
    </div>
  );
}
