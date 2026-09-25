import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';

export const PDF_READER_VERSION = 'native-pdf-3';
export const MAX_DOCUMENT_BYTES = 35 * 1024 * 1024;
// Full GKB reports for clients with long histories exceed 500 pages.
export const MAX_DOCUMENT_PAGES = 1000;
export type PageText = { page: number; text: string; layoutText?: string; nativeCharacters: number; needsOcr: boolean };
export class DocumentReadError extends Error { constructor(public code: string, public status = 422) { super(code); } }
const prefix = new TextEncoder().encode('%PDF');
function isPdf(data: Uint8Array) { return prefix.every((v, i) => data[i] === v); }
/** Extract a PDF encapsulated in an ASN.1 OCTET STRING. This does NOT verify a signature. */
export function unwrapPdf(data: Uint8Array): { bytes: Uint8Array; encapsulated: boolean } {
  if (data.byteLength > MAX_DOCUMENT_BYTES) throw new DocumentReadError('FILE_TOO_LARGE', 413);
  if (isPdf(data)) return { bytes: data, encapsulated: false };
  let visited = 0;
  function walk(start: number, end: number, depth: number): Uint8Array | null {
    if (depth > 16) return null;
    let p = start;
    while (p + 2 <= end) {
      if (++visited > 100000) throw new DocumentReadError('CONTAINER_COMPLEXITY_LIMIT');
      const tag = data[p++]; let length = data[p++];
      if (length & 128) {
        const count = length & 127; if (!count || count > 4 || p + count > end) return null;
        length = 0; for (let i = 0; i < count; i++) length = length * 256 + data[p++];
      }
      if (length > end - p) return null;
      const next = p + length;
      if (tag === 4 && isPdf(data.subarray(p, next))) return data.subarray(p, next);
      if (tag & 32) { const found = walk(p, next, depth + 1); if (found) return found; }
      p = next;
    }
    return null;
  }
  const found = walk(0, data.length, 0);
  if (!found) throw new DocumentReadError('NOT_A_SUPPORTED_PDF');
  return { bytes: found, encapsulated: true };
}
async function digest(data: Uint8Array): Promise<string> {
  const copy = new Uint8Array(data.length); copy.set(data);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function readPdf(data: Uint8Array) {
  const document = unwrapPdf(data);
  const originalSha256 = await digest(data), pdfSha256 = await digest(document.bytes);
  let pdf;
  try { pdf = await getDocumentProxy(document.bytes.slice(), { useSystemFonts: false, disableFontFace: true }); }
  catch { throw new DocumentReadError('PDF_UNREADABLE_OR_ENCRYPTED'); }
  try {
    if (pdf.numPages > MAX_DOCUMENT_PAGES) throw new DocumentReadError('TOO_MANY_PAGES', 413);
    const pages: PageText[] = []; let characters = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n); const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      text = text.normalize('NFKC').replace(/\u00a0/g, ' ');
      characters += text.length;
      if (characters > 8_000_000) throw new DocumentReadError('EXTRACTED_TEXT_LIMIT', 413);
      const nativeCharacters = text.replace(/\s/g, '').length;
      let needsOcr=nativeCharacters<120;
      // GKB sometimes inserts a blank numbered page or a two-row request-history tail.
      // A logo alone is not a scanned page. Verify the image is confined to the header.
      const isGkb=/Персональный кредитный отчет|Жеке кредиттік есеп/i.test(pages[0]?.text||text);
      if(needsOcr&&isGkb&&sparseGkbText(text)&&typeof page.getOperatorList==='function'){
        const {OPS}=await getResolvedPDFJS(),operators=await page.getOperatorList();
        needsOcr=!headerImagesOnly(operators,OPS,page.view[2]-page.view[0],page.view[3]-page.view[1]);
      }
      // Some bureau templates draw labels first and values last. Preserve the
      // original stream for tables, plus spatial lines for label/value identity.
      const lines: Array<{y:number;items:Array<{x:number;text:string}>}> = [];
      for(const item of n===1?content.items:[]){
        if(!('str' in item)||!item.str.trim()||!item.transform)continue;
        const y=item.transform[5],x=item.transform[4];
        let line=lines.find(line=>Math.abs(line.y-y)<=2.5);
        if(!line){line={y,items:[]};lines.push(line);}
        line.items.push({x,text:item.str});
      }
      const layoutText=lines.sort((a,b)=>b.y-a.y).map(line=>line.items.sort((a,b)=>a.x-b.x).map(item=>item.text).join('   ')).join('\n').normalize('NFKC');
      pages.push({ page: n, text, layoutText, nativeCharacters, needsOcr });
      page.cleanup();
    }
    return { readerVersion: PDF_READER_VERSION, originalSha256, pdfSha256, pages, totalPages: pdf.numPages, signature: document.encapsulated ? 'present_not_verified' as const : 'not_checked' as const, readAllPhysicalPages: true };
  } finally { await pdf.loadingTask.destroy(); }
}

export function sparseGkbText(text:string){
 if(!/(?:Страница\s+\d+\s+из\s+\d+|\d+\s+беттің\s+\d+\s+беті)/.test(text))return false;
 const rest=text.replace(/(?:Страница\s+\d+\s+из\s+\d+|\d+\s+беттің\s+\d+\s+беті)/g,'').replace(/^\d{2}\.\d{2}\.\d{4} - \d{2}:\d{2}\s+(?:Жеке кредиттік есеп|Персональный кредитный отчет)\s+(?:"МКБ" АҚ|АО "ГКБ")\s+(?:Деректер жоқ|Нет данных)\s*$/gm,'');
 return !rest.trim();
}
export function headerImagesOnly(operators:{fnArray:number[];argsArray:unknown[]},ops:Record<string,number>,width:number,height:number){
 let matrix=[1,0,0,1,0,0],images=0;const stack:number[][]=[];
 for(let i=0;i<operators.fnArray.length;i++){
  const fn=operators.fnArray[i],a=operators.argsArray[i] as number[];
  if(fn===ops.save)stack.push([...matrix]);else if(fn===ops.restore){const saved=stack.pop();if(!saved)return false;matrix=saved;}
  else if(fn===ops.transform){const [x,y,z,w,e,f]=matrix;matrix=[x*a[0]+z*a[1],y*a[0]+w*a[1],x*a[2]+z*a[3],y*a[2]+w*a[3],x*a[4]+z*a[5]+e,y*a[4]+w*a[5]+f];}
  else if(fn===ops.paintImageXObject){images++;const [x,y,z,h,left,bottom]=matrix;if(images>1||x<=0||h<=0||y!==0||z!==0||left<0||left+x>width||x>width*.7||h>height*.07||bottom<height*.89||bottom+h>height)return false;}
  else if([ops.paintInlineImageXObject,ops.paintImageMaskXObject,ops.paintImageXObjectRepeat,ops.paintImageMaskXObjectGroup,ops.paintFormXObjectBegin,ops.shadingFill].includes(fn))return false;
 }
 return images===1&&stack.length===0;
}
