import{startAuth as M,onAuthChange as B,authState as G,signIn as H,signUp as j,signOut as D,retrySync as W,signInWithGoogle as F,clearOAuthError as U,parkTermsAcceptance as Y,setSignOffName as V,requestPasswordReset as _,setNewPassword as Z,clearRecovery as z,recoveryPending as J}from"./auth.js?v=a864c479afde";import{isCloudReady as K,paymentsOn as Q,captchaSiteKey as $}from"./supabase-client.js?v=a864c479afde";import{createCaptcha as X,loadTurnstile as ee}from"./captcha.js?v=a864c479afde";import{openBuy as te,handleReturn as ae,takeBuyLink as ne,continueBuy as oe}from"./buy.js?v=a864c479afde";import*as N from"./store.js?v=a864c479afde";import{forgetScope as se}from"./artifacts.js?v=a864c479afde";import{dropWhenFaded as R}from"./ask.js?v=a864c479afde";const y=e=>String(e??"").replace(/[&<>"]/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[a]);let p=null;function re(){if(p)return p;p=document.createElement("dialog"),p.className="auth-dialog",p.innerHTML=`
    <form method="dialog" class="auth-form" novalidate>
      <!-- THE WAY OUT IS THE CORNER, as on every sign-in form people know.
           A Cancel beside the submit made the footer read like a confirm
           dialog, and squeezed the one action of the form into half a row. -->
      <div class="auth-head">
        <h3 id="authTitle">Sign in</h3>
        <button type="button" id="authCancel" class="btn btn--icon btn--quiet auth-close" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
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
      <!-- Empty, and hidden, unless the check asks the person something. -->
      <div id="authCheck" class="auth-check" hidden></div>
      <!-- ONE ACTION, THE WIDTH OF THE FIELDS it submits, directly under them. -->
      <button type="submit" id="authGo" class="btn btn--primary auth-submit">Sign in</button>
      <!-- OUT OF THE BUTTON ROW ON PURPOSE. In the row it was the smallest text
           on the dialog and quieter than Cancel, which is the wrong order: for
           somebody who has never been here, this is the control they need.
           The question in front of it is what makes it findable to a person
           scanning the dialog rather than reading it. -->
      <p class="auth-alt" id="authAltRow">
        <span id="authAltAsk">New to StyloPlan?</span>
        <button type="button" id="authSwap" class="link">Create an account</button>
      </p>
    </form>`,document.body.append(p);const e=n=>p.querySelector("#"+n);let a="in",d=!1;const t=n=>{a=n;const s=n==="up",r=n==="reset";e("authTitle").textContent=r?"Reset your password":s?"Create an account":"Sign in",e("authGo").textContent=r?"Send the link":s?"Create account":"Sign in",e("authSwap").textContent=s||r?"Sign in":"Create an account",e("authAltAsk").textContent=r?"Remembered it?":s?"Already have an account?":"New to StyloPlan?",e("authNameRow").hidden=!s,e("authPassRow").hidden=r,e("authGoogle").hidden=r,e("authOr").hidden=r,e("authForgotRow").hidden=n!=="in",e("authPass").autocomplete=s?"new-password":"current-password",e("authMsg").hidden=!0,e("authTermsRow").hidden=!s,e("authTerms").checked=!1,e("authAltRow").hidden=d&&!r,e("authWhy").textContent=r?"Enter the email on your account. We will send a link to choose a new password.":d?"This app is not open for new accounts yet.":s?"New accounts start with one render credit.":"Your projects, brand kits and credits live on your account."},o=(n,s="bad")=>{const r=e("authMsg");r.textContent=n,r.className=`auth-msg ${s}`,r.hidden=!1},m=X({box:e("authCheck"),onAsk:()=>o("One quick check, then you are through.","info")}),g=async()=>{const n=await $();return p.open?m.token(n,document.documentElement.dataset.theme||"auto"):null};return e("authSwap").onclick=()=>t(a==="in"?"up":"in"),e("authForgot").onclick=()=>{t("reset"),e("authEmail").focus()},e("authCancel").onclick=()=>p.close(),e("authGoogle").onclick=async()=>{if(a==="up"&&!e("authTerms").checked)return o("Please accept the terms of service and the privacy policy to create an account.");a==="up"&&Y();const n=e("authGoogle");n.disabled=!0;const s=n.querySelector("span").textContent;n.querySelector("span").textContent="Taking you to Google…";const r=await F();r.error&&(n.disabled=!1,n.querySelector("span").textContent=s,o(`${r.error} Use an email address below instead.`))},p.querySelector("form").addEventListener("submit",async n=>{if(n.preventDefault(),a==="reset"){const h=e("authEmail").value.trim();if(!/^[^\s@]+@[^\s@]+$/.test(h))return o("Enter the email address on your account.");e("authGo").disabled=!0;const i=e("authGo").textContent;e("authGo").textContent="Sending…";const k=await g(),v=k===null?{}:await _(h,k);return e("authGo").disabled=!1,e("authGo").textContent=i,k===null?void 0:v.error?o(v.error):o(`If ${h} has an account, a link to choose a new password is on its way. It can take a few minutes, so check your spam folder too.`,"ok")}const s=e("authEmail").value.trim(),r=e("authPass").value;if(!s||r.length<6)return o("Enter an email and a password of at least 6 characters.");if(a==="up"&&!e("authTerms").checked)return o("Please accept the terms of service and the privacy policy to create an account.");e("authGo").disabled=!0;const c=e("authGo").textContent;e("authGo").textContent="Working…";const b=a==="up",u=e("authName").value.trim(),l=await g(),f=l===null?{}:b?await j(s,r,u,l):await H(s,r,l);if(e("authGo").disabled=!1,e("authGo").textContent=c,l!==null){if(f.closed)return d=!0,t("in"),o(f.error);if(f.error)return o(f.error);if(f.confirmEmail)return o("Check your inbox to confirm the address, then sign in.","ok");p.close()}}),p.addEventListener("close",()=>{m.cancel(),t("in"),p.querySelector("form").reset()}),t("in"),p}export function signOutDestination(e){const a=new URLSearchParams(e||"");return a.get("p")&&a.get("f")?"projects.html":null}function ie(){const e=signOutDestination(location.search);e?location.replace(e):location.reload()}function ce(e,a){return new Promise(d=>{const t=document.createElement("dialog");t.className="auth-dialog";const o=e===a;t.innerHTML=`
      <form method="dialog" class="auth-form">
        <h3>Your account</h3>
        <p class="subtle">Signed in as ${y(a)}.</p>

        <div class="fld-float" style="margin-top:16px">
          <input type="text" id="acctName" autocomplete="name" placeholder=" "
                 value="${o?"":y(e)}" maxlength="80">
          <label for="acctName">Name on your verification reports</label>
        </div>
        <p class="subtle" style="margin-top:6px">${o?"Your reports are signed with your email address because no name is set. A report says a named person checked the dimensions.":"This is the name printed under “Reviewed and confirmed by”."}</p>
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
      </form>`,document.body.append(t);const m=t.querySelector('[data-act="save"]');m.onclick=async()=>{const u=t.querySelector("#acctName"),l=t.querySelector("[data-msg]");m.disabled=!0;const f=m.textContent;m.textContent="Saving…";const h=await V(u.value);if(m.disabled=!1,m.textContent=f,l.hidden=!1,h.error){l.className="auth-msg",l.textContent=h.error;return}l.className="auth-msg ok",l.textContent=`Reports will be signed “${h.name}” from now on. Anything already downloaded keeps the name it was made with.`};const g=t.querySelector("[data-copy-msg]"),n=u=>{g.hidden=!1,g.textContent=u};t.querySelector('[data-act="copy"]').onclick=async u=>{const l=u.currentTarget;l.disabled=!0;try{const{exportBackup:f}=await import("./backup.js?v=a864c479afde");n("Packing…");const h=await f(n),i=document.createElement("a");i.href=URL.createObjectURL(h),i.download=`styloplan-backup-${new Date().toISOString().slice(0,10)}.json`,i.click(),URL.revokeObjectURL(i.href),n(`Copy saved (${(h.size/1048576).toFixed(1)} MB).`)}catch(f){n(`The copy could not be made: ${f.message}`)}finally{l.disabled=!1}};const s=t.querySelector('[data-act="file"]');t.querySelector('[data-act="restore"]').onclick=()=>{s.value="",s.click()},s.onchange=async()=>{const u=s.files[0];if(u)try{const{inspectBackup:l,restoreBackup:f}=await import("./backup.js?v=a864c479afde"),{askConfirm:h}=await import("./ask.js?v=a864c479afde"),i=await l(u),k=i.exportedAt?new Date(i.exportedAt).toLocaleString():"an unknown date";if(!await h({title:"Restore this copy?",body:[`This copy was made on ${k}.`,`Projects: ${i.projects}   Brand kits: ${i.kits}   Images: ${i.images}`,i.overwrites?`${i.overwrites} project${i.overwrites>1?"s":""} already here will be REPLACED, and ${i.adds} added.`:`${i.adds} project${i.adds===1?"":"s"} will be added. Nothing already here is replaced.`],confirm:"Restore",danger:i.overwrites>0})){n("Restore cancelled.");return}const w=await f(i,n);n(`Restored ${w.projects} project${w.projects===1?"":"s"}, ${w.kits} brand kit${w.kits===1?"":"s"} and ${w.images} image${w.images===1?"":"s"}. Reloading…`),setTimeout(()=>location.reload(),1200)}catch(l){n(`Restore failed: ${l.message}`)}};let r=!1;const c=t.querySelector('[data-act="yes"]'),b=t.querySelector("[data-msg]");t.querySelector('[data-act="no"]').onclick=()=>t.close(),c.onclick=async()=>{c.disabled=!0,c.textContent="Saving to your account…",b.hidden=!0;let u=null;try{u=await N.syncCloud()}catch{u=null}if(!u||u.errors.length){c.disabled=!1,c.textContent="Sign out",b.hidden=!1,b.textContent="Your projects could not be saved to your account, so nothing was removed and you are still signed in. Check your connection and try again.";return}r=!0,t.close()},t.addEventListener("close",()=>{d(r),R(t)}),t.showModal(),t.querySelector('[data-act="no"]').focus()})}const A="recovering",C=()=>document.documentElement.classList.remove(A);function le(e){document.documentElement.classList.add(A),p?.open&&p.close();const a=document.createElement("dialog");a.className="auth-dialog",a.innerHTML=`
    <form method="dialog" class="auth-form" novalidate>
      <div class="auth-head">
        <h3>Choose a new password</h3>
        <button type="button" class="btn btn--icon btn--quiet auth-close" data-act="later" aria-label="Later"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <p class="subtle">You opened the link from your email, so you are signed in as ${y(e)}.
      Choose the password you will use from now on.</p>
      <input type="email" autocomplete="username" value="${y(e)}" hidden>
      <div class="fld-float" data-field>
        <input type="password" id="newPass" autocomplete="new-password" placeholder=" " minlength="6" required>
        <label for="newPass">New password</label>
      </div>
      <p class="auth-msg" data-msg role="alert" hidden></p>
      <!-- The sign-in dialog's shape: the way out in the corner, the one action
           the width of the field it saves. -->
      <button type="submit" class="btn btn--primary auth-submit" data-act="save">Save password</button>
    </form>`,document.body.append(a);const d=a.querySelector("[data-msg]"),t=a.querySelector('[data-act="save"]'),o=a.querySelector('[data-act="later"]');let m=!1;o.onclick=()=>a.close(),a.querySelector("form").addEventListener("submit",async g=>{if(g.preventDefault(),m)return a.close();t.disabled=!0;const n=t.textContent;t.textContent="Saving…";const s=await Z(a.querySelector("#newPass").value);if(t.disabled=!1,t.textContent=n,d.hidden=!1,s.error){d.className="auth-msg",d.textContent=s.error;return}m=!0,d.className="auth-msg ok",d.textContent="Your new password is saved. Use it the next time you sign in.",a.querySelector("[data-field]").hidden=!0,o.hidden=!0,t.textContent="Done",t.focus()}),a.addEventListener("close",()=>{z(),C(),R(a)}),a.showModal(),a.querySelector("#newPass").focus()}export function openSignIn(e="in",a=null,d="bad"){const t=re();if(e==="up"&&t.querySelector("#authSwap").click(),a){const o=t.querySelector("#authMsg");o.textContent=a,o.className=`auth-msg ${d}`,o.hidden=!1}t.showModal(),t.querySelector("#authEmail").focus(),$().then(o=>o?ee():null).catch(()=>null)}const L="pr.acctView",de=()=>{try{return JSON.parse(localStorage.getItem(L)||"null")}catch{return null}},x=e=>{try{localStorage.setItem(L,JSON.stringify(e))}catch{}};function E(e,a=""){if(!e.in)return'<button class="btn btn--secondary btn--sm" id="acctIn">Sign in</button>';const d=e.needsName?`${e.name}: add the name that signs your reports`:e.name,t=`<span class="acct-credits-word"> credit${Number(e.credits)===1?"":"s"}</span>`,o=Q()?`<button type="button" class="acct-credits acct-buy${e.low?" low":""}" id="acctBuy" title="Render credits remaining. Buy more" aria-label="${y(e.credits)} credits. Buy more"><span class="acct-credits-n">${y(e.credits)}${t}</span><span aria-hidden="true">+</span></button>`:`<span class="acct-credits${e.low?" low":""}" title="Render credits remaining">${y(e.credits)}${t}</span>`;return a+o+`<button class="btn btn--secondary btn--sm acct-name${e.needsName?" needs-name":""}" id="acctMenu" title="${y(d)}" aria-label="${y(d)}">${y(e.name)}</button>`}export async function mountAccount(e){let a=null;const d=de();if(d){e.innerHTML=E(d),e.hidden=!1;for(const c of e.querySelectorAll("button"))c.onclick=()=>{a=c.id}}if(!await K()){e.hidden=!0;return}M(),ae();let t=!1;const o=ne();let m=!1,g=!1;const n=c=>{!c||m||(m=!0,U(),openSignIn("in",c.message))},s=()=>{const c=a;a=null,c&&e.querySelector(`#${c}`)?.click()},r=({user:c,credits:b,ready:u,sync:l,oauthError:f,recovery:h})=>{if(!u)return;if(e.hidden=!1,n(f),!c){C(),x({in:!1}),e.innerHTML=E({in:!1}),e.querySelector("#acctIn").onclick=()=>openSignIn(),s(),o&&!t&&(t=!0,openSignIn("in",`Sign in, or create an account, to buy ${o.name}. Checkout follows.`,"info"));return}h&&!g?(g=!0,le(c.email)):!h&&!J()&&C();const i=c.user_metadata?.full_name||c.email,k=b??"–",v=typeof b=="number"&&b<=1,w=l&&l.ok===!1?`<button class="btn btn--secondary btn--sm acct-sync-warn" id="acctSync" title="${y(l.message||"")} Your work is safe on this device. Press to try again.">Not in your account &middot; Retry</button>`:l&&l.ok===null?'<span class="acct-sync-warn" id="acctSyncing">Syncing…</span>':"",O=i===c.email,T={in:!0,name:i,credits:k,low:v,needsName:O};x(T),e.innerHTML=E(T,w);const q=e.querySelector("#acctBuy");q&&(q.onclick=()=>te()),h||oe();const S=e.querySelector("#acctSync");S&&(S.onclick=()=>{S.disabled=!0,W()}),e.querySelector("#acctMenu").onclick=async()=>{if(!await ce(i,c.email))return;const I=N.clearLocalWork();for(const P of I)await se(P);x({in:!1}),await D(),ie()},s()};B(r),r(G())}
