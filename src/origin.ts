// Where the Artifact Gallery considers the OpenChamber host reachable.
//
// The service only ever listens on 127.0.0.1, so a page on any other machine
// cannot reach it directly; the host mediates every request with its bearer
// token. These checks are therefore defense-in-depth against a page that is
// *not* being served by this OpenChamber host. The panel is only ever served by
// the host (it is an extension iframe), so its hostname is always one of the
// addresses under which this machine is reachable — loopback, a LAN address or
// a Tailscale (CGNAT) address.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Private / link-local ranges plus Tailscale's CGNAT 100.64.0.0/10.
const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.|169\.254\.)/;
const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$/;

/** True when a browser page served by this OpenChamber host may use the gallery. */
export function isGalleryHostname(hostname: string, extra: ReadonlySet<string> = new Set()): boolean {
  const host = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (LOOPBACK.has(host) || extra.has(host)) return true;
  if (PRIVATE_IP.test(host)) return true;
  // A non-numeric hostname (e.g. "opencode-git", a Tailscale name) resolves to
  // this machine, so it is fine; only a numeric public IP is clearly foreign.
  return !IP_LITERAL.test(host);
}

/**
 * The hostnames/addresses under which this machine can reach itself — its own
 * hostname plus every IPv4 address on its network interfaces. Used to bless
 * the machine's own addresses as gallery hosts regardless of range.
 */
export function ownHostnames(os: { hostname(): string; networkInterfaces(): Record<string, { address: string }[] | undefined> }): Set<string> {
  const names = new Set<string>(String(os.hostname()).toLowerCase().split('.').filter(Boolean));
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) if (item?.address) names.add(String(item.address).toLowerCase().replace(/^\[|\]$/g, ''));
  }
  return names;
}
