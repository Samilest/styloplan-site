import{PACKS as m}from"./packs.js";import{accessToken as y,fetchCredits as f,noteCredits as b}from"./auth.js";import{apiUrl as h}from"./api-origin.js";import{paymentsOn as g,getSupabase as k}from"./supabase-client.js";const u=e=>String(e).replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]);let s=null;function w(){if(s)return s;s=document.createElement("dialog"),s.className="auth-dialog buy-dialog",s.innerHTML=`
    <form method="dialog" class="auth-form">
      <h3>Buy credits</h3>
      <p class="subtle">One credit renders one floor in one look. Prices in US dollars; credits never expire.</p>
      <div class="buy-packs">
        ${m.map(e=>`
        <button type="button" class="buy-pack${e.mark?" mark":""}" data-pack="${u(e.id)}">
          <span class="buy-name">${u(e.name)}</span>
          <span class="buy-credits">${e.credits} credits</span>
          <span class="buy-price">${u(e.price)}</span>
        </button>`).join("")}
      </div>
      <p class="auth-msg" id="buyMsg" role="alert" hidden></p>
      <p class="subtle buy-note">You pay on Stripe's secure page and come straight back here.</p>
      <div class="row auth-actions">
        <button type="button" class="btn btn--quiet" id="buyCancel">Cancel</button>
      </div>
    </form>`,document.body.append(s),s.querySelector("#buyCancel").onclick=()=>s.close();for(const e of s.querySelectorAll(".buy-pack"))e.onclick=()=>S(e);return s.addEventListener("close",()=>{c(""),l(!1)}),s}const c=e=>{const a=s.querySelector("#buyMsg");a.textContent=e,a.hidden=!e},l=(e,a)=>{for(const t of s.querySelectorAll(".buy-pack"))t.disabled=e,t.classList.toggle("working",e&&t===a)};async function S(e){c("");const a=await y();if(!a){c("Sign in first, then buy credits for your account.");return}l(!0,e);try{const t=await fetch(h("/api/checkout"),{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${a}`},body:JSON.stringify({pack:e.dataset.pack,returnTo:location.href})});let o={};try{o=await t.json()}catch{}if(!t.ok||!o.url)throw new Error(o.error||`HTTP ${t.status}`);location.assign(o.url)}catch(t){l(!1),c(String(t.message||t))}}export function openBuy(){return g()?(w().showModal(),!0):!1}let r=null;function i(e,a=""){r?.remove(),r=document.createElement("div"),r.className=`buy-toast ${a}`,r.setAttribute("role","status"),r.textContent=e,document.body.append(r);const t=r;setTimeout(()=>{t.classList.add("out"),setTimeout(()=>t.remove(),400)},7e3)}export async function handleReturn(){const e=new URL(location.href),a=e.searchParams.get("paid");if(a===null)return;const t=e.searchParams.get("cs");if(e.searchParams.delete("paid"),e.searchParams.delete("cs"),history.replaceState(history.state,"",e.toString()),a!=="1"){i("Payment cancelled. Nothing was charged.");return}i("Payment received. Adding your credits…");const o=await k();for(let d=0;o&&t&&d<15;d++){const{data:p}=await o.from("payments").select("credits").eq("session_id",t).maybeSingle();if(p){const n=await f();typeof n=="number"&&b(n),i(`${p.credits} credits added${typeof n=="number"?`. You have ${n}.`:"."}`,"ok");return}await new Promise(n=>setTimeout(n,2e3))}i("Payment received. Your credits are on their way; reload in a minute if they have not appeared.")}
