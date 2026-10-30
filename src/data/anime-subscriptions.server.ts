import { env as cloudflareEnv } from "cloudflare:workers";

type Env = Record<string, unknown> & { YUME_DB?: unknown; YUME_AUTH_SESSION_SECRET?: string };
type Stmt = { bind(...values: unknown[]): Stmt; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{results:T[]}>; run(): Promise<unknown> };
type DB = { prepare(sql:string):Stmt };
const SESSION_COOKIE="__Host-yume-session";
function env():Env { try { return cloudflareEnv as unknown as Env; } catch { const e=(globalThis as typeof globalThis & {__YUME_RUNTIME_ENV__?:unknown}).__YUME_RUNTIME_ENV__; return e && typeof e==="object" ? e as Env : {}; } }
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}
function cookie(request:Request){for(const p of (request.headers.get("cookie")??"").split(";")){const i=p.indexOf("=");if(i>=0&&p.slice(0,i).trim()===SESSION_COOKIE)return p.slice(i+1).trim()}return ""}
async function tokenHash(value:string,secret:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")}
async function user(request:Request,db:DB,e:Env){const t=cookie(request),s=typeof e.YUME_AUTH_SESSION_SECRET==="string"&&e.YUME_AUTH_SESSION_SECRET.length>=32?e.YUME_AUTH_SESSION_SECRET:"";if(!t||!s)return null;const row=await db.prepare("SELECT s.user_id,s.expires_at FROM yume_sessions s JOIN yume_users u ON u.id=s.user_id WHERE s.token_hash=? AND u.provider='telegram'").bind(await tokenHash(t,s)).first<{user_id:string;expires_at:number}>();return row&&row.expires_at>Date.now()?row.user_id:null}

export async function handleAnimeSubscriptions(request:Request):Promise<Response>{
if(!["GET","POST","DELETE"].includes(request.method))return json({error:"method_not_allowed"},405);
const e=env(),db=e.YUME_DB as DB|undefined;if(!db||typeof db.prepare!=="function")return json({error:"database_unavailable"},503);
try{const userId=await user(request,db,e);if(!userId)return json({error:"authentication_required"},401);
const url=new URL(request.url);let animeId=url.searchParams.get("animeId")??"";
if(request.method==="GET"){const rows=await db.prepare("SELECT anime_id FROM yume_anime_subscriptions WHERE user_id=? AND active=1").bind(userId).all<{anime_id:string}>();return json({authenticated:true,subscriptions:rows.results.map(r=>r.anime_id)})}
if(request.method==="POST"||request.method==="DELETE"){
const raw=await request.text();if(raw.length>2048)return json({error:"request_too_large"},413);let body:unknown;try{body=JSON.parse(raw)}catch{return json({error:"invalid_request"},400)};if(!body||typeof body!=="object")return json({error:"invalid_request"},400);
const obj=body as {animeId?:unknown};animeId=typeof obj.animeId==="string"?obj.animeId:animeId;if(!/^\d{1,20}$/.test(animeId))return json({error:"invalid_anime"},400);
if(request.method==="POST"){const anime=await db.prepare("SELECT status,episodes,episodes_aired FROM anime_catalog WHERE id=?").bind(animeId).first<{status:string;episodes:number;episodes_aired:number}>();if(!anime||anime.status!=="Онгоинг"||(anime.episodes>0&&anime.episodes_aired>=anime.episodes))return json({error:"subscription_unavailable"},409);await db.prepare("INSERT INTO yume_anime_subscriptions(user_id,anime_id,active) VALUES(?,?,1) ON CONFLICT(user_id,anime_id) DO UPDATE SET active=1 WHERE yume_anime_subscriptions.active <> 1").bind(userId,animeId).run();return json({ok:true,subscribed:true})}
await db.prepare("UPDATE yume_anime_subscriptions SET active=0 WHERE user_id=? AND anime_id=? AND active <> 0").bind(userId,animeId).run();return json({ok:true,subscribed:false})}
return json({error:"method_not_allowed"},405)
}catch(error){console.error("[YUME][ANIME_SUBSCRIPTIONS]",error);return json({error:"subscriptions_unavailable"},503)}
}
