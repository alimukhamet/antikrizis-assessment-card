/* Preserved canonical contract wording helpers. */
const COMPANY = {
  name: "ТОО «Aplus Corporation»",
  bin: "251040012303",
  signer: "Мухамет Ә.",
  signerIntro: "Мухамет Ә."
};
function pluralRu(value,forms){
  const n=Math.abs(Number(value)||0)%100,n1=n%10;
  if(n>10&&n<20) return forms[2];
  if(n1>1&&n1<5) return forms[1];
  if(n1===1) return forms[0];
  return forms[2];
}
function numberToWordsRu(value){
  const n=Math.max(0,Math.floor(Number(value)||0));
  if(!n) return "ноль";
  const um=["","один","два","три","четыре","пять","шесть","семь","восемь","девять"];
  const uf=["","одна","две","три","четыре","пять","шесть","семь","восемь","девять"];
  const teens=["десять","одиннадцать","двенадцать","тринадцать","четырнадцать","пятнадцать","шестнадцать","семнадцать","восемнадцать","девятнадцать"];
  const tens=["","десять","двадцать","тридцать","сорок","пятьдесят","шестьдесят","семьдесят","восемьдесят","девяносто"];
  const hundreds=["","сто","двести","триста","четыреста","пятьсот","шестьсот","семьсот","восемьсот","девятьсот"];
  const groups=[{one:"",few:"",many:"",female:false},{one:"тысяча",few:"тысячи",many:"тысяч",female:true},{one:"миллион",few:"миллиона",many:"миллионов",female:false},{one:"миллиард",few:"миллиарда",many:"миллиардов",female:false}];
  const parts=[];let rest=n,gi=0;
  while(rest>0&&gi<groups.length){
    const chunk=rest%1000;rest=Math.floor(rest/1000);
    if(chunk){
      const words=[],h=Math.floor(chunk/100),t=Math.floor((chunk%100)/10),u=chunk%10;
      if(h) words.push(hundreds[h]);
      if(t===1) words.push(teens[u]);
      else{if(t) words.push(tens[t]);if(u) words.push((groups[gi].female?uf:um)[u]);}
      if(gi>0) words.push(pluralRu(chunk,[groups[gi].one,groups[gi].few,groups[gi].many]));
      parts.unshift(words.join(" "));
    }
    gi++;
  }
  return parts.join(" ").replace(/\s+/g," ").trim();
}


const CONTRACT_RENDERER_VERSION="58c760e9322067e6583b3c72b57f107305fba5efa0b69e4bb1742e53e7e3e8da";
export {COMPANY,numberToWordsRu,CONTRACT_RENDERER_VERSION};
