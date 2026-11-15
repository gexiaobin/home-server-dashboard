const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

const ensure = (condition, code) => {
  if (!condition) throw new Error(code);
};

export function validateCommit(commit) {
  ensure(SHA.test(commit), 'ghcr_commit_invalid');
  return commit;
}

function repositoryPath(repository) {
  const match = /^ghcr\.io\/([a-z0-9_.-]+\/[a-z0-9_.-]+)$/.exec(repository);
  ensure(match, 'ghcr_repository_invalid');
  return match[1];
}

function basicAuthorization(username, token) {
  ensure(Boolean(username) === Boolean(token), 'ghcr_credentials_incomplete');
  if (!username) return undefined;
  ensure(typeof username === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(username), 'ghcr_username_invalid');
  ensure(typeof token === 'string' && token.length >= 20 && token.length <= 1024 && !/[\s\0]/.test(token), 'ghcr_token_invalid');
  return `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
}

export function registryAuth(username, token) {
  const authorization = basicAuthorization(username, token);
  const value = authorization
    ? { username, password: token, serveraddress: 'ghcr.io' }
    : {};
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

export async function resolveGhcrImage({ repository, commit, username = '', token = '', fetchImpl = fetch }) {
  validateCommit(commit);
  const path = repositoryPath(repository);
  const authorization = basicAuthorization(username, token);
  const tokenUrl = new URL('https://ghcr.io/token');
  tokenUrl.searchParams.set('service', 'ghcr.io');
  tokenUrl.searchParams.set('scope', `repository:${path}:pull`);
  const tokenResponse = await fetchImpl(tokenUrl, {
    headers: authorization ? { Authorization: authorization } : {},
    signal: AbortSignal.timeout(30_000),
  });
  ensure(tokenResponse.ok, `ghcr_token_http_${tokenResponse.status}`);
  const tokenBody = await tokenResponse.json();
  const bearer = tokenBody.token || tokenBody.access_token;
  ensure(typeof bearer === 'string' && bearer.length > 20, 'ghcr_bearer_invalid');
  const tag = `sha-${commit}`;
  const manifestResponse = await fetchImpl(`https://ghcr.io/v2/${path}/manifests/${tag}`, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: ACCEPT },
    signal: AbortSignal.timeout(30_000),
  });
  ensure(manifestResponse.ok, `ghcr_manifest_http_${manifestResponse.status}`);
  const digest = manifestResponse.headers.get('docker-content-digest');
  ensure(digest && DIGEST.test(digest), 'ghcr_manifest_digest_invalid');
  await manifestResponse.arrayBuffer();
  return { commit, tag, digest, repository, reference: `${repository}@${digest}` };
}

export async function pullGhcrImage(client, release, {
  username = '',
  token = '',
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  delays = [0, 10_000, 30_000],
} = {}) {
  ensure(release && DIGEST.test(release.digest) && SHA.test(release.commit), 'ghcr_release_invalid');
  let lastError;
  for (const delay of delays) {
    if (delay) await pause(delay);
    try {
      const output = await client.docker('POST', `/images/create?fromImage=${encodeURIComponent(release.reference)}`, {
        headers: { 'X-Registry-Auth': registryAuth(username, token) },
        responseType: 'text',
        timeoutMs: 900_000,
        maxBytes: 64 * 1024 * 1024,
      });
      for (const line of output.split('\n').map((value) => value.trim()).filter(Boolean)) {
        let event;
        try { event = JSON.parse(line); } catch { throw new Error('ghcr_pull_response_invalid'); }
        ensure(!event.error && !event.errorDetail, 'ghcr_pull_failed');
      }
      const image = await client.docker('GET', `/images/${encodeURIComponent(release.reference)}/json`);
      ensure(image?.Os === 'linux' && ['amd64', 'arm64'].includes(image.Architecture), 'ghcr_image_platform_invalid');
      ensure(image.Config?.Labels?.['org.opencontainers.image.revision'] === release.commit, 'ghcr_image_revision_invalid');
      return image;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`ghcr_pull_retries_exhausted:${lastError?.message || 'unknown'}`);
}
