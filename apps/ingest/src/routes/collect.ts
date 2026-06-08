import type { Context } from 'hono';
import { isbot } from 'isbot';
import {
  COLLECTION_TYPE,
  EVENT_TYPE,
  HEATMAP_NORM_SIZE,
  createCacheToken,
  extractWebVitals,
  flattenEventData,
  getSalt,
  getSecret,
  parseToken,
  sendSchema,
  uuid,
  geoFromCf,
  visitSalt,
  type CacheToken,
  type QueueMessage,
  type SendBody,
} from '@flareboard/shared';
import type { Env } from '../env';
import {
  badRequest,
  getClientInfo,
  getSecret as envSecret,
  json,
  safeDecodeURI,
  safeDecodeURIComponent,
  serverError,
} from '../lib/response';
import { getWebsiteById } from '../lib/queries';
import { bumpRealtimeVisitor } from '../lib/realtime-kv';
import { assertEventAllowed, recordEventUsage } from '../lib/hosted-limits';
import { checkIpRateLimit, checkRateLimit, getTrustedClientIp } from '../lib/rate-limit';

function isBot(userAgent: string) {
  if (!userAgent) return false;
  return isbot(userAgent);
}

function heatmapNorm(kind: 'click' | 'scroll', payload: {
  x?: number;
  y?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  scrollDepth?: number;
}) {
  if (kind === 'scroll') {
    const depth = payload.scrollDepth ?? 0;
    const normY = Math.min(HEATMAP_NORM_SIZE - 1, Math.floor((depth / 100) * HEATMAP_NORM_SIZE));
    return { normX: 0, normY, viewportW: 0, viewportH: 0 };
  }
  const vw = payload.viewportWidth ?? 1;
  const vh = payload.viewportHeight ?? 1;
  const normX = Math.min(HEATMAP_NORM_SIZE - 1, Math.floor(((payload.x ?? 0) / vw) * HEATMAP_NORM_SIZE));
  const normY = Math.min(HEATMAP_NORM_SIZE - 1, Math.floor(((payload.y ?? 0) / vh) * HEATMAP_NORM_SIZE));
  return { normX, normY, viewportW: vw, viewportH: vh };
}

function deviceClass(device: string): string {
  if (device === 'mobile' || device === 'tablet' || device === 'desktop') return device;
  return '';
}

async function processSend(
  env: Env,
  req: Request,
  body: SendBody,
  appSecret: string,
): Promise<Response> {
  try {
    const { type, payload } = body;

    if (type === COLLECTION_TYPE.heatmap) {
      const websiteId = payload.website;
      const trustedIp = getTrustedClientIp(req);
      const rl = await checkRateLimit(env, websiteId, trustedIp);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const quota = await assertEventAllowed(env, websiteId);
      if (!quota.ok) {
        return new Response(JSON.stringify({ message: quota.message }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const client = getClientInfoFromRequest(req, {});
      if (isBot(client.userAgent)) return json({ beep: 'boop' });

      const createdAt = payload.timestamp ? new Date(payload.timestamp * 1000) : new Date();
      const base = payload.hostname ? `https://${payload.hostname}` : 'https://localhost';
      const currentUrl = new URL(payload.url || '/', base);
      const urlPath =
        currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname + currentUrl.hash;
      const { normX, normY, viewportW, viewportH } = heatmapNorm(payload.kind, payload);

      const msg: QueueMessage = {
        type: 'heatmap',
        data: {
          websiteId,
          urlPath: safeDecodeURI(urlPath) ?? urlPath,
          kind: payload.kind,
          normX,
          normY,
          deviceClass: deviceClass(client.device),
          viewportW,
          viewportH,
          createdAt: createdAt.getTime(),
        },
      };
      await env.EVENT_QUEUE.send(msg);
      if (quota.userId) await recordEventUsage(env, quota.userId, 1);
      return json({ ok: true });
    }

    const {
      website: websiteId,
      pixel: pixelId,
      link: linkId,
      hostname,
      screen,
      language,
      url,
      referrer,
      name,
      data,
      title,
      tag,
      timestamp,
      id,
      revenue,
      currency,
    } = payload;

    const sourceId = websiteId || pixelId || linkId!;
    const secret = getSecret(appSecret);
    const trustedIp = getTrustedClientIp(req);
    const client = getClientInfoFromRequest(req, payload);

    let cache: CacheToken | null = null;
    let billingUserId = '';
    if (websiteId) {
      const rl = await checkRateLimit(env, websiteId, trustedIp);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const cacheHeader = req.headers.get('x-flareboard-cache');
      if (cacheHeader) {
        const result = await parseToken(cacheHeader, secret);
        if (result) cache = result as unknown as CacheToken;
      }
      if (!cache?.websiteId) {
        const cached = await env.CACHE.get(`website:${websiteId}`);
        if (!cached) {
          const website = await getWebsiteById(env, websiteId);
          if (!website) return badRequest('Website not found.');
          await env.CACHE.put(`website:${websiteId}`, '1', { expirationTtl: 3600 });
        }
      }

      const quota = await assertEventAllowed(env, websiteId);
      if (!quota.ok) {
        return new Response(JSON.stringify({ message: quota.message }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      billingUserId = quota.userId;
    }

    if (isBot(client.userAgent)) {
      return json({ beep: 'boop' });
    }

    const createdAt = timestamp ? new Date(timestamp * 1000) : new Date();
    const now = Math.floor(Date.now() / 1000);
    const sessionSalt = getSalt(createdAt);
    const vSalt = visitSalt(createdAt);

    const sessionId = id
      ? uuid(sourceId, id)
      : uuid(sourceId, client.ip, client.userAgent, sessionSalt);

    let visitId = cache?.visitId || uuid(sessionId, vSalt);
    let iat = cache?.iat || now;

    if (!timestamp && now - iat > 1800) {
      visitId = uuid(sessionId, vSalt);
      iat = now;
    }

    const messages: QueueMessage[] = [];
    let realtimeMeta: {
      urlPath?: string;
      referrerDomain?: string | null;
      country?: string | null;
    } | undefined;

    if (!cache?.sessionId) {
      messages.push({
        type: 'session',
        data: {
          id: sessionId,
          websiteId: sourceId,
          browser: client.browser,
          os: client.os,
          device: client.device,
          screen: screen ?? null,
          language: language ?? null,
          country: client.country,
          region: client.region,
          city: client.city,
          distinctId: id ?? null,
          createdAt: createdAt.getTime(),
        },
      });
    }

    if (type === COLLECTION_TYPE.event) {
      const base = hostname ? `https://${hostname}` : 'https://localhost';
      const currentUrl = new URL(url || '/', base);
      let urlPath =
        currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname + currentUrl.hash;
      const urlQuery = currentUrl.search.substring(1);
      const urlDomain = currentUrl.hostname.replace(/^www\./, '');

      let referrerPath: string | undefined;
      let referrerQuery: string | undefined;
      let referrerDomain: string | undefined;

      const utmSource = currentUrl.searchParams.get('utm_source');
      const utmMedium = currentUrl.searchParams.get('utm_medium');
      const utmCampaign = currentUrl.searchParams.get('utm_campaign');
      const utmContent = currentUrl.searchParams.get('utm_content');
      const utmTerm = currentUrl.searchParams.get('utm_term');
      const gclid = currentUrl.searchParams.get('gclid');
      const fbclid = currentUrl.searchParams.get('fbclid');
      const msclkid = currentUrl.searchParams.get('msclkid');
      const ttclid = currentUrl.searchParams.get('ttclid');
      const lifatid = currentUrl.searchParams.get('li_fat_id');
      const twclid = currentUrl.searchParams.get('twclid');

      if (referrer) {
        const referrerUrl = new URL(referrer, base);
        referrerPath = referrerUrl.pathname;
        referrerQuery = referrerUrl.search.substring(1);
        referrerDomain = referrerUrl.hostname.replace(/^www\./, '');
      }

      const eventType = linkId
        ? EVENT_TYPE.linkEvent
        : pixelId
          ? EVENT_TYPE.pixelEvent
          : name
            ? EVENT_TYPE.customEvent
            : EVENT_TYPE.pageView;

      const eventId = crypto.randomUUID();
      const eventData = data ? flattenEventData(sourceId, eventId, data, createdAt.getTime()) : undefined;

      if (websiteId && eventType === EVENT_TYPE.pageView) {
        realtimeMeta = {
          urlPath: safeDecodeURI(urlPath) ?? urlPath,
          referrerDomain: referrerDomain ?? null,
          country: client.country ?? null,
        };
      }

      messages.push({
        type: 'event',
        data: {
          id: eventId,
          websiteId: sourceId,
          sessionId,
          visitId,
          createdAt: createdAt.getTime(),
          urlPath: safeDecodeURI(urlPath) ?? urlPath,
          urlQuery: urlQuery || null,
          utmSource,
          utmMedium,
          utmCampaign,
          utmContent,
          utmTerm,
          referrerPath: safeDecodeURI(referrerPath) ?? referrerPath ?? null,
          referrerQuery: referrerQuery ?? null,
          referrerDomain: referrerDomain ?? null,
          pageTitle: safeDecodeURIComponent(title) ?? null,
          gclid,
          fbclid,
          msclkid,
          ttclid,
          lifatid,
          twclid,
          eventType,
          eventName: name ?? null,
          tag: tag ?? null,
          hostname: hostname || urlDomain,
        },
        eventData,
      });

      if (websiteId && revenue != null && currency) {
        messages.push({
          type: 'revenue',
          data: {
            id: crypto.randomUUID(),
            websiteId,
            sessionId,
            eventId,
            eventName: name ?? 'pageview',
            currency,
            revenue,
            createdAt: createdAt.getTime(),
          },
        });
      }
    } else if (type === COLLECTION_TYPE.identify && data) {
      const items = flattenEventData(sourceId, sessionId, data, createdAt.getTime())?.map((row) => ({
        id: row.id,
        websiteId: sourceId,
        sessionId,
        dataKey: row.dataKey,
        stringValue: row.stringValue,
        numberValue: row.numberValue,
        dateValue: row.dateValue,
        dataType: row.dataType,
        distinctId: id ?? null,
        createdAt: createdAt.getTime(),
      }));
      if (items?.length) {
        messages.push({ type: 'session_data', data: items });
      }
    } else if (type === COLLECTION_TYPE.performance) {
      const base = hostname ? `https://${hostname}` : 'https://localhost';
      const currentUrl = new URL(url || '/', base);
      const urlPath = currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname;
      const vitals = extractWebVitals(payload);

      messages.push({
        type: 'event',
        data: {
          id: crypto.randomUUID(),
          websiteId: sourceId,
          sessionId,
          visitId,
          createdAt: createdAt.getTime(),
          urlPath,
          pageTitle: safeDecodeURIComponent(title) ?? null,
          eventType: EVENT_TYPE.performance,
          lcp: vitals.lcp,
          inp: vitals.inp,
          cls: vitals.cls,
          fcp: vitals.fcp,
          ttfb: vitals.ttfb,
        },
      });
    }

    if (websiteId) {
      await bumpRealtimeVisitor(env, websiteId, sessionId, realtimeMeta);
    }

    if (messages.length === 1) {
      await env.EVENT_QUEUE.send(messages[0]!);
    } else if (messages.length > 1) {
      await env.EVENT_QUEUE.sendBatch(messages.map((body) => ({ body })));
    }

    if (billingUserId && messages.length) {
      const billable = messages.filter((m) => m.type === 'event' || m.type === 'revenue').length;
      if (billable) await recordEventUsage(env, billingUserId, billable);
    }

    const token = await createCacheToken(
      { websiteId: sourceId, sessionId, visitId, iat },
      getSecret(appSecret),
    );

    return json({ cache: token, sessionId, visitId });
  } catch (e) {
    return serverError(e);
  }
}

function getClientInfoFromRequest(
  req: Request,
  payload: { ip?: string; userAgent?: string; browser?: string; os?: string; device?: string },
) {
  const ip =
    payload.ip ??
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '127.0.0.1';
  const userAgent = payload.userAgent ?? req.headers.get('user-agent') ?? '';
  const geo = geoFromCf((req as Request & { cf?: unknown }).cf);
  const browser = payload.browser ?? parseBrowser(userAgent);
  const os = payload.os ?? parseOs(userAgent);
  const device = payload.device ?? parseDevice(userAgent);
  return { ip, userAgent, browser, os, device, ...geo };
}

function parseBrowser(ua: string): string {
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/edge/i.test(ua)) return 'Edge';
  return 'Unknown';
}

function parseOs(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os/i.test(ua)) return 'macOS';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function parseDevice(ua: string): string {
  if (/mobile/i.test(ua)) return 'mobile';
  if (/tablet/i.test(ua)) return 'tablet';
  return 'desktop';
}

export async function handleSend(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json().catch(() => null);
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  return processSend(c.env, c.req.raw, parsed.data, envSecret(c));
}

export async function handleBatch(c: Context<{ Bindings: Env }>) {
  try {
    const trustedIp = getTrustedClientIp(c.req.raw);
    const batchRl = await checkIpRateLimit(c.env, 'batch', trustedIp);
    if (!batchRl.allowed) {
      return json({ message: 'Rate limit exceeded' }, 429);
    }

    const body = await c.req.json().catch(() => null);
    if (!Array.isArray(body)) return badRequest('Expected array');

    const errors: Array<{ index: number; response: unknown }> = [];
    let index = 0;
    let cache: string | null = null;

    for (const data of body) {
      const parsed = sendSchema.safeParse(data);
      if (!parsed.success) {
        errors.push({ index, response: { message: parsed.error.message } });
        index++;
        continue;
      }

      const headers = new Headers(c.req.raw.headers);
      headers.set('content-type', 'application/json');
      headers.delete('content-length');

      const req = new Request(c.req.url, { method: 'POST', headers, body: JSON.stringify(data) });
      const res = await processSend(c.env, req, parsed.data, envSecret(c));
      const resJson = await res.json();
      if (!res.ok) {
        errors.push({ index, response: resJson });
      } else if (!cache && (resJson as { cache?: string }).cache) {
        cache = (resJson as { cache: string }).cache;
      }
      index++;
    }

    return json({
      size: body.length,
      processed: body.length - errors.length,
      errors: errors.length,
      details: errors,
      cache,
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function handleHeartbeat(c: Context<{ Bindings: Env }>) {
  return json({ ok: true });
}

export function handleRecorder(_c: Context<{ Bindings: Env }>) {
  const script = `(function(){'use strict';
var w=window,d=document,s=d.currentScript;
function ingestOrigin(){if(s&&s.src)try{return new URL(s.src).origin}catch(_){}return location.origin}
function post(body){return fetch(ingestOrigin()+'/api/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true})}
function start(){var website=s&&s.getAttribute('data-website-id');if(!website||!w.rrweb)return;
var sid=sessionStorage.getItem('flareboard.sid');if(!sid){setTimeout(start,300);return;}
var vid=sessionStorage.getItem('flareboard.vid')||sid;
var idx=0,started=Date.now();
w.rrweb.record({emit:function(events){var ended=Date.now();post({type:'record',payload:{website:website,sessionId:sid,visitId:vid,chunkIndex:idx++,events:events,startedAt:started,endedAt:ended}});started=ended}})}
if(d.readyState==='complete')start();else w.addEventListener('load',start);
})();`;

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

export function handleScript(_c: Context<{ Bindings: Env }>) {
  const script = `(function(){'use strict';
/*
 * SPA pageviews: pushState/replaceState/popstate + hash routes (#/path).
 * Declarative events (Umami-compatible):
 *   data-flareboard-event="signup"  OR  data-umami-event="signup"
 *   data-flareboard-event-{prop}="value"  → event property (any common prop name)
 *   data-flareboard-event-tag="cta"  → optional tag
 * Dynamic DOM: MutationObserver re-scans for new/changed data-* attributes.
 * Heatmap: sample rate from data-heatmap-sample-rate or GET /api/tracker-config?website=…
 *   (website heatmapConfig.sampleRate in dashboard). Normalized 0–1000 coords server-side.
 */
var t=window,d=document,l=location,s=sessionStorage,k='flareboard.cache',me=d.currentScript,lastUrl='',hmRate=0.1,hmOn=true,maxScroll=0,scrollKey='flareboard.scroll';
function scriptEl(){if(me)return me;return d.querySelector('script[data-website-id]')}
function p(u,b){return fetch(u,{method:'POST',headers:{'Content-Type':'application/json','x-flareboard-cache':s.getItem(k)||''},body:JSON.stringify(b),keepalive:true})}
function appPath(){var h=l.hash;if(h.length>2&&h.charAt(1)==='/'){var q=h.indexOf('?');return q>=0?h.slice(1,q+1)+h.slice(q+1):h.slice(1)}return l.pathname+l.search}
function routeKey(){return l.pathname+l.search+l.hash}
function r(){return{width:t.innerWidth+'x'+t.innerHeight,language:navigator.language,screen:screen.width+'x'+screen.height,title:d.title,hostname:l.hostname,url:appPath(),referrer:d.referrer}}
function ingestOrigin(){var el=scriptEl();if(el&&el.src)try{return new URL(el.src).origin}catch(_){}return l.protocol+'//'+l.host}
function websiteId(a){var el=a||scriptEl();return el&&el.getAttribute('data-website-id')}
function send(type,payload){return p(ingestOrigin()+'/api/send',{type:type,payload:payload}).then(function(x){return x.json()}).then(function(x){x.cache&&s.setItem(k,x.cache);x.sessionId&&s.setItem('flareboard.sid',x.sessionId);x.visitId&&s.setItem('flareboard.vid',x.visitId);return x})}
function trackEvent(a,extra){var w=websiteId(a);if(!w){console.warn('[flareboard] missing data-website-id');return}var o=r();o.website=w;Object.assign(o,extra||{});return send('event',o)}
function pageview(){trackEvent(scriptEl())}
function onRoute(){var u=routeKey();if(u!==lastUrl){lastUrl=u;maxScroll=0;pageview();collectVitals(scriptEl())}}
function setupSpa(){lastUrl=routeKey();var ps=history.pushState,rs=history.replaceState;history.pushState=function(){ps.apply(history,arguments);onRoute()};history.replaceState=function(){rs.apply(history,arguments);onRoute()};t.addEventListener('popstate',onRoute);t.addEventListener('hashchange',onRoute)}
function eventProps(el){var data={},i,a,n;for(i=0;i<el.attributes.length;i++){a=el.attributes[i];n=a.name;if(n==='data-flareboard-event'||n==='data-umami-event'||n==='data-flareboard-event-tag'||n==='data-umami-event-tag')continue;var m=n.match(/^data-(?:flareboard|umami)-event-(.+)$/);if(m)data[m[1]]=a.value}return data}
function fireDeclEvent(el){var ev=el.getAttribute('data-flareboard-event')||el.getAttribute('data-umami-event');if(!ev)return;var data=eventProps(el),tag=el.getAttribute('data-flareboard-event-tag')||el.getAttribute('data-umami-event-tag');trackEvent(scriptEl(),{name:ev,data:Object.keys(data).length?data:undefined,tag:tag||undefined})}
function onDeclClick(e){var el=e.target;while(el&&el!==d){if(el.getAttribute('data-flareboard-event')||el.getAttribute('data-umami-event')){fireDeclEvent(el);break}el=el.parentElement}}
function hasDeclAttr(el){return el&&el.getAttribute&&(el.getAttribute('data-flareboard-event')||el.getAttribute('data-umami-event'))}
function scanDecl(root){if(!root||!root.querySelectorAll)return;var nodes=root.querySelectorAll?root.querySelectorAll('[data-flareboard-event],[data-umami-event]'):[];for(var i=0;i<nodes.length;i++){var n=nodes[i];if(n._fbDecl)return;n._fbDecl=1;n.addEventListener('click',function(e){fireDeclEvent(e.currentTarget)},true)}}
function setupDeclObserver(){scanDecl(d);try{new MutationObserver(function(muts){for(var i=0;i<muts.length;i++){var m=muts[i];if(m.type==='attributes'&&hasDeclAttr(m.target))scanDecl(m.target.parentElement||d);if(m.addedNodes)for(var j=0;j<m.addedNodes.length;j++){var n=m.addedNodes[j];if(n.nodeType===1)scanDecl(n)}}}).observe(d.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-flareboard-event','data-umami-event','data-flareboard-event-tag','data-umami-event-tag']})}catch(_){}}
function hmSample(){return hmOn&&Math.random()<hmRate}
function sendHeatmap(payload){var w=websiteId();if(!w)return;var o=r();o.website=w;send('heatmap',Object.assign(o,payload))}
function onHmClick(e){if(!hmSample())return;var vw=t.innerWidth,vh=t.innerHeight;if(!vw||!vh)return;sendHeatmap({kind:'click',x:Math.round(e.clientX),y:Math.round(e.clientY),viewportWidth:vw,viewportHeight:vh})}
function scrollDepth(){var docH=Math.max(d.body.scrollHeight,d.documentElement.scrollHeight),vh=t.innerHeight,st=t.scrollY||d.documentElement.scrollTop;return docH<=vh?100:Math.min(100,Math.round((st+vh)/docH*100))}
function onHmScroll(){var depth=scrollDepth(),path=appPath(),key=scrollKey+':'+path,prev=parseInt(s.getItem(key)||'0',10)||0;if(depth<=prev)return;maxScroll=depth;s.setItem(key,String(depth));if(!hmSample())return;sendHeatmap({kind:'scroll',scrollDepth:depth})}
function setupHeatmap(){var scrollTimer;d.addEventListener('click',onHmClick,true);t.addEventListener('scroll',function(){clearTimeout(scrollTimer);scrollTimer=setTimeout(onHmScroll,400)},{passive:true})}
function loadHmConfig(a){var el=a||scriptEl(),attr=el&&el.getAttribute('data-heatmap-sample-rate');if(attr!=null){var r=parseFloat(attr);if(!isNaN(r))hmRate=Math.min(1,Math.max(0,r))}var w=websiteId(el);if(!w)return;fetch(ingestOrigin()+'/api/tracker-config?website='+encodeURIComponent(w)).then(function(x){return x.json()}).then(function(cfg){if(cfg&&typeof cfg.heatmapSampleRate==='number')hmRate=cfg.heatmapSampleRate;if(cfg&&cfg.heatmapEnabled===false)hmOn=false}).catch(function(){})}
function collectVitals(a){if(!t.PerformanceObserver)return;var w=websiteId(a);if(!w)return;try{var o=r();o.website=w;var m={},sent=0,clsV=0;function readTtfb(){try{var n=t.performance.getEntriesByType('navigation')[0];if(n){var s=n.activationStart||0,v=n.responseStart-s;if(v>=0&&v<6e4)return Math.round(v)}}catch(_){}}function readFcp(){try{var p=t.performance.getEntriesByType('paint'),i;for(i=0;i<p.length;i++)if(p[i].name==='first-contentful-paint')return Math.round(p[i].startTime)}catch(_){}}function readLcp(){try{var e=t.performance.getEntriesByType('largest-contentful-paint');if(e.length)return Math.round(e[e.length-1].startTime)}catch(_){}}function has(){return m.lcp!=null||m.inp!=null||m.cls!=null||m.fcp!=null||m.ttfb!=null}function flush(){if(sent)return;if(m.ttfb==null)m.ttfb=readTtfb();if(m.fcp==null)m.fcp=readFcp();if(m.lcp==null)m.lcp=readLcp();if(!has())return;sent=1;if(m.lcp!=null)o.lcp=m.lcp;if(m.inp!=null)o.inp=m.inp;if(m.cls!=null)o.cls=m.cls;if(m.fcp!=null)o.fcp=m.fcp;if(m.ttfb!=null)o.ttfb=m.ttfb;send('performance',o)}try{new PerformanceObserver(function(l){var e=l.getEntries();if(e.length)m.lcp=Math.round(e[e.length-1].startTime)}).observe({type:'largest-contentful-paint',buffered:true})}catch(_){}try{new PerformanceObserver(function(l){var e=l.getEntries(),i;for(i=0;i<e.length;i++)if(e[i].name==='first-contentful-paint')m.fcp=Math.round(e[i].startTime)}).observe({type:'paint',buffered:true})}catch(_){}try{new PerformanceObserver(function(l){var e=l.getEntries();if(e.length)m.inp=Math.round(e[e.length-1].duration)}).observe({type:'event',buffered:true,durationThreshold:40})}catch(_){}try{new PerformanceObserver(function(l){var e=l.getEntries(),i;for(i=0;i<e.length;i++){if(!e[i].hadRecentInput)clsV+=e[i].value}m.cls=Math.round(clsV*1e4)/1e4}).observe({type:'layout-shift',buffered:true})}catch(_){}m.ttfb=readTtfb();m.fcp=readFcp();setTimeout(flush,1e4);function onLeave(){flush()}d.addEventListener('visibilitychange',function(){if(d.visibilityState==='hidden')onLeave()});t.addEventListener('pagehide',onLeave)}catch(_){}}
function init(){var a=scriptEl();if(!websiteId(a))return;loadHmConfig(a);pageview();setupSpa();d.addEventListener('click',onDeclClick,true);setupDeclObserver();setupHeatmap();var api={track:function(n,data,tag){return trackEvent(scriptEl(),{name:n,data:data||undefined,tag:tag||undefined})},identify:function(id,data){var w=websiteId();if(!w)return;return send('identify',{website:w,id:id,data:data||{}})},revenue:function(amount,currency,extra){return trackEvent(scriptEl(),Object.assign({revenue:amount,currency:currency||'USD'},extra||{}))}};t.flareboard=api}
(function(){var a=scriptEl();if(websiteId(a))collectVitals(a)})();
if(d.readyState==='complete')init();else t.addEventListener('load',init);
})();`;

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
