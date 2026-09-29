/**
 * The session recorder served at /recorder.js. Owned by the replay stream (see
 * docs/parity/CONVENTIONS.md). It needs rrweb on the page (`window.rrweb`, the UMD build) and
 * script.js for the session and visit ids. Fake-browser tests: apps/ingest/test-node/recorder.test.ts.
 *
 * Behavior (documented here so none of it ships to browsers):
 * - Settings come from /api/tracker-config (`replay`, see replaySettings in
 *   routes/tracker-config.ts). If the config cannot be loaded, the safe defaults apply.
 * - Consent: nothing is recorded while the visitor has opted out through the tracker
 *   (`flareboard.opt_out` in localStorage, set by flareboard.optOut()), and an opt-out during
 *   the visit stops the recording and discards what was not sent yet. Do Not Track / Global
 *   Privacy Control stop recording when the website respects them (tracker-config `respectDnt`)
 *   or a script tag carries data-respect-dnt (data-respect-dnt="false" on this tag overrides).
 * - Inputs: every input value goes through maskInputFn. Values are masked unless the website
 *   turned input masking off, and even then password, hidden, payment / one-time-code
 *   autocomplete, sensitive-looking names and anything inside a mask selector stay masked.
 * - Text: `maskAllText` masks every text node. Otherwise text inside [data-fb-mask], .fb-mask,
 *   .ph-mask and the website's mask selectors is masked (same length, `*`).
 * - Blocking: [data-fb-no-capture], .ph-no-capture, [data-fb-block], .fb-block, .ph-block and the
 *   website's block selectors are never recorded; rrweb keeps a placeholder of the same size.
 *   Invalid website selectors are ignored, the built-in ones always apply.
 * - Console (opt-in `console`): log / info / warn / error / debug calls plus uncaught errors and
 *   unhandled rejections become `$console` custom events { level, message }. Messages are at
 *   most 1000 characters, with e-mail addresses, card-like numbers, JWTs, `password=` style
 *   secrets and URL query strings replaced. At most 300 per page.
 * - Network (opt-in `network`): fetch and XMLHttpRequest calls become `$network` custom events
 *   { method, url, status, duration, size, failed }. The URL has no query string or fragment and
 *   long opaque path segments are replaced by ':redacted'. Headers and bodies are never read;
 *   size comes from Resource Timing when the browser exposes it. Requests to the ingest origin
 *   are skipped. At most 500 per page.
 * - Sampling: sampleRate is decided once per visit (sessionStorage). minDurationMs holds the
 *   first chunk until the visit has lasted that long; visits that end sooner send nothing.
 * - Chunks: emitted events are posted to /api/record every 5 s, every 200 events and on
 *   pagehide / hidden (keepalive). chunkIndex is a per-visit counter in sessionStorage so later
 *   page loads in the same visit keep appending.
 */
export const RECORDER_SCRIPT = String.raw`(function(){'use strict';
var w=window,d=document,nv=navigator,loc=location,me=d.currentScript,rawFetch=w.fetch,optKey='flareboard.opt_out',
BLOCK='[data-fb-no-capture],.ph-no-capture,[data-fb-block],.fb-block,.ph-block',MASK='[data-fb-mask],.fb-mask,.ph-mask',
SENS=/pass(word|wd|code|phrase)?([^a-z]|$)|pwd|secret|token|(^|[^a-z])(otp|ssn|pin|cvc|cvv|csc|iban)([^a-z]|$)|one.?time|social.?sec|credit.?card|card.?(num|no([^a-z]|$))|cc.?(num|exp)|routing.?(num|no)|account.?(num|no([^a-z]|$))/i,
EMAIL=/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,tries=0;
function store(kind){try{return w[kind]||null}catch(_){return null}}
function get(kind,key){try{var x=store(kind);return x?x.getItem(key):null}catch(_){return null}}
function sget(key){return get('sessionStorage',key)}
function sset(key,value){try{var x=store('sessionStorage');if(x)x.setItem(key,value)}catch(_){}}
function ingestOrigin(){if(me&&me.src)try{return new URL(me.src).origin}catch(_){}return loc.origin}
function send(url,init){return (rawFetch||w.fetch).call(w,url,init)}
function post(body,unloading){var b=JSON.stringify(body);return send(ingestOrigin()+'/api/record',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:!!unloading&&b.length<60000}).catch(function(){})}
function loadCfg(website){return send(ingestOrigin()+'/api/tracker-config?website='+encodeURIComponent(website)).then(function(x){return x&&x.ok?x.json():null}).catch(function(){return null})}
function optedOut(){return get('localStorage',optKey)==='1'}
function dntSignal(){var v=nv.doNotTrack||w.doNotTrack||nv.msDoNotTrack;return v==='1'||v==='yes'||nv.globalPrivacyControl===true}
function respectDnt(c){var v=me&&me.getAttribute('data-respect-dnt'),el;if(v!=null)return v!=='false';try{el=d.querySelector('script[data-respect-dnt]')}catch(_){}if(el)return el.getAttribute('data-respect-dnt')!=='false';return !!(c&&c.respectDnt===true)}
function validSel(sel){if(typeof sel!=='string'||!sel)return'';try{d.querySelector(sel);return sel}catch(_){return''}}
function join(a,b){return a&&b?a+','+b:a||b}
function within(el,sel){try{return !!(el&&el.closest&&el.closest(sel))}catch(_){return false}}
function attrOf(el,name){return(el&&el.getAttribute&&el.getAttribute(name))||''}
function sensitive(el){var type=attrOf(el,'type').toLowerCase(),ac=attrOf(el,'autocomplete').toLowerCase();return type==='password'||type==='hidden'||/^cc-|one-time-code|password/.test(ac)||SENS.test(attrOf(el,'name')+' '+attrOf(el,'id')+' '+attrOf(el,'placeholder'))}
function stars(text){return new Array(String(text||'').length+1).join('*')}
function recordOptions(r){var maskAll=r.maskInputs!==false,mask=join(MASK,validSel(r.maskSelector));return{
maskAllInputs:true,
maskInputFn:function(text,el){return maskAll||!el||sensitive(el)||within(el,mask)?stars(text):text},
maskTextSelector:r.maskAllText===true?'*':mask,
blockSelector:join(BLOCK,validSel(r.blockSelector))}}
function clip(s,n){s=String(s);return s.length>n?s.slice(0,n)+'…':s}
function scrub(s){return String(s).replace(EMAIL,'[email]').replace(/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g,'[token]').replace(/\b(?:\d[ -]?){12,18}\d\b/g,'[number]').replace(/((?:pass(?:word)?|pwd|token|secret|api[_-]?key|auth(?:orization)?|cookie|session)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,'$1[redacted]').replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g,'$1')}
function fmt(a){if(typeof a==='string')return a;if(a&&typeof a==='object'&&typeof a.message==='string'&&typeof a.name==='string')return a.name+': '+a.message;try{var j=JSON.stringify(a);return j===undefined?String(a):j}catch(_){return String(a)}}
function now(){var p=w.performance;return p&&p.now?p.now():Date.now()}
function cleanUrl(raw,origin){try{var x=new URL(String(raw),loc.href);if(x.protocol!=='http:'&&x.protocol!=='https:'||x.origin===origin)return null;return clip(x.origin+x.pathname.split('/').map(function(seg){var t=seg;try{t=decodeURIComponent(seg)}catch(_){}return seg.length>=24&&/^[\w.~-]+$/.test(seg)||t.indexOf('@')>=0?':redacted':seg}).join('/'),500)}catch(_){return null}}
function sizeOf(raw){try{var p=w.performance,list=p&&p.getEntriesByName?p.getEntriesByName(new URL(String(raw),loc.href).href):[],e=list&&list[list.length-1];if(e)return e.transferSize||e.encodedBodySize||null}catch(_){}return null}
function hookConsole(emit){var c=w.console,n=0;function add(level,msg){if(n>=300)return;n++;emit('$console',{level:level,message:clip(scrub(msg),1000)})}
if(c)['log','info','warn','error','debug'].forEach(function(level){var orig=c[level];if(typeof orig!=='function')return;c[level]=function(){try{var parts=[],i;for(i=0;i<arguments.length&&i<10;i++)parts.push(clip(fmt(arguments[i]),500));add(level,parts.join(' '))}catch(_){}return orig.apply(this,arguments)}});
w.addEventListener('error',function(e){try{add('error','Uncaught '+(e&&e.error?fmt(e.error):e&&e.message||'error'))}catch(_){}});
w.addEventListener('unhandledrejection',function(e){try{add('error','Unhandled rejection: '+fmt(e&&e.reason))}catch(_){}})}
function hookNetwork(emit){var n=0,origin=ingestOrigin(),X=w.XMLHttpRequest&&w.XMLHttpRequest.prototype,of=w.fetch;
function report(method,raw,status,t0,failed){if(n>=500)return;var url=cleanUrl(raw,origin);if(!url)return;n++;emit('$network',{method:String(method||'GET').toUpperCase().slice(0,10),url:url,status:status||0,duration:Math.max(0,Math.round(now()-t0)),size:sizeOf(raw),failed:!!failed})}
if(typeof of==='function')w.fetch=function(input,init){var t0=now(),method=init&&init.method||input&&typeof input==='object'&&input.method||'GET',url=typeof input==='string'?input:input&&(input.url||input.href)||String(input),p=of.apply(this,arguments);try{p.then(function(res){report(method,url,res&&res.status,t0,false)},function(){report(method,url,0,t0,true)})}catch(_){}return p};
if(X&&X.open&&X.send){var open=X.open,xsend=X.send;X.open=function(m,u){this.__fbReq=[m,u];return open.apply(this,arguments)};X.send=function(){var x=this,info=x.__fbReq,t0=now();if(info&&x.addEventListener)x.addEventListener('loadend',function(){report(info[0],info[1],x.status,t0,!x.status)});return xsend.apply(this,arguments)}}}
function start(){var website=me&&me.getAttribute('data-website-id');if(!website||!w.rrweb||typeof w.rrweb.record!=='function'||optedOut())return;
var sid=sget('flareboard.sid');if(!sid){if(++tries<200)setTimeout(start,300);return}
var vid=sget('flareboard.vid')||sid;
loadCfg(website).then(function(c){var r=c&&c.replay||{};if(optedOut()||dntSignal()&&respectDnt(c))return;
var sampleKey='flareboard.rec.sample.'+vid,pick=sget(sampleKey);
if(pick===null){var rate=typeof r.sampleRate==='number'?r.sampleRate:1;pick=Math.random()<rate?'1':'0';sset(sampleKey,pick)}
if(pick==='1')begin(website,sid,vid,r)})}
function begin(website,sid,vid,r){
var rec=w.rrweb.record,idxKey='flareboard.rec.'+vid,startKey='flareboard.rec.start.'+vid,buf=[],started=Date.now(),stop=null,timer=null,
minMs=Math.max(0,Number(r.minDurationMs)||0),visitStart=parseInt(sget(startKey)||'',10);
if(!visitStart){visitStart=Date.now();sset(startKey,String(visitStart))}
function sentAny(){return(parseInt(sget(idxKey)||'0',10)||0)>0}
function nextIdx(){var n=parseInt(sget(idxKey)||'0',10)||0;sset(idxKey,String(n+1));return n}
function halt(){var s=stop;stop=null;buf=[];if(timer)clearInterval(timer);timer=null;if(s)try{s()}catch(_){}}
function flush(unloading){if(!stop)return;if(optedOut()){halt();return}if(!buf.length)return;
if(minMs&&!sentAny()&&Date.now()-visitStart<minMs)return;
var events=buf,ended=Date.now();buf=[];post({type:'record',payload:{website:website,sessionId:sid,visitId:vid,chunkIndex:nextIdx(),events:events,startedAt:started,endedAt:ended}},unloading);started=ended}
function custom(tag,payload){if(!stop)return;try{if(typeof rec.addCustomEvent==='function'){rec.addCustomEvent(tag,payload);return}}catch(_){}buf.push({type:5,timestamp:Date.now(),data:{tag:tag,payload:payload}})}
var options=recordOptions(r);
options.emit=function(e){if(!stop&&stop!==undefined)return;buf.push(e);if(buf.length>=200)flush(false)};
stop=undefined;
try{stop=rec(options)||function(){}}catch(_){stop=null;return}
if(r.console===true)hookConsole(custom);
if(r.network===true)hookNetwork(custom);
timer=setInterval(function(){flush(false)},5000);
w.addEventListener('pagehide',function(){flush(true)});
d.addEventListener('visibilitychange',function(){if(d.visibilityState==='hidden')flush(true)})}
if(d.readyState==='complete')start();else w.addEventListener('load',start);
})();`;
