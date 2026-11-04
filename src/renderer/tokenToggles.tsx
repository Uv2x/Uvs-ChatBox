// Clickable token chips for chatbox module templates. Instead of hand-typing
// or deleting {tokens} in a template string, the user toggles each one on/off.
// The raw text input is kept alongside (for emoji / prefixes / separators);
// these chips only add or remove the {token} part.

/** Extract unique token names from a hint like "{title} {artist}" → [title, artist]. */
export function tokensFromHint(hint: string): string[] {
  return Array.from(new Set(Array.from(hint.matchAll(/\{(\w+)\}/g), (m) => m[1]!)));
}

export function TokenToggles(props: {
  template: string;
  /** Token names WITHOUT braces, e.g. ['title', 'artist']. */
  tokens: string[];
  onChange: (nextTemplate: string) => void;
}) {
  const has = (tok: string) => new RegExp(`\\{${tok}\\}`).test(props.template);

  const toggle = (tok: string) => {
    let t = props.template;
    if (has(tok)) {
      // Remove the token (and a leading space if present) then tidy spacing.
      t = t
        .replace(new RegExp(`\\s*\\{${tok}\\}`, 'g'), '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    } else {
      t = `${t.trim()} {${tok}}`.trim();
    }
    props.onChange(t);
  };

  if (props.tokens.length === 0) return null;
  return (
    <div className="token-toggles">
      {props.tokens.map((tok) => {
        const on = has(tok);
        return (
          <button
            key={tok}
            type="button"
            className={`token-chip ${on ? 'on' : ''}`}
            onClick={() => toggle(tok)}
            title={on ? `Remove {${tok}}` : `Add {${tok}}`}
          >
            {on ? '✓ ' : '+ '}
            {tok}
          </button>
        );
      })}
    </div>
  );
}
