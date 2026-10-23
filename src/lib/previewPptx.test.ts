import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parsePptxVisual } from './previewPptx';

/** 1×1 PNG */
const TINY_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

async function buildMiniPptx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
      <p:sldSz cx="12192000" cy="6858000"/>
    </p:presentation>`,
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld>
        <p:bg><p:bgPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:bgPr></p:bg>
        <p:spTree>
          <p:sp>
            <p:spPr>
              <a:xfrm><a:off x="1000000" y="800000"/><a:ext cx="8000000" cy="1200000"/></a:xfrm>
              <a:solidFill><a:srgbClr val="FFEEDD"/></a:solidFill>
            </p:spPr>
            <p:txBody>
              <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2800" b="1"/><a:t>Hello Deck</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
          <p:pic>
            <p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
            <p:spPr>
              <a:xfrm><a:off x="2000000" y="2500000"/><a:ext cx="4000000" cy="3000000"/></a:xfrm>
            </p:spPr>
          </p:pic>
        </p:spTree>
      </p:cSld>
    </p:sld>`,
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
    </Relationships>`,
  );
  zip.file('ppt/media/image1.png', TINY_PNG);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('parsePptxVisual', () => {
  it('extracts bg, positioned text and image', async () => {
    const buf = await buildMiniPptx();
    const { slides, cx, cy } = await parsePptxVisual(buf);
    expect(cx).toBe(12192000);
    expect(cy).toBe(6858000);
    expect(slides).toHaveLength(1);
    const s = slides[0];
    expect(s.bg).toBe('#112233');
    expect(s.title).toBe('Hello Deck');
    const text = s.elements.find((e) => e.kind === 'text');
    expect(text?.text).toContain('Hello Deck');
    expect(text?.align).toBe('center');
    expect(text?.bold).toBe(true);
    expect(text!.x).toBeGreaterThan(5);
    expect(text!.w).toBeGreaterThan(50);
    const img = s.elements.find((e) => e.kind === 'image');
    expect(img?.src?.startsWith('data:image/png;base64,')).toBe(true);
    expect(img!.y).toBeGreaterThan(20);
  });
});
