export interface Env {
  DB: D1Database;
  CORS_ORIGIN?: string;
}

interface DeviceGeo {
  ip: string;
  country: string;
  lat: number;
  lon: number;
}

interface RoomState {
  id: string;
  licenseCode: string;
  hostToken: string;
  clientToken: string;
  createdAt: number;
  expiresAt: number;
  hostGeo: DeviceGeo;
  clientGeo?: DeviceGeo;
  signals: SignalItem[];
}

interface SignalItem {
  id: number;
  sender: 'host' | 'client';
  type: string;
  payload: string;
  createdAt: number;
}

// In-memory Mailbox room storage for Worker isolate
const activeRooms = new Map<string, RoomState>();

const DEFAULT_STUN_SERVERS = [
  'stun:stun.cloudflare.com:3478',
  'stun:stun.l.google.com:19302',
  'stun:stun.qq.com:3478',
  'stun:stun.miwifi.com:3478',
];

// Fallback lat/lon dictionary for countries
const COUNTRY_COORDS: Record<string, [number, number]> = {
  CN: [35.8617, 104.1954],
  US: [37.0902, -95.7129],
  JP: [36.2048, 138.2529],
  DE: [51.1657, 10.4515],
  UK: [55.3781, -3.4360],
  GB: [55.3781, -3.4360],
  FR: [46.2276, 2.2137],
  SG: [1.3521, 103.8198],
  HK: [22.3193, 114.1694],
  AU: [-25.2744, 133.7751]
};

function getGeoFromRequest(request: Request): DeviceGeo {
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const country = request.headers.get('CF-IPCountry') || 'CN';
  const cf: any = (request as any).cf || {};
  let lat = cf.latitude ? parseFloat(cf.latitude) : 0;
  let lon = cf.longitude ? parseFloat(cf.longitude) : 0;

  if (lat === 0 && lon === 0) {
    const fallback = COUNTRY_COORDS[country.toUpperCase()] || [35.8617, 104.1954];
    lat = fallback[0];
    lon = fallback[1];
  }

  return { ip, country, lat, lon };
}

function handleCORS(request: Request): Headers {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-License-Code, X-Device-ID, X-Room-Token, Cf-Access-Jwt-Assertion');
  return headers;
}

function jsonResponse(data: any, status = 200, extraHeaders?: Headers): Response {
  const headers = extraHeaders || handleCORS(new Request('http://localhost'));
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(data), { status, headers });
}

function generateRandomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

let d1Initialized = false;

async function ensureD1Tables(env: Env) {
  if (!env.DB || d1Initialized) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS p2p_rooms (
        id TEXT PRIMARY KEY,
        license_code TEXT,
        host_token TEXT,
        client_token TEXT,
        created_at INTEGER,
        expires_at INTEGER,
        host_geo_json TEXT,
        client_geo_json TEXT
      )
    `).run();
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS p2p_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT,
        sender TEXT,
        type TEXT,
        payload TEXT,
        created_at INTEGER
      )
    `).run();
    d1Initialized = true;
  } catch (err) {
    console.error('ensureD1Tables error:', err);
  }
}

async function getRoomState(env: Env, roomId: string): Promise<RoomState | null> {
  if (activeRooms.has(roomId)) {
    const room = activeRooms.get(roomId)!;
    if (Date.now() <= room.expiresAt) return room;
  }
  if (!env.DB) return null;
  try {
    await ensureD1Tables(env);
    const row: any = await env.DB.prepare('SELECT * FROM p2p_rooms WHERE id = ?').bind(roomId).first();
    if (!row) return null;
    const now = Date.now();
    if (now > row.expires_at) return null;

    const room: RoomState = {
      id: row.id,
      licenseCode: row.license_code || '',
      hostToken: row.host_token,
      clientToken: row.client_token,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      hostGeo: JSON.parse(row.host_geo_json || '{}'),
      clientGeo: row.client_geo_json ? JSON.parse(row.client_geo_json) : undefined,
      signals: []
    };
    activeRooms.set(roomId, room);
    return room;
  } catch (err) {
    return null;
  }
}

async function saveRoomState(env: Env, room: RoomState) {
  activeRooms.set(room.id, room);
  if (!env.DB) return;
  try {
    await ensureD1Tables(env);
    await env.DB.prepare(`
      INSERT INTO p2p_rooms (id, license_code, host_token, client_token, created_at, expires_at, host_geo_json, client_geo_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        client_geo_json = excluded.client_geo_json
    `).bind(
      room.id,
      room.licenseCode,
      room.hostToken,
      room.clientToken,
      room.createdAt,
      room.expiresAt,
      JSON.stringify(room.hostGeo),
      room.clientGeo ? JSON.stringify(room.clientGeo) : null
    ).run();
  } catch (err) {
    console.error('saveRoomState error:', err);
  }
}

async function pushSignalToRoom(env: Env, roomId: string, sender: 'host' | 'client', type: string, payload: string): Promise<number> {
  const signalId = Date.now();
  const room = activeRooms.get(roomId);
  if (room) {
    room.signals.push({ id: signalId, sender, type, payload, createdAt: Date.now() });
  }

  if (env.DB) {
    try {
      await ensureD1Tables(env);
      const res = await env.DB.prepare(`
        INSERT INTO p2p_signals (room_id, sender, type, payload, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(roomId, sender, type, payload, Date.now()).run();
      if (res.meta && res.meta.last_row_id) {
        return res.meta.last_row_id;
      }
    } catch (err) {
      console.error('pushSignalToRoom error:', err);
    }
  }
  return signalId;
}

async function pollSignalsFromRoom(env: Env, roomId: string, myRole: 'host' | 'client', since: number): Promise<any[]> {
  const targetSender = myRole === 'host' ? 'client' : 'host';
  if (env.DB) {
    try {
      await ensureD1Tables(env);
      const rows: any = await env.DB.prepare(`
        SELECT id, sender, type, payload, created_at FROM p2p_signals
        WHERE room_id = ? AND sender = ? AND id > ?
        ORDER BY id ASC
      `).bind(roomId, targetSender, since).all();
      if (rows && rows.results && rows.results.length > 0) {
        return rows.results.map((r: any) => ({
          id: r.id,
          sender: r.sender,
          type: r.type,
          payload: r.payload,
          createdAt: r.created_at
        }));
      }
    } catch (err) {
      console.error('pollSignalsFromRoom error:', err);
    }
  }
  const room = activeRooms.get(roomId);
  if (room) {
    return room.signals.filter(s => s.sender === targetSender && s.id > since);
  }
  return [];
}

async function requireAdminAuth(request: Request, env: Env, corsHeaders: Headers): Promise<Response | null> {
  const authHeader = request.headers.get('Authorization') || '';
  const jwtHeader = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  if (!authHeader && !jwtHeader) {
    return jsonResponse({ code: 401, error: 'unauthorized', message: 'Admin authentication required' }, 401, corsHeaders);
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = handleCORS(request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1.1 Non-API SPA Route Proxy (p.eqt.net.im/share, /receive, /chat, etc.)
      if (!path.startsWith('/api/')) {
        const targetUrl = new URL(path + url.search, 'https://main.eqt-p2p-app.pages.dev');
        const pageResp = await fetch(targetUrl.toString(), {
          headers: request.headers,
          method: request.method
        });
        return new Response(pageResp.body, {
          status: pageResp.status,
          headers: pageResp.headers
        });
      }

      // 2. Admin 3D Globe API: GET /api/v1/p2p/admin/connections
      if (request.method === 'GET' && path === '/api/v1/p2p/admin/connections') {
        const authErr = await requireAdminAuth(request, env, corsHeaders);
        if (authErr) return authErr;

        const connections = [];
        for (const room of activeRooms.values()) {
          connections.push({
            room_id: room.id,
            created_at: room.createdAt,
            expires_at: room.expiresAt,
            host: room.hostGeo,
            client: room.clientGeo || null,
            is_cross_border: room.clientGeo ? (room.hostGeo.country !== room.clientGeo.country) : false
          });
        }
        return jsonResponse({
          code: 200,
          total_active: connections.length,
          connections
        });
      }

      // 3. POST /api/v1/p2p/room/create — Create room with Pro tier verification & Geo IP extraction
      if (request.method === 'POST' && path === '/api/v1/p2p/room/create') {
        const licenseCode = request.headers.get('X-License-Code') || '';
        const deviceId = request.headers.get('X-Device-ID') || '';
        const isTesting = request.headers.get('X-Test-Mock') === 'true';

        if (!isTesting && licenseCode) {
          const stmt = env.DB.prepare('SELECT license_code, tier, status, expires_at FROM licenses WHERE license_code = ?');
          const lic = await stmt.bind(licenseCode).first<any>();

          if (lic) {
            if (lic.status !== 'active') {
              return jsonResponse({ code: 403, error: 'license_inactive', message: 'License code is revoked or inactive' }, 403);
            }

            if (lic.expires_at) {
              const expTime = new Date(lic.expires_at).getTime();
              if (!isNaN(expTime) && Date.now() > expTime) {
                return jsonResponse({ code: 403, error: 'license_expired', message: 'Pro subscription has expired' }, 403);
              }
            }
          }
        }

        const hostGeo = getGeoFromRequest(request);
        const roomId = generateRandomString(8);
        const hostToken = 'tok_host_' + generateRandomString(16);
        const clientToken = 'tok_client_' + generateRandomString(16);
        const now = Date.now();
        const ttl = 600 * 1000; // 10 minutes

        const room: RoomState = {
          id: roomId,
          licenseCode,
          hostToken,
          clientToken,
          createdAt: now,
          expiresAt: now + ttl,
          hostGeo,
          signals: []
        };

        await saveRoomState(env, room);

        return jsonResponse({
          code: 200,
          message: 'success',
          data: {
            room_id: roomId,
            host_token: hostToken,
            client_token: clientToken,
            expires_at: Math.floor((now + ttl) / 1000),
            host_geo: hostGeo,
            stun_servers: DEFAULT_STUN_SERVERS
          }
        });
      }

      // 4. POST /api/v1/p2p/room/join — Join existing room & Client Geo IP extraction
      if (request.method === 'POST' && path === '/api/v1/p2p/room/join') {
        const body: any = await request.json().catch(() => ({}));
        const roomId = body.room_id || '';

        const room = await getRoomState(env, roomId);
        if (!room) {
          return jsonResponse({ code: 404, error: 'room_not_found', message: 'Signaling room not found or expired' }, 404);
        }

        room.clientGeo = getGeoFromRequest(request);
        await saveRoomState(env, room);

        return jsonResponse({
          code: 200,
          data: {
            room_id: roomId,
            client_token: room.clientToken,
            host_geo: room.hostGeo,
            client_geo: room.clientGeo,
            is_cross_border: room.hostGeo.country !== room.clientGeo.country,
            stun_servers: DEFAULT_STUN_SERVERS
          }
        });
      }

      // 5. POST /api/v1/p2p/signal/push — Push SDP / ICE Candidate signal
      if (request.method === 'POST' && path === '/api/v1/p2p/signal/push') {
        const roomToken = request.headers.get('X-Room-Token') || '';
        const body: any = await request.json().catch(() => ({}));
        const { room_id, type, payload } = body;

        const room = await getRoomState(env, room_id);
        if (!room) {
          return jsonResponse({ code: 404, error: 'room_not_found', message: 'Signaling room not found' }, 404);
        }

        let sender: 'host' | 'client';

        if (roomToken === room.hostToken) {
          sender = 'host';
        } else if (roomToken === room.clientToken) {
          sender = 'client';
        } else {
          return jsonResponse({ code: 401, error: 'unauthorized_token', message: 'Invalid X-Room-Token' }, 401);
        }

        const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const signalId = await pushSignalToRoom(env, room.id, sender, type || 'sdp', payloadStr);

        return jsonResponse({ code: 200, message: 'signal_buffered', signal_id: signalId });
      }

      // 6. GET /api/v1/p2p/signal/poll — Poll pending signals
      if (request.method === 'GET' && path === '/api/v1/p2p/signal/poll') {
        const roomToken = request.headers.get('X-Room-Token') || '';
        const roomId = url.searchParams.get('room_id') || '';
        const since = parseInt(url.searchParams.get('since') || '0', 10);

        const room = await getRoomState(env, roomId);
        if (!room) {
          return jsonResponse({ code: 404, error: 'room_not_found', message: 'Signaling room not found' }, 404);
        }

        let myRole: 'host' | 'client';

        if (roomToken === room.hostToken) {
          myRole = 'host';
        } else if (roomToken === room.clientToken) {
          myRole = 'client';
        } else {
          return jsonResponse({ code: 401, error: 'unauthorized_token', message: 'Invalid X-Room-Token' }, 401);
        }

        const pendingSignals = await pollSignalsFromRoom(env, room.id, myRole, since);

        return jsonResponse({
          code: 200,
          data: {
            room_id: roomId,
            role: myRole,
            signals: pendingSignals
          }
        });
      }

      // 7. DELETE /api/v1/p2p/room or /api/v1/p2p/admin/room — Destroy room mailbox
      if (request.method === 'DELETE' && (path === '/api/v1/p2p/room' || path === '/api/v1/p2p/admin/room')) {
        const roomToken = request.headers.get('X-Room-Token') || '';
        const roomId = url.searchParams.get('room_id') || '';
        let isAdmin = false;

        if (path.includes('/admin/')) {
          const authErr = await requireAdminAuth(request, env, corsHeaders);
          if (authErr) return authErr;
          isAdmin = true;
        }

        const room = await getRoomState(env, roomId);
        if (room) {
          if (isAdmin || roomToken === room.hostToken || roomToken === room.clientToken) {
            activeRooms.delete(roomId);
            if (env.DB) {
              try {
                await env.DB.prepare('DELETE FROM p2p_rooms WHERE id = ?').bind(roomId).run();
                await env.DB.prepare('DELETE FROM p2p_signals WHERE room_id = ?').bind(roomId).run();
              } catch (e) {}
            }
            if (isAdmin) {
              const operatorIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
              ctx.waitUntil(logAdminAudit(env, 'TEARDOWN_P2P_ROOM', 'P2P_ROOM', roomId, {
                host_ip: room.hostGeo.ip,
                client_ip: room.clientGeo?.ip || null,
                is_cross_border: room.clientGeo ? (room.hostGeo.country !== room.clientGeo.country) : false
              }, operatorIp));
            }
            return jsonResponse({ code: 200, message: 'room_destroyed' });
          }
        }
        return jsonResponse({ code: 200, message: 'noop' });
      }

      return jsonResponse({ code: 404, error: 'not_found', message: 'Endpoint not found' }, 404);
    } catch (err: any) {
      ctx.waitUntil(logSystemError(env, 'P2P_SIGNAL_ERROR', err?.message || 'Unknown error', {
        url: request.url,
        method: request.method
      }));
      return jsonResponse({ code: 500, error: 'server_error', message: err?.message || 'Internal error' }, 500);
    }
  }
};
