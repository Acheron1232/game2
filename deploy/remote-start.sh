#!/bin/sh
set -eu

release_dir=$(realpath "$1")
domain=$2
mode=${3:-direct}
release=$(basename "$release_dir")
case "$release" in *[!a-zA-Z0-9_.-]*) exit 2 ;; esac
image="temple-wars:$release"
docker build -t "$image" "$release_dir"
docker run --rm -e GAME_DOMAIN="$domain" -v "$release_dir/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker network inspect temple-wars >/dev/null 2>&1 || docker network create temple-wars
docker volume inspect temple-wars-caddy-data >/dev/null 2>&1 || docker volume create temple-wars-caddy-data
docker volume inspect temple-wars-caddy-config >/dev/null 2>&1 || docker volume create temple-wars-caddy-config

# Only these two dedicated app containers are replaced. Other projects stay untouched.
docker rm -f temple-wars-server >/dev/null 2>&1 || true
docker run -d --name temple-wars-server --network temple-wars --restart unless-stopped -e GAME_RELEASE="$release" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges \
  --memory 2g --log-opt max-size=10m --log-opt max-file=3 "$image"
ready=0
for attempt in $(seq 1 30); do
  if docker exec temple-wars-server node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
docker rm -f temple-wars-web >/dev/null 2>&1 || true
if [ "$mode" = quick ]; then
  domain=http://:8080
  ports=
else
  ports='-p 80:80 -p 443:443'
fi
# Intentional word splitting: the only possible values are the fixed flags above or empty.
docker run -d --name temple-wars-web --network temple-wars --restart unless-stopped \
  $ports -e GAME_DOMAIN="$domain" \
  -v "$release_dir/client:/srv:ro" -v "$release_dir/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v temple-wars-caddy-data:/data -v temple-wars-caddy-config:/config \
  --log-opt max-size=10m --log-opt max-file=3 caddy:2-alpine
if [ "$mode" = quick ] && ! docker inspect temple-wars-tunnel >/dev/null 2>&1; then
  docker run -d --name temple-wars-tunnel --network temple-wars --restart unless-stopped \
    --log-opt max-size=10m --log-opt max-file=3 cloudflare/cloudflared:latest \
    tunnel --no-autoupdate --protocol http2 --url http://temple-wars-web:8080
fi
docker exec temple-wars-server node -e "fetch('http://127.0.0.1:8787/health').then(r=>r.text()).then(console.log)"
