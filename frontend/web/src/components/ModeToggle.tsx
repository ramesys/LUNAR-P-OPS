import type { JSX } from "react";
import type { Mode } from "../lib/mode.ts";

interface ModeToggleProps {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

const OPTIONS: readonly { mode: Mode; label: string; hint: string }[] = [
  { mode: "simple", label: "Simple", hint: "Plain-language results for everyone" },
  { mode: "expert", label: "Expert", hint: "All settings, exports and detailed tables" },
];

/** RF-16: switch between the Simple and Expert presentations of the same analysis. */
export function ModeToggle({ mode, onChange }: ModeToggleProps): JSX.Element {
  return (
    <div className="mode-toggle" role="group" aria-label="View mode">
      {OPTIONS.map(
        (option: { mode: Mode; label: string; hint: string }): JSX.Element => (
          <button
            key={option.mode}
            type="button"
            title={option.hint}
            aria-pressed={mode === option.mode}
            onClick={(): void => {
              onChange(option.mode);
            }}
          >
            {option.label}
          </button>
        ),
      )}
    </div>
  );
}
