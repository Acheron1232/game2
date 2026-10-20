# Deploy Temple Wars

Client and server must use the same release/protocol. Host both behind Caddy so `/ws` uses the page's HTTPS origin. Caddy handles the WebSocket upgrade. Do not expose the Node port separately.

## Build and package

Requires Node 24, pnpm 10.33.2 and Docker on the Linux server (ARM64 and x64 supported).

```sh
pnpm install --frozen-lockfile
pnpm data:check
pnpm test
pnpm lint
pnpm build
node deploy/package-release.mjs
cp deploy/remote-start.sh dist/release/
COPYFILE_DISABLE=1 tar --no-xattrs -C dist/release -czf /tmp/temple-wars-release.tgz .
```

The package contains only runtime JS, its locked `ws` dependency, two map-data files, public client assets and deployment config. It contains no source art, SSH keys, local environment files or Git history. The script rejects clients of 100 MiB or more. Current full static client: about 21.2 MB uncompressed; the manifest lists about 14.4 MB.

## VPS

Create a new versioned directory, upload/extract the archive there, and run:

```sh
sudo sh RELEASE_DIRECTORY/remote-start.sh RELEASE_DIRECTORY YOUR_DOMAIN
```

The script validates config, builds `temple-wars:RELEASE`, starts the non-root production server, waits for health and starts the static/reverse-proxy container. Dedicated resources: network `temple-wars`, containers `temple-wars-server` and `temple-wars-web`, certificate volumes `temple-wars-caddy-data` and `temple-wars-caddy-config`. Existing unrelated services are not replaced. Logs rotate at 3 × 10 MB. Automatic restart is enabled.

The domain must resolve to the server. **TCP 80 and 443 must be permitted by both the VPS firewall and the hosting provider's Security List/NSG.** Docker publishing cannot override a provider-level ingress rule. An unreachable ACME challenge cannot issue a valid certificate.

Oracle Cloud: open the instance's attached VNIC/subnet, inspect its NSGs and Security Lists, and add stateful ingress TCP 80 and TCP 443 from `0.0.0.0/0`. Keep existing rules. No SSH or private-key change is required. Then check `curl -I https://YOUR_DOMAIN/` and `curl https://YOUR_DOMAIN/health` without disabling certificate validation.

## Verification and rollback

```sh
sudo docker inspect temple-wars-server --format '{{.State.Health.Status}}'
sudo docker logs --tail 50 temple-wars-server
sudo docker logs --tail 50 temple-wars-web
```

Verify a real two-player match in a browser, including a rejoin, not only `/health`. Reload once to verify cache behavior. Re-run the deployment script with the previous versioned directory to roll back. Keep the old image and directory until the new release has been tested; do not prune unrelated Docker resources.

Matches and sessions live in server memory. Replacing/restarting the server ends running matches. Announce and drain matches before a future update. The host is in the user's existing Oracle region; test round-trip latency from the actual players' locations before selecting another region.

## Temporary HTTPS access when provider ingress is blocked

A Cloudflare Quick Tunnel can proxy the same Caddy HTTP origin on the private Docker network. It gives HTTPS/WSS without an inbound public port. This is a **temporary testing URL**, not a permanent production address; restarting the tunnel can change its hostname. Use direct Caddy HTTPS after ingress opens, or configure a named tunnel and a domain for a stable deployment.

The deployment report records the actual access mode and URL. Never call the temporary tunnel a finished permanent release.

References: [Caddy HTTPS](https://caddyserver.com/docs/quick-starts/https), [Caddy WebSocket proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
