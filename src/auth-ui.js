import{startAuth as A,onAuthChange as P,authState as L,signIn as O,signUp as I,signOut as M,retrySync as G,signInWithGoogle as j,clearOAuthError as B,parkTermsAcceptance as H,setSignOffName as D,requestPasswordReset as F,setNewPassword as U,clearRecovery as W}from"./auth.js";import{isCloudReady as Y,paymentsOn as V}from"./supabase-client.js";import{openBuy as _,handleReturn as Z}from"./buy.js";import*as T from"./store.js";import{forgetScope as J}from"./artifacts.js";import{dropWhenFaded as $}from"./ask.js";const g=e=>String(e??"").replace(/[&<>"]/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[a]);let h=null;function z(){if(h)return h;h=document.createElement("dialog"),h.className="auth-dialog",h.innerHTML=`
    <form method="dialog" class="auth-form" novalidate>
      <h3 id="authTitle">Sign in</h3>
      <p class="subtle" id="authWhy">An account is needed to render. Everything else works without one.</p>
      <!-- FIRST, because it is the shorter road and for most people the only
           one they will take: no password to invent, and the same button signs
           in and signs up. The email form stays underneath rather than behind a
           disclosure — someone who does not want Google linked to their work
           should not have to go looking. -->
      <button type="button" id="authGoogle" class="btn btn--secondary auth-google">
        <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18Z"/>
          <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.02-2.33Z"/>
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/>
        </svg>
        <span>Continue with Google</span>
      </button>
      <p class="auth-or" id="authOr"><span>or use an email address</span></p>
      <!-- THE LABEL SITS IN THE FIELD until there is something to say. Three
           stacked label-above-input pairs is six rows of chrome for three
           answers, and this dialog is already carrying a Google button and a
           divider above them.
           IT IS A LABEL, NOT A PLACEHOLDER. A placeholder is gone the moment
           anyone types, so a half-filled form stops saying which box is which
           and a screen reader gets nothing. This one moves up and stays.
           The single-space placeholder is the mechanism: it makes
           :placeholder-shown mean "empty", which is the only way CSS can ask
           that question. Do not remove it, and do not write it in backticks --
           this whole block lives inside a template literal, and a backtick here
           closes the string. It did, once. -->
      <div class="fld-float" id="authNameRow" hidden>
        <input type="text" id="authName" autocomplete="name" placeholder=" ">
        <label for="authName">Your name</label>
      </div>
      <div class="fld-float">
        <input type="email" id="authEmail" autocomplete="email" placeholder=" " required>
        <label for="authEmail">Email</label>
      </div>
      <div class="fld-float" id="authPassRow">
        <input type="password" id="authPass" autocomplete="current-password" placeholder=" " required minlength="6">
        <label for="authPass">Password</label>
      </div>
      <!-- THE WAY BACK IN, under the field it is about. Before this there was
           none: a customer who had paid and forgot the password had no road
           back to their plans and credits but writing to us. Signing in only;
           creating an account has no password to forget yet. -->
      <p class="auth-forgot" id="authForgotRow"><button type="button" id="authForgot" class="link">Forgot your password?</button></p>
      <p class="auth-msg" id="authMsg" role="alert" hidden></p>
      <!-- CONSENT SITS WHERE THE ACCOUNT IS MADE, not in a line of small print
           under a button. Shown only when creating one: an existing customer
           agreed when they joined, and asking again every time they sign in
           trains people to tick without reading.
           The link opens in a new tab so a half-filled form is not thrown away
           by going to read what is being agreed to. -->
      <label class="check" id="authTermsRow" hidden style="align-items:flex-start">
        <input type="checkbox" id="authTerms">
        <span>I have read and accept the
          <a href="legal.html#terms" target="_blank" rel="noopener">terms of service</a>
          and the <a href="legal.html#privacy" target="_blank" rel="noopener">privacy policy</a>.</span>
      </label>
      <div class="row auth-actions">
        <button type="button" id="authCancel" class="btn btn--quiet">Cancel</button>
        <button type="submit" id="authGo" class="btn btn--primary">Sign in</button>
      </div>
      <!-- OUT OF THE BUTTON ROW ON PURPOSE. In the row it was the smallest text
           on the dialog and quieter than Cancel, which is the wrong order: for
           somebody who has never been here, this is the control they need.
           The question in front of it is what makes it findable to a person
           scanning the dialog rather than reading it. -->
      <p class="auth-alt" id="authAltRow">
        <span id="authAltAsk">New to StyloPlan?</span>
        <button type="button" id="authSwap" class="link">Create an account</button>
      </p>
    </form>`,document.body.append(h);const e=o=>h.querySelector("#"+o);let a="in",l=!1;const t=o=>{a=o;const r=o==="up",n=o==="reset";e("authTitle").textContent=n?"Reset your password":r?"Create an account":"Sign in",e("authGo").textContent=n?"Send the link":r?"Create account":"Sign in",e("authSwap").textContent=r||n?"Sign in":"Create an account",e("authAltAsk").textContent=n?"Remembered it?":r?"Already have an account?":"New to StyloPlan?",e("authNameRow").hidden=!r,e("authPassRow").hidden=n,e("authGoogle").hidden=n,e("authOr").hidden=n,e("authForgotRow").hidden=o!=="in",e("authPass").autocomplete=r?"new-password":"current-password",e("authMsg").hidden=!0,e("authTermsRow").hidden=!r,e("authTerms").checked=!1,e("authAltRow").hidden=l&&!n,e("authWhy").textContent=n?"Enter the email on your account. We will send a link to choose a new password.":l?"This app is not open for new accounts yet.":r?"New accounts start with one render credit.":"Your projects, brand kits and credits live on your account."},i=(o,r="bad")=>{const n=e("authMsg");n.textContent=o,n.className=`auth-msg ${r}`,n.hidden=!1};return e("authSwap").onclick=()=>t(a==="in"?"up":"in"),e("authForgot").onclick=()=>{t("reset"),e("authEmail").focus()},e("authCancel").onclick=()=>h.close(),e("authGoogle").onclick=async()=>{if(a==="up"&&!e("authTerms").checked)return i("Please accept the terms of service and the privacy policy to create an account.");a==="up"&&H();const o=e("authGoogle");o.disabled=!0;const r=o.querySelector("span").textContent;o.querySelector("span").textContent="Taking you to Google…";const n=await j();n.error&&(o.disabled=!1,o.querySelector("span").textContent=r,i(`${n.error} Use an email address below instead.`))},h.querySelector("form").addEventListener("submit",async o=>{if(o.preventDefault(),a==="reset"){const m=e("authEmail").value.trim();if(!/^[^\s@]+@[^\s@]+$/.test(m))return i("Enter the email address on your account.");e("authGo").disabled=!0;const y=e("authGo").textContent;e("authGo").textContent="Sending…";const d=await F(m);return e("authGo").disabled=!1,e("authGo").textContent=y,d.error?i(d.error):i(`If ${m} has an account, a link to choose a new password is on its way. It can take a few minutes, so check your spam folder too.`,"ok")}const r=e("authEmail").value.trim(),n=e("authPass").value;if(!r||n.length<6)return i("Enter an email and a password of at least 6 characters.");if(a==="up"&&!e("authTerms").checked)return i("Please accept the terms of service and the privacy policy to create an account.");e("authGo").disabled=!0;const s=e("authGo").textContent;e("authGo").textContent="Working…";const p=a==="up"?await I(r,n,e("authName").value.trim()):await O(r,n);if(e("authGo").disabled=!1,e("authGo").textContent=s,p.closed)return l=!0,t("in"),i(p.error);if(p.error)return i(p.error);if(p.confirmEmail)return i("Check your inbox to confirm the address, then sign in.","ok");h.close()}),h.addEventListener("close",()=>{t("in"),h.querySelector("form").reset()}),t("in"),h}export function signOutDestination(e){const a=new URLSearchParams(e||"");return a.get("p")&&a.get("f")?"projects.html":null}function K(){const e=signOutDestination(location.search);e?location.replace(e):location.reload()}function Q(e,a){return new Promise(l=>{const t=document.createElement("dialog");t.className="auth-dialog";const i=e===a;t.innerHTML=`
      <form method="dialog" class="auth-form">
        <h3>Your account</h3>
        <p class="subtle">Signed in as ${g(a)}.</p>

        <div class="fld-float" style="margin-top:16px">
          <input type="text" id="acctName" autocomplete="name" placeholder=" "
                 value="${i?"":g(e)}" maxlength="80">
          <label for="acctName">Name on your verification reports</label>
        </div>
        <p class="subtle" style="margin-top:6px">${i?"Your reports are signed with your email address because no name is set. A report says a named person checked the dimensions.":"This is the name printed under “Reviewed and confirmed by”."}</p>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn btn--secondary btn--sm" data-act="save">Save name</button>
        </div>

        <hr style="border:0;border-top:1px solid var(--line);margin:20px 0 16px">
        <p class="subtle">Your projects, brand kits and images are kept on your
        account. You can also keep them as one file of your own.</p>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn btn--secondary btn--sm" data-act="copy">Download a copy</button>
          <button type="button" class="btn btn--quiet btn--sm" data-act="restore">Restore from a copy</button>
          <input type="file" data-act="file" accept="application/json,.json" hidden>
        </div>
        <p class="subtle" data-copy-msg role="status" hidden></p>

        <hr style="border:0;border-top:1px solid var(--line);margin:20px 0 16px">
        <p class="subtle">Your projects are saved to your
        account and then removed from this computer, so nothing of yours is left on
        screen. Signing in again brings all of it back.</p>
        <p class="auth-msg" data-msg role="alert" hidden></p>
        <div class="row auth-actions">
          <button type="button" class="btn btn--quiet" data-act="no">Close</button>
          <button type="button" class="btn btn--primary" data-act="yes">Sign out</button>
        </div>
      </form>`,document.body.append(t);const o=t.querySelector('[data-act="save"]');o.onclick=async()=>{const d=t.querySelector("#acctName"),u=t.querySelector("[data-msg]");o.disabled=!0;const f=o.textContent;o.textContent="Saving…";const b=await D(d.value);if(o.disabled=!1,o.textContent=f,u.hidden=!1,b.error){u.className="auth-msg",u.textContent=b.error;return}u.className="auth-msg ok",u.textContent=`Reports will be signed “${b.name}” from now on. Anything already downloaded keeps the name it was made with.`};const r=t.querySelector("[data-copy-msg]"),n=d=>{r.hidden=!1,r.textContent=d};t.querySelector('[data-act="copy"]').onclick=async d=>{const u=d.currentTarget;u.disabled=!0;try{const{exportBackup:f}=await import("./backup.js");n("Packing…");const b=await f(n),c=document.createElement("a");c.href=URL.createObjectURL(b),c.download=`styloplan-backup-${new Date().toISOString().slice(0,10)}.json`,c.click(),URL.revokeObjectURL(c.href),n(`Copy saved (${(b.size/1048576).toFixed(1)} MB).`)}catch(f){n(`The copy could not be made: ${f.message}`)}finally{u.disabled=!1}};const s=t.querySelector('[data-act="file"]');t.querySelector('[data-act="restore"]').onclick=()=>{s.value="",s.click()},s.onchange=async()=>{const d=s.files[0];if(d)try{const{inspectBackup:u,restoreBackup:f}=await import("./backup.js"),{askConfirm:b}=await import("./ask.js"),c=await u(d),k=c.exportedAt?new Date(c.exportedAt).toLocaleString():"an unknown date";if(!await b({title:"Restore this copy?",body:[`This copy was made on ${k}.`,`Projects: ${c.projects}   Brand kits: ${c.kits}   Images: ${c.images}`,c.overwrites?`${c.overwrites} project${c.overwrites>1?"s":""} already here will be REPLACED, and ${c.adds} added.`:`${c.adds} project${c.adds===1?"":"s"} will be added. Nothing already here is replaced.`],confirm:"Restore",danger:c.overwrites>0})){n("Restore cancelled.");return}const w=await f(c,n);n(`Restored ${w.projects} project${w.projects===1?"":"s"}, ${w.kits} brand kit${w.kits===1?"":"s"} and ${w.images} image${w.images===1?"":"s"}. Reloading…`),setTimeout(()=>location.reload(),1200)}catch(u){n(`Restore failed: ${u.message}`)}};let p=!1;const m=t.querySelector('[data-act="yes"]'),y=t.querySelector("[data-msg]");t.querySelector('[data-act="no"]').onclick=()=>t.close(),m.onclick=async()=>{m.disabled=!0,m.textContent="Saving to your account…",y.hidden=!0;let d=null;try{d=await T.syncCloud()}catch{d=null}if(!d||d.errors.length){m.disabled=!1,m.textContent="Sign out",y.hidden=!1,y.textContent="Your projects could not be saved to your account, so nothing was removed and you are still signed in. Check your connection and try again.";return}p=!0,t.close()},t.addEventListener("close",()=>{l(p),$(t)}),t.showModal(),t.querySelector('[data-act="no"]').focus()})}function X(e){const a=document.createElement("dialog");a.className="auth-dialog",a.innerHTML=`
    <form method="dialog" class="auth-form" novalidate>
      <h3>Choose a new password</h3>
      <p class="subtle">You opened the link from your email, so you are signed in as ${g(e)}.
      Choose the password you will use from now on.</p>
      <input type="email" autocomplete="username" value="${g(e)}" hidden>
      <div class="fld-float" data-field>
        <input type="password" id="newPass" autocomplete="new-password" placeholder=" " minlength="6" required>
        <label for="newPass">New password</label>
      </div>
      <p class="auth-msg" data-msg role="alert" hidden></p>
      <div class="row auth-actions">
        <button type="button" class="btn btn--quiet" data-act="later">Later</button>
        <button type="submit" class="btn btn--primary" data-act="save">Save password</button>
      </div>
    </form>`,document.body.append(a);const l=a.querySelector("[data-msg]"),t=a.querySelector('[data-act="save"]'),i=a.querySelector('[data-act="later"]');let o=!1;i.onclick=()=>a.close(),a.querySelector("form").addEventListener("submit",async r=>{if(r.preventDefault(),o)return a.close();t.disabled=!0;const n=t.textContent;t.textContent="Saving…";const s=await U(a.querySelector("#newPass").value);if(t.disabled=!1,t.textContent=n,l.hidden=!1,s.error){l.className="auth-msg",l.textContent=s.error;return}o=!0,l.className="auth-msg ok",l.textContent="Your new password is saved. Use it the next time you sign in.",a.querySelector("[data-field]").hidden=!0,i.hidden=!0,t.textContent="Done",t.focus()}),a.addEventListener("close",()=>{W(),$(a)}),a.showModal(),a.querySelector("#newPass").focus()}export function openSignIn(e="in",a=null,l="bad"){const t=z();if(e==="up"&&t.querySelector("#authSwap").click(),a){const i=t.querySelector("#authMsg");i.textContent=a,i.className=`auth-msg ${l}`,i.hidden=!1}t.showModal(),t.querySelector("#authEmail").focus()}const E="pr.acctView",ee=()=>{try{return JSON.parse(localStorage.getItem(E)||"null")}catch{return null}},v=e=>{try{localStorage.setItem(E,JSON.stringify(e))}catch{}};function C(e,a=""){if(!e.in)return'<button class="btn btn--secondary btn--sm" id="acctIn">Sign in</button>';const l=e.needsName?`${e.name}: add the name that signs your reports`:e.name,t=V()?`<button type="button" class="acct-credits acct-buy${e.low?" low":""}" id="acctBuy" title="Render credits remaining. Buy more" aria-label="${g(e.credits)} credits. Buy more">${g(e.credits)}<span aria-hidden="true">+</span></button>`:`<span class="acct-credits${e.low?" low":""}" title="Render credits remaining">${g(e.credits)}</span>`;return a+t+`<button class="btn btn--secondary btn--sm acct-name${e.needsName?" needs-name":""}" id="acctMenu" title="${g(l)}" aria-label="${g(l)}">${g(e.name)}</button>`}export async function mountAccount(e){let a=null;const l=ee();if(l){e.innerHTML=C(l),e.hidden=!1;for(const s of e.querySelectorAll("button"))s.onclick=()=>{a=s.id}}if(!await Y()){e.hidden=!0;return}A(),Z();let t=!1,i=!1;const o=s=>{!s||t||(t=!0,B(),openSignIn("in",s.message))},r=()=>{const s=a;a=null,s&&e.querySelector(`#${s}`)?.click()},n=({user:s,credits:p,ready:m,sync:y,oauthError:d,recovery:u})=>{if(!m)return;if(e.hidden=!1,o(d),!s){v({in:!1}),e.innerHTML=C({in:!1}),e.querySelector("#acctIn").onclick=()=>openSignIn(),r();return}u&&!i&&(i=!0,X(s.email));const f=s.user_metadata?.full_name||s.email,b=p??"–",c=typeof p=="number"&&p<=1,k=y&&y.ok===!1?`<button class="btn btn--secondary btn--sm acct-sync-warn" id="acctSync" title="${g(y.message||"")} Your work is safe on this device. Press to try again.">Not in your account &middot; Retry</button>`:y&&y.ok===null?'<span class="acct-sync-warn" id="acctSyncing">Syncing…</span>':"",x=f===s.email,w={in:!0,name:f,credits:b,low:c,needsName:x};v(w),e.innerHTML=C(w,k);const q=e.querySelector("#acctBuy");q&&(q.onclick=()=>_());const S=e.querySelector("#acctSync");S&&(S.onclick=()=>{S.disabled=!0,G()}),e.querySelector("#acctMenu").onclick=async()=>{if(!await Q(f,s.email))return;const R=T.clearLocalWork();for(const N of R)await J(N);v({in:!1}),await M(),K()},r()};P(n),n(L())}
