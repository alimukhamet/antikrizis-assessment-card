import {readPdf,unwrapPdf} from './read-pdf';
import {readImage,imageFormat,inspectImage} from './read-image';
export type DocumentRead=Awaited<ReturnType<typeof readPdf>> & {format?:'application/pdf'|'image/png'|'image/jpeg';width?:number;height?:number};
export async function readDocument(bytes:Uint8Array):Promise<DocumentRead>{return imageFormat(bytes)?readImage(bytes):readPdf(bytes);}
export function originalDocumentFormat(document:{original_key:string}){
 if(document.original_key.endsWith('.png'))return'image/png' as const;
 if(document.original_key.endsWith('.jpg'))return'image/jpeg' as const;
 return'application/pdf' as const;
}
export function previewDocument(bytes:Uint8Array){
 const format=imageFormat(bytes);
 if(format){inspectImage(bytes);return{bytes,format};}
 return{bytes:unwrapPdf(bytes).bytes,format:'application/pdf' as const};
}
