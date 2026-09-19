/**
 * RF-18: export an on-screen SVG chart as a self-contained PNG. CSS classes and custom properties
 * do not survive outside the page, so computed styles are copied onto a clone first.
 */

const STYLE_PROPERTIES: readonly string[] = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "paint-order",
  "visibility",
];

const SVG_NS: string = "http://www.w3.org/2000/svg";
const SCALE: number = 2;
const PADDING: number = 16;
const HEADER: number = 52;
const FOOTER: number = 44;

export interface LegendEntry {
  label: string;
  color: string;
  kind: "line" | "area";
}

export interface ChartImageOptions {
  title: string;
  subtitle: string;
  legend: readonly LegendEntry[];
  credit: string;
  background: string;
  textColor: string;
  mutedColor: string;
}

function styleText(element: Element): string {
  const computed: CSSStyleDeclaration = getComputedStyle(element);
  return STYLE_PROPERTIES.map((name: string): string => `${name}:${computed.getPropertyValue(name)}`)
    .filter((declaration: string): boolean => !declaration.endsWith(":"))
    .join(";");
}

/** Clone of `svg` with explicit pixel size and every element's computed style inlined. */
export function inlineSvg(svg: SVGSVGElement): SVGSVGElement {
  const clone: SVGSVGElement = svg.cloneNode(true) as SVGSVGElement;
  const sources: Element[] = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const targets: Element[] = [clone, ...Array.from(clone.querySelectorAll("*"))];
  sources.forEach((source: Element, i: number): void => {
    targets[i]?.setAttribute("style", styleText(source));
  });
  const { width, height } = svg.viewBox.baseVal;
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", width.toString());
  clone.setAttribute("height", height.toString());
  clone.removeAttribute("class");
  return clone;
}

export function serializeSvg(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve: (image: HTMLImageElement) => void, reject: (error: Error) => void): void => {
    const image: HTMLImageElement = new Image();
    image.onload = (): void => {
      resolve(image);
    };
    image.onerror = (): void => {
      reject(new Error("Could not render the chart image"));
    };
    image.src = url;
  });
}

function drawLegend(context: CanvasRenderingContext2D, entries: readonly LegendEntry[], x: number, y: number, textColor: string): void {
  let cursor: number = x;
  context.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
  context.textBaseline = "middle";
  for (const entry of entries) {
    context.fillStyle = entry.color;
    if (entry.kind === "line") {
      context.fillRect(cursor, y - 2, 16, 4);
    } else {
      context.fillRect(cursor, y - 6, 16, 12);
    }
    cursor += 22;
    context.fillStyle = textColor;
    context.fillText(entry.label, cursor, y);
    cursor += context.measureText(entry.label).width + 18;
  }
}

/** PNG of the chart with a title, subtitle, legend and data credit, at 2× resolution. */
export async function chartToPng(svg: SVGSVGElement, options: ChartImageOptions): Promise<Blob> {
  const inlined: SVGSVGElement = inlineSvg(svg);
  const { width, height } = svg.viewBox.baseVal;
  const url: string = URL.createObjectURL(new Blob([serializeSvg(inlined)], { type: "image/svg+xml" }));
  try {
    const image: HTMLImageElement = await loadImage(url);
    const canvas: HTMLCanvasElement = document.createElement("canvas");
    canvas.width = (width + 2 * PADDING) * SCALE;
    canvas.height = (height + HEADER + FOOTER) * SCALE;
    const context: CanvasRenderingContext2D | null = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas is not available");
    }
    context.scale(SCALE, SCALE);
    context.fillStyle = options.background;
    context.fillRect(0, 0, width + 2 * PADDING, height + HEADER + FOOTER);
    context.textBaseline = "alphabetic";
    context.fillStyle = options.textColor;
    context.font = "600 16px system-ui, -apple-system, 'Segoe UI', sans-serif";
    context.fillText(options.title, PADDING, 24);
    context.fillStyle = options.mutedColor;
    context.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    context.fillText(options.subtitle, PADDING, 42);
    context.drawImage(image, PADDING, HEADER, width, height);
    drawLegend(context, options.legend, PADDING, HEADER + height + 14, options.textColor);
    context.fillStyle = options.mutedColor;
    context.font = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    context.textBaseline = "alphabetic";
    context.fillText(options.credit, PADDING, HEADER + height + 36);
    return await new Promise<Blob>((resolve: (blob: Blob) => void, reject: (error: Error) => void): void => {
      canvas.toBlob((blob: Blob | null): void => {
        if (blob === null) {
          reject(new Error("Could not encode the PNG"));
        } else {
          resolve(blob);
        }
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
