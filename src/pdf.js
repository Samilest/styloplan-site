export async function canvasesToPdfBlob(o,r=300,a=.92){const j=new TextEncoder,p=[];let s=0;const c=[],n=t=>{const e=typeof t=="string"?j.encode(t):t;p.push(e),s+=e.length},i=(t,e)=>{c[t]=s,n(`${t} 0 obj
${e}
endobj
`)},d=o.length,f=t=>3+t*3,g=t=>4+t*3,h=t=>5+t*3;n(`%PDF-1.4
%µµ
`),i(1,"<< /Type /Catalog /Pages 2 0 R >>"),i(2,`<< /Type /Pages /Kids [${o.map((t,e)=>`${f(e)} 0 R`).join(" ")}] /Count ${d} >>`);for(let t=0;t<d;t++){const e=o[t],y=await new Promise(B=>e.toBlob(B,"image/jpeg",a)),m=new Uint8Array(await y.arrayBuffer()),x=e.width/r*72,b=e.height/r*72;i(f(t),`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${x.toFixed(2)} ${b.toFixed(2)}] /Resources << /XObject << /Im${t} ${g(t)} 0 R >> >> /Contents ${h(t)} 0 R >>`),c[g(t)]=s,n(`${g(t)} 0 obj
<< /Type /XObject /Subtype /Image /Width ${e.width} /Height ${e.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${m.length} >>
stream
`),n(m),n(`
endstream
endobj
`);const P=`q ${x.toFixed(2)} 0 0 ${b.toFixed(2)} 0 0 cm /Im${t} Do Q`;i(h(t),`<< /Length ${P.length} >>
stream
${P}
endstream`)}const $=3+d*3,u=s;let l=`xref
0 ${$}
0000000000 65535 f 
`;for(let t=1;t<$;t++)l+=String(c[t]).padStart(10,"0")+` 00000 n 
`;return n(l),n(`trailer
<< /Size ${$} /Root 1 0 R >>
startxref
${u}
%%EOF
`),new Blob(p,{type:"application/pdf"})}export function canvasToPdfBlob(o,r=300,a=.92){return canvasesToPdfBlob([o],r,a)}
