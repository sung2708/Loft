package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"loft/backend/internal/domain"
)

type hostCoordinator interface {
	SyncHost(context.Context, string, string, string, string, uint64) (domain.HostAuthority, error)
}

// Presence expiry and host selection share one Redis transaction. No node can
// promote a host based on a partial local participant list.
var syncHostScript = redis.NewScript(`
local now = redis.call('TIME')
local ms = tonumber(now[1])*1000 + tonumber(now[2])/1000
local raw = redis.call('GET',KEYS[2])
local host = raw and cjson.decode(raw) or {version=math.floor(ms),connection_id='',state='failed-over'}
local active = {}
local best = nil
local entries = redis.call('HGETALL',KEYS[1])
for i=1,#entries,2 do
 local lease = cjson.decode(entries[i+1])
 local p = lease.participant
 if tonumber(lease.expires_ms)>ms and p.identity_type=='user' then
  active[p.connection_id]=p
  if not best or (p.identity_id==ARGV[1] and best.identity_id~=ARGV[1]) or
   ((p.identity_id==ARGV[1])==(best.identity_id==ARGV[1]) and
    (p.joined_at<best.joined_at or (p.joined_at==best.joined_at and p.connection_id<best.connection_id))) then best=p end
 end
end
local selected = active[host.connection_id]
if ARGV[3]~='' then
 if not selected or ARGV[2]==ARGV[3] or host.connection_id~=ARGV[2] or (tonumber(ARGV[4])~=0 and tonumber(ARGV[4])~=host.version) or not active[ARGV[3]] then return 'denied' end
 selected=active[ARGV[3]]
elseif not selected then selected=best end
local id = selected and selected.connection_id or ''
local changed = id~=host.connection_id or not raw
if changed then
 host={connection_id=id,identity_id=selected and selected.identity_id or '',identity_type=selected and selected.identity_type or '',generation=0,version=host.version+1,state=selected and 'connected' or 'failed-over'}
end
redis.call('SET',KEYS[2],cjson.encode(host),'PX',1800000)
if changed then
 local packet={origin_instance_id=ARGV[7],event_id=ARGV[6],room_id=ARGV[5],host=host}
 redis.call('PUBLISH',KEYS[3],cjson.encode(packet))
end
return cjson.encode(host)
`)

func (b *RedisBus) SyncHost(ctx context.Context, roomID, ownerID, actor, target string, expected uint64) (domain.HostAuthority, error) {
	raw, err := syncHostScript.Run(ctx, b.client, []string{presenceRoomKey(roomID), "room:" + roomID + ":host", "room:" + roomID + ":events"}, ownerID, actor, target, expected, roomID, uuid.NewString(), b.instanceID).Text()
	if err != nil {
		return domain.HostAuthority{}, err
	}
	if raw == "denied" {
		return domain.HostAuthority{}, errors.New("host transfer is not allowed")
	}
	var host domain.HostAuthority
	err = json.Unmarshal([]byte(raw), &host)
	return host, err
}

func (h *Hub) syncHost(ctx context.Context, room domain.Room, actor, target string, expected uint64) error {
	h.mu.RLock()
	bus, ok := h.bus.(hostCoordinator)
	h.mu.RUnlock()
	if !ok {
		return nil
	}
	host, err := bus.SyncHost(ctx, room.ID, room.OwnerID, actor, target, expected)
	if err != nil {
		return err
	}
	h.DeliverRemote(room.ID, hostEvent(room.ID, host, "presence-reconciled"))
	return nil
}
