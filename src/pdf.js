export const LETTER={w:612,h:792};function T(n){try{const[a,s,i]=n.getContext("2d").getImageData(0,0,1,1).data;return[a,s,i].map(r=>(r/255).toFixed(3)).join(" ")}catch{return"1 1 1"}}export async function canvasesToPdfBlob(n,a=.92){const s=new TextEncoder,i=[];let r=0;const g=[],o=t=>{const e=typeof t=="string"?s.encode(t):t;i.push(e),r+=e.length},c=(t,e)=>{g[t]=r,o(`${t} 0 obj
${e}
endobj
`)},d=n.length,p=t=>3+t*3,h=t=>4+t*3,f=t=>5+t*3;o(`%PDF-1.4
%µµ
`),c(1,"<< /Type /Catalog /Pages 2 0 R >>"),c(2,`<< /Type /Pages /Kids [${n.map((t,e)=>`${p(e)} 0 R`).join(" ")}] /Count ${d} >>`);for(let t=0;t<d;t++){const e=n[t],y=await new Promise(R=>e.toBlob(R,"image/jpeg",a)),l=new Uint8Array(await y.arrayBuffer()),m=Math.min(LETTER.w/e.width,LETTER.h/e.height),w=e.width*m,b=e.height*m,j=(LETTER.w-w)/2,B=(LETTER.h-b)/2;c(p(t),`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LETTER.w} ${LETTER.h}] /Resources << /XObject << /Im${t} ${h(t)} 0 R >> >> /Contents ${f(t)} 0 R >>`),g[h(t)]=r,o(`${h(t)} 0 obj
<< /Type /XObject /Subtype /Image /Width ${e.width} /Height ${e.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${l.length} >>
stream
`),o(l),o(`
endstream
endobj
`);const u=`${T(e)} rg 0 0 ${LETTER.w} ${LETTER.h} re f q ${w.toFixed(2)} 0 0 ${b.toFixed(2)} ${j.toFixed(2)} ${B.toFixed(2)} cm /Im${t} Do Q`;c(f(t),`<< /Length ${u.length} >>
stream
${u}
endstream`)}const $=3+d*3,P=r;let x=`xref
0 ${$}
0000000000 65535 f 
`;for(let t=1;t<$;t++)x+=String(g[t]).padStart(10,"0")+` 00000 n 
`;return o(x),o(`trailer
<< /Size ${$} /Root 1 0 R >>
startxref
${P}
%%EOF
`),new Blob(i,{type:"application/pdf"})}export function canvasToPdfBlob(n,a=.92){return canvasesToPdfBlob([n],a)}
