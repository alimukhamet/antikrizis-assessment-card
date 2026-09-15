/* Open ordinary ZIP packages locally. Keys stay in the separate credential flow. */
window.DocumentPackage=(()=>{
 const MAX_FILE=35*1024*1024,MAX_TOTAL=100*1024*1024,MAX_FILES=100;
 const fail=message=>{throw Error(message);};
 const keyName=name=>/\.(p12|pfx|key)$/i.test(name);
 const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 const crc=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
 async function inflate(bytes,size){
  let stream;try{stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{fail('Браузер не может открыть ZIP. Распакуйте архив и выберите файлы из папки.');}
  const reader=stream.getReader(),chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>size||length>MAX_FILE){await reader.cancel();fail('Размер файла в ZIP не совпал. Распакуйте архив и проверьте файлы.');}chunks.push(value);}}finally{reader.releaseLock();}
  if(length!==size)fail('Файл в ZIP повреждён. Добавьте исходный файл.');
  const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
 }
 async function unzip(file){
  if(file.size>MAX_FILE)fail('ZIP больше 35 МБ. Распакуйте его и добавьте документы частями.');
  const bytes=new Uint8Array(await file.arrayBuffer()),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===bytes.length){end=p;break;}
  if(end<0)fail('ZIP повреждён или не поддерживается. Распакуйте архив и выберите файлы из папки.');
  const count=v.getUint16(end+10,true),centralSize=v.getUint32(end+12,true),central=v.getUint32(end+16,true);
  if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==count||count===65535||central===0xffffffff||centralSize===0xffffffff)fail('Этот вид ZIP не поддерживается. Распакуйте архив и выберите файлы из папки.');
  if(count>MAX_FILES)fail('В ZIP больше 100 файлов. Добавьте документы частями.');
  if(central+centralSize!==end)fail('Не удалось прочитать список файлов ZIP. Распакуйте архив.');
  const entries=[];let at=central,total=0;
  for(let i=0;i<count;i++){
   if(at+46>end||v.getUint32(at,true)!==0x02014b50)fail('Список файлов ZIP повреждён.');
   const flags=v.getUint16(at+8,true),method=v.getUint16(at+10,true),checksum=v.getUint32(at+16,true),packed=v.getUint32(at+20,true),size=v.getUint32(at+24,true),nameLength=v.getUint16(at+28,true),extra=v.getUint16(at+30,true),comment=v.getUint16(at+32,true),offset=v.getUint32(at+42,true);
   const next=at+46+nameLength+extra+comment;if(next>end||!nameLength||offset===0xffffffff||packed===0xffffffff||size===0xffffffff)fail('Этот вид ZIP не поддерживается. Распакуйте архив.');
   const name=new TextDecoder().decode(bytes.subarray(at+46,at+46+nameLength)),parts=name.replace(/\\/g,'/').split('/');
   if(name.includes('\0')||parts.includes('..')||name.startsWith('/')||/^[a-z]:/i.test(name))fail('В ZIP есть некорректный путь. Добавьте документы из распакованной папки.');
   if(flags&1)fail('ZIP защищён паролем. Распакуйте его на компьютере и выберите файлы.');
   total+=size;if(total>MAX_TOTAL||size>MAX_FILE)fail('Распакованный пакет слишком большой. Добавьте документы частями.');
   entries.push({name,base:parts.at(-1),flags,method,checksum,packed,size,offset});at=next;
  }
  if(at!==end)fail('Список файлов ZIP повреждён.');
  const files=[],skipped=[];let keyIndex=0;
  for(const entry of entries){
   const {name,base,flags,method,checksum,packed,size,offset}=entry;
   if(!base||name.startsWith('__MACOSX/')||base.startsWith('.'))continue;
   if(!/\.pdf$/i.test(base)&&!keyName(base)){skipped.push(/\.zip$/i.test(base)?'Вложенный ZIP — распакуйте отдельно.':'Файл '+base+': сохраните как PDF и добавьте отдельно.');continue;}
   if(![0,8].includes(method))fail('Способ сжатия ZIP не поддерживается. Распакуйте архив и выберите файлы.');
   if(offset+30>central||v.getUint32(offset,true)!==0x04034b50||v.getUint16(offset+6,true)!==flags||v.getUint16(offset+8,true)!==method)fail('Файл в ZIP повреждён.');
   const localNameLength=v.getUint16(offset+26,true),start=offset+30+localNameLength+v.getUint16(offset+28,true);
   if(start+packed>central||new TextDecoder().decode(bytes.subarray(offset+30,offset+30+localNameLength))!==name)fail('Файл в ZIP повреждён.');
   const data=method===0?bytes.slice(start,start+packed):await inflate(bytes.subarray(start,start+packed),size);
   if(data.length!==size||crc(data)!==checksum)fail('Контрольная сумма файла в ZIP не совпала. Добавьте исходные файлы.');
   const credential=keyName(base),safeName=credential?'ЭЦП '+(++keyIndex)+'.'+base.split('.').at(-1).toLowerCase():base;
   files.push(new File([data],safeName,{type:credential?'application/octet-stream':'application/pdf',lastModified:file.lastModified}));
  }
  if(!files.length)fail('В ZIP нет PDF или ЭЦП. Распакуйте архив и добавьте документы в PDF.');
  return{files,skipped};
 }
 return{unzip};
})();
