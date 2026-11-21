import{PACKS as p}from"./packs.js";import{accessToken as y,fetchCredits as m,noteCredits as h}from"./auth.js";import{apiUrl as b}from"./api-origin.js";import{paymentsOn as f,getSupabase as g}from"./supabase-client.js";const c=e=>String(e).replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]);let s=null;function k(){if(s)return s;s=document.createElement("dialog"),s.className="auth-dialog buy-dialog",s.innerHTML=`
    <form method="dialog" class="auth-form">
      <h3>Buy credits</h3>
      <p class="buy-lead" id="buyLead" hidden></p>
      <p class="subtle">One credit renders one floor in both looks, light and dark, up to three times in each. Any pack takes the StyloPlan mark off your images. Prices in US dollars; credits never expire.</p>
      <div class="buy-packs">
        ${p.map(e=>`
        <button type="button" class="buy-pack${e.mark?" mark":""}" data-pack="${c(e.id)}">
          <span class="buy-name">${c(e.name)}</span>
          <span class="buy-credits">${e.credits} credits</span>
          <span class="buy-price">${c(e.price)}</span>
        </button>`).join("")}
      </div>
      <p class="auth-msg" id="buyMsg" role="alert" hidden></p>
      <p class="subtle buy-note">You pay on Stripe's secure page and come straight back here.</p>
      <div class="row auth-actions">
        <button type="button" class="btn btn--quiet" id="buyCancel">Cancel</button>
      </div>
    </form>`,document.body.append(s),s.querySelector("#buyCancel").onclick=()=>s.close();for(const e of s.querySelectorAll(".buy-pack"))e.onclick=()=>S(e);return s.addEventListener("close",()=>{i(""),u(!1)}),s}const i=e=>{const a=s.querySelector("#buyMsg");a.textContent=e,a.hidden=!e},u=(e,a)=>{for(const t of s.querySelectorAll(".buy-pack"))t.disabled=e,t.classList.toggle("working",e&&t===a)};async function S(e){i("");const a=await y();if(!a){i("Sign in first, then buy credits for your account.");return}u(!0,e);try{const t=await fetch(b("/api/checkout"),{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${a}`},body:JSON.stringify({pack:e.dataset.pack,returnTo:location.href})});let o={};try{o=await t.json()}catch{}if(!t.ok||!o.url)throw new Error(o.error||`HTTP ${t.status}`);location.assign(o.url)}catch(t){u(!1),i(String(t.message||t))}}export function openBuy(e=""){if(!f())return!1;const a=k(),t=a.querySelector("#buyLead");return t.textContent=e,t.hidden=!e,a.showModal(),!0}let n=null;export function toast(e,a=""){n?.remove(),n=document.createElement("div"),n.className=`buy-toast ${a}`,n.setAttribute("role","status"),n.textContent=e,document.body.append(n);const t=n;setTimeout(()=>{t.classList.add("out"),setTimeout(()=>t.remove(),400)},7e3)}export async function handleReturn(){const e=new URL(location.href),a=e.searchParams.get("paid");if(a===null)return;const t=e.searchParams.get("cs");if(e.searchParams.delete("paid"),e.searchParams.delete("cs"),history.replaceState(history.state,"",e.toString()),a!=="1"){toast("Payment cancelled. Nothing was charged.");return}toast("Payment received. Adding your credits…");const o=await g();for(let l=0;o&&t&&l<15;l++){const{data:d}=await o.from("payments").select("credits").eq("session_id",t).maybeSingle();if(d){const r=await m();typeof r=="number"&&h(r),toast(`${d.credits} credits added${typeof r=="number"?`. You have ${r}.`:"."}`,"ok");return}await new Promise(r=>setTimeout(r,2e3))}toast("Payment received. Your credits are on their way; reload in a minute if they have not appeared.")}
