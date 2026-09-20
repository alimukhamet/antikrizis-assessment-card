import {readSessionCookie,verifySession,requestOriginAllowed} from '../lib/worker-session';
import toolsHomeHtml from '../templates/tools-home.html?raw';
/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  SITE_SESSION_TOKEN?: string;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function isAssessmentIntakeMachineRequest(request: Request, url: URL): boolean {
  const segments = url.pathname.split('/');
  const manifest = segments.length === 5
    && segments[1] === 'api'
    && segments[2] === 'assessment'
    && Boolean(segments[3])
    && segments[4] === 'crm-intake'
    && request.method === 'POST';
  const original = segments.length === 7
    && segments[1] === 'api'
    && segments[2] === 'assessment'
    && Boolean(segments[3])
    && segments[4] === 'crm-intake'
    && segments[5] === 'documents'
    && Boolean(segments[6])
    && request.method === 'GET';
  return manifest || original;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // These two exact paths perform their own dedicated HMAC, timestamp,
    // replay and origin checks in the route handlers. Keep the exception
    // narrow so every other API endpoint remains staff-session protected.
    if (isAssessmentIntakeMachineRequest(request, url)) {
      const response = await handler.fetch(request, env, ctx);
      const secured = new Response(response.body, response);
      secured.headers.set('cache-control', 'no-store');
      return secured;
    }
    const protectedPage = ['/', '/assessment-review', '/lawyer-handoff', '/assessment-feedback', '/assessment-card', '/assessment-card.html', '/my-results', '/my-earnings'].includes(url.pathname);
    const protectedApi = url.pathname.startsWith('/api/') && url.pathname !== '/api/session';
    if (protectedPage || protectedApi) {
      const actor = await verifySession(readSessionCookie(request.headers.get('cookie')), env.SITE_SESSION_TOKEN ?? process.env.SITE_SESSION_TOKEN ?? '');
      if (!actor) {
        if(protectedApi)return Response.json({error:'SIGN_IN_REQUIRED'},{status:401,headers:{'cache-control':'no-store'}});
        const login=new URL('/login',url.origin);login.searchParams.set('returnTo',url.pathname+url.search);
        return new Response(null,{status:303,headers:{location:login.toString(),'cache-control':'no-store'}});
      }
      if(!requestOriginAllowed(request))return Response.json({error:'INVALID_ORIGIN'},{status:403,headers:{'cache-control':'no-store'}});
      if(['/assessment-card','/assessment-card.html'].includes(url.pathname))return new Response(toolsHomeHtml,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store'}});
      const response=await handler.fetch(request,env,ctx);
      const secured=new Response(response.body,response);secured.headers.set('cache-control','private, no-store');return secured;
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    if (url.pathname === '/login') {
      const login = new Response(response.body, response);
      login.headers.set('cache-control', 'no-store');
      // Native POST forms need their same-origin Origin header for CSRF checks.
      login.headers.set('referrer-policy', 'same-origin');
      return login;
    }
    return response;
  },
};

export default worker;
