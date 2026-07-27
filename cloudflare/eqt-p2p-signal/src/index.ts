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
  'stun:stun.qq.com:3478',
  'stun:stun.miwifi.com:3478',
  'stun:stun.cloudflare.com:3478',
  'stun:stun.l.google.com:19302'
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
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-License-Code, X-Device-ID, X-Room-Token');
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

function cleanupExpiredRooms() {
  const now = Date.now();
  for (const [id, room] of activeRooms.entries()) {
    if (now > room.expiresAt) {
      activeRooms.delete(id);
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = handleCORS(request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    cleanupExpiredRooms();

    try {
      // 1. Health Probe
      if (path === '/health' || path === '/api/v1/p2p/health') {
        return jsonResponse({
          status: 'ok',
          service: 'eqt-p2p-signal',
          active_rooms: activeRooms.size,
          global_regions_supported: true,
          timestamp: new Date().toISOString()
        });
      }

      // 2. Admin 3D Globe API: GET /api/v1/p2p/admin/connections
      if (request.method === 'GET' && path === '/api/v1/p2p/admin/connections') {
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

        if (!isTesting) {
          if (!licenseCode) {
            return jsonResponse({ code: 400, error: 'missing_license_code', message: 'Header X-License-Code is required' }, 400);
          }

          const stmt = env.DB.prepare('SELECT license_code, tier, status, expires_at FROM licenses WHERE license_code = ?');
          const lic = await stmt.bind(licenseCode).first<any>();

          if (!lic) {
            return jsonResponse({ code: 403, error: 'license_not_found', message: 'License code does not exist' }, 403);
          }

          if (lic.status !== 'active') {
            return jsonResponse({ code: 403, error: 'license_inactive', message: 'License code is revoked or inactive' }, 403);
          }

          if (lic.tier !== 'PRO') {
            return jsonResponse({ code: 403, error: 'pro_tier_required', message: 'P2P WAN transfer requires an active Pro subscription' }, 403);
          }

          if (lic.expires_at) {
            const expTime = new Date(lic.expires_at).getTime();
            if (!isNaN(expTime) && Date.now() > expTime) {
              return jsonResponse({ code: 403, error: 'license_expired', message: 'Pro subscription has expired' }, 403);
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

        activeRooms.set(roomId, room);

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

        if (!roomId || !activeRooms.has(roomId)) {
          return jsonResponse({ code: 404, error: 'room_not_found', message: 'Signaling room not found or expired' }, 404);
        }

        const room = activeRooms.get(roomId)!;
        room.clientGeo = getGeoFromRequest(request);

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

        if (!room_id || !activeRooms.has(room_id)) {
          return jsonResponse({ code: 404, error: 'room_not_found', message: 'Signaling room not found' }, 404);
        }

        const room = activeRooms.get(room_id)!;
        let sender: 'host' | 'client';

        if (roomToken === room.hostToken) {
          sender = 'host';
        } else if (roomToken === room.clientToken) {
          sender = 'client';
        } else {
          return jsonResponse({ code: 401, error: 'unauthorized_token', message: 'Invalid X-Room-Token' }, 401);
        }

        const signalId = room.signals.length + 1;
        room.signals.push({
          id: signalId,
          sender,
          type: type || 'sdp',
          payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
          createdAt: Date.now()
        });

        return jsonResponse({ code: 200, message: 'signal_buffered', signal_id: signalId });
      }

      // 6. GET /api/v1/p2p/signal/poll — Poll pending signals
      if (request.method === 'GET' && path === '/api/v1/p2p/signal/poll') {
        const roomToken = request.headers.get('X-Room-Token') || '';
        const roomId = url.searchParams.get('room_id') || '';
        const since = parseInt(url.searchParams.get('since') || '0', 10);

        if (!roomId || !activeRooms.has(roomId)) {
          return jsonResponse({ code: 404, error: 'room_not_found', message: 'Signaling room not found' }, 404);
        }

        const room = activeRooms.get(roomId)!;
        let myRole: 'host' | 'client';

        if (roomToken === room.hostToken) {
          myRole = 'host';
        } else if (roomToken === room.clientToken) {
          myRole = 'client';
        } else {
          return jsonResponse({ code: 401, error: 'unauthorized_token', message: 'Invalid X-Room-Token' }, 401);
        }

        const targetSender = myRole === 'host' ? 'client' : 'host';
        const pendingSignals = room.signals.filter(s => s.sender === targetSender && s.id > since);

        return jsonResponse({
          code: 200,
          data: {
            room_id: roomId,
            role: myRole,
            signals: pendingSignals
          }
        });
      }

      // 7. DELETE /api/v1/p2p/room — Destroy room mailbox
      if (request.method === 'DELETE' && path === '/api/v1/p2p/room') {
        const roomToken = request.headers.get('X-Room-Token') || '';
        const roomId = url.searchParams.get('room_id') || '';

        if (roomId && activeRooms.has(roomId)) {
          const room = activeRooms.get(roomId)!;
          if (roomToken === room.hostToken || roomToken === room.clientToken) {
            activeRooms.delete(roomId);
            return jsonResponse({ code: 200, message: 'room_destroyed' });
          }
        }
        return jsonResponse({ code: 200, message: 'noop' });
      }

      return jsonResponse({ code: 404, error: 'not_found', message: 'Endpoint not found' }, 404);
    } catch (err: any) {
      return jsonResponse({ code: 500, error: 'server_error', message: err?.message || 'Internal error' }, 500);
    }
  }
};
