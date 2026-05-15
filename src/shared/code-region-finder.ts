export interface CodeRegion {
  start: number;
  end: number;
}

/**
 * Find fenced markdown (```) and HTML <code>/<pre> regions in text.
 * Returns character-index ranges where end is exclusive.
 * Inline backtick runs are NOT returned.
 */
export function findCodeRegions(text: string): CodeRegion[] {
  const regions: CodeRegion[] = [];
  findFencedMarkdownRegions(text, regions);
  findHtmlCodeRegions(text, regions);
  return regions;
}

function findFencedMarkdownRegions(text: string, out: CodeRegion[]): void {
  const lines = text.split('\n');
  let offset = 0;
  let blockStart = -1;
  let openFenceLen = 0;

  for (const line of lines) {
    const fenceMatch = /^(`{3,})/.exec(line);

    if (fenceMatch) {
      const fenceLen = fenceMatch[1].length;
      const rest = line.slice(fenceLen).trim();

      if (blockStart === -1) {
        // Opening fence — may have a language hint after the backticks
        blockStart = offset;
        openFenceLen = fenceLen;
      } else if (fenceLen >= openFenceLen && rest === '') {
        // Closing fence — only backticks, no content after
        out.push({ start: blockStart, end: offset + line.length });
        blockStart = -1;
        openFenceLen = 0;
      }
      // Fence with content after backticks inside an open block — ignore
    }

    offset += line.length + 1; // +1 for the \n separator
  }

  if (blockStart !== -1) {
    // Unclosed fence — region runs to end of text
    out.push({ start: blockStart, end: text.length });
  }
}

function findHtmlCodeRegions(text: string, out: CodeRegion[]): void {
  const pattern = /<(code|pre)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    out.push({ start: match.index, end: match.index + match[0].length });
  }
}
