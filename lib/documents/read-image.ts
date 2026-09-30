import {DocumentReadError,MAX_DOCUMENT_BYTES} from './read-document-limits';
import type {PageText} from './read-pdf';
export const IMAGE_READER_VERSION='native-image-1';
export const MAX_IMAGE_PIXELS=25_000_000;
export const MAX_IMAGE_SIDE=16384;
export type ImageFormat='image/png'|'image/jpeg';
const pngSignature=[137,80,78,71,13,10,26,10];
export function imageFormat(data:Uint8Array):ImageFormat|null {
 if(pngSignature.every((value,index)=>data[index]===value))return'image/png';
 if(data[0]===255&&data[1]===216)return'image/jpeg';
 return null;
}
function invalid():never{throw new DocumentReadError('IMAGE_UNREADABLE');}
function dimensions(width:number,height:number){
 if(!width||!height)invalid();
 if(width>MAX_IMAGE_SIDE||height>MAX_IMAGE_SIDE||width*height>MAX_IMAGE_PIXELS)throw new DocumentReadError('IMAGE_DIMENSIONS_TOO_LARGE',413);
 return{width,height};
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{let value=n;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(data:Uint8Array,start:number,end:number){let crc=0xffffffff;for(let i=start;i<end;i++)crc=crcTable[(crc^data[i])&255]^(crc>>>8);return(crc^0xffffffff)>>>0;}
function pngDimensions(data:Uint8Array){
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength);let offset=8,chunks=0,size:{width:number;height:number}|null=null,idat=0,endedIdat=false,palette=false,color=-1;
 while(offset+12<=data.length){
  if(++chunks>50000)invalid();
  const length=view.getUint32(offset),end=offset+12+length;
  if(end>data.length)invalid();
  const type=String.fromCharCode(...data.subarray(offset+4,offset+8));
  if(!/^[A-Za-z]{4}$/.test(type)||crc32(data,offset+4,offset+8+length)!==view.getUint32(offset+8+length))invalid();
  if(chunks===1&&type!=='IHDR')invalid();
  if(type==='IHDR'){
   if(size||length!==13)invalid();
   size=dimensions(view.getUint32(offset+8),view.getUint32(offset+12));
   const depth=data[offset+16];color=data[offset+17];
   const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
   if(!depths[color]?.includes(depth)||data[offset+18]!==0||data[offset+19]!==0||data[offset+20]>1)invalid();
  }else if(type==='PLTE'){
   if(palette||idat||length===0||length>768||length%3!==0)invalid();palette=true;
  }else if(type==='IDAT'){
   if(endedIdat||color===3&&!palette)invalid();idat+=length;
  }else if(type==='IEND'){
   if(length!==0||end!==data.length||!idat||!size)invalid();return size;
  }else{
   // Animated PNG is not a single immutable page; unsupported critical chunks
   // must not be interpreted as a normal image by a more permissive decoder.
   if(type==='acTL'||type==='fcTL'||type==='fdAT'||type[0]===type[0].toUpperCase())invalid();
  }
  if(idat&&type!=='IDAT')endedIdat=true;
  offset=end;
 }
 return invalid();
}
function jpegDimensions(data:Uint8Array){
 let offset=2,segments=0,size:{width:number;height:number}|null=null,components=0,scans=0,quantization=false,huffman=false;
 while(offset<data.length){
  if(++segments>50000||data[offset++]!==255)invalid();
  while(data[offset]===255)offset++;
  const marker=data[offset++];
  if(marker===217){if(!size||!scans||offset!==data.length)invalid();return size;}
  if(marker===216||marker===0||marker===1||marker>=208&&marker<=215)invalid();
  if(offset+2>data.length)invalid();
  const length=data[offset]*256+data[offset+1];if(length<2||offset+length>data.length)invalid();
  if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
   if(![192,194].includes(marker)||size||length<11||data[offset+2]!==8)invalid();
   components=data[offset+7];if(![1,3,4].includes(components)||length!==8+components*3)invalid();
   size=dimensions(data[offset+5]*256+data[offset+6],data[offset+3]*256+data[offset+4]);
  }
  if(marker===219){if(length<67)invalid();quantization=true;}
  if(marker===196){if(length<20)invalid();huffman=true;}
  if(marker===218){
   const count=data[offset+2];
   if(!size||!quantization||!huffman||!count||count>components||length!==6+count*2)invalid();
   offset+=length;scans++;let entropy=0;
   for(;offset<data.length;offset++){
    if(data[offset]!==255){entropy++;continue;}
    const next=data[offset+1];
    if(next===0){entropy++;offset++;continue;}
    if(next>=208&&next<=215){offset++;continue;}
    break;
   }
   if(!entropy)invalid();continue;
  }
  offset+=length;
 }
 return invalid();
}
/** Validate framing, PNG CRCs and allocation bounds before any browser decoding.
 * JPEG entropy and PNG pixels are decoded by the browser before an OCR result
 * can be saved; a structurally valid header alone never establishes authenticity. */
export function inspectImage(data:Uint8Array){
 if(data.byteLength>MAX_DOCUMENT_BYTES)throw new DocumentReadError('FILE_TOO_LARGE',413);
 const format=imageFormat(data);if(!format)throw new DocumentReadError('NOT_A_SUPPORTED_IMAGE',415);
 return{format,...(format==='image/png'?pngDimensions(data):jpegDimensions(data))};
}
export async function readImage(data:Uint8Array){
 const image=inspectImage(data),copy=new Uint8Array(data);
 const originalSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',copy))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const pages:PageText[]=[{page:1,text:'',nativeCharacters:0,needsOcr:true}];
 // pdfSha256 is the existing immutable-content pin in OCR and evidence APIs.
 // An image has no transformed PDF: the pin is the original image's exact hash.
 return{...image,readerVersion:IMAGE_READER_VERSION,originalSha256,pdfSha256:originalSha256,pages,totalPages:1,signature:'not_checked' as const,readAllPhysicalPages:true};
}
