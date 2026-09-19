import type { JSX } from "react";

interface InfoTipProps {
  text: string;
}

/** Small "i" badge whose explanation shows on hover and on keyboard focus. */
export function InfoTip({ text }: InfoTipProps): JSX.Element {
  return (
    <span className="info-tip" tabIndex={0} aria-label={text}>
      i<span className="info-tip-text" role="tooltip">
        {text}
      </span>
    </span>
  );
}
