import assert from 'node:assert/strict';
import test from 'node:test';
import { pullGhcrImage, registryAuth, resolveGhcrImage, validateCommit } from './ghcr-image.mjs';

const commit = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;

test('validateCommit accepts only a complete lowercase commit SHA', () => {
  assert.equal(validateCommit(commit), commit);
  for (const value of ['abc123', 'A'.repeat(40), `${commit}0`]) {
    assert.throws(() => validateCommit(value), /ghcr_commit_invalid/);
  }
});

test('registryAuth uses Docker-compatible standard base64', () => {
  const encoded = registryAuth('release-reader', 'token-token-token-token');
  assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString()), {
    username: 'release-reader',
    password: 'token-token-token-token',
    serveraddress: 'ghcr.io',
  });
  assert.deepEqual(JSON.parse(Buffer.from(registryAuth('', ''), 'base64').toString()), {});
});

test('resolveGhcrImage resolves the immutable digest for the complete SHA tag', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) return new Response(JSON.stringify({ token: 'x'.repeat(32) }), { status: 200 });
    return new Response('{}', { status: 200, headers: { 'docker-content-digest': digest } });
  };
  const result = await resolveGhcrImage({ repository: 'ghcr.io/gexiaobin/home-server-dashboard', commit, fetchImpl });
  assert.equal(result.reference, `ghcr.io/gexiaobin/home-server-dashboard@${digest}`);
  assert.match(requests[0].url, /scope=repository%3Agexiaobin%2Fhome-server-dashboard%3Apull/);
  assert.match(requests[1].url, new RegExp(`/manifests/sha-${commit}$`));
});

test('pullGhcrImage retries and verifies the OCI revision label', async () => {
  let attempts = 0;
  const pauses = [];
  const client = {
    async docker(method) {
      if (method === 'POST') {
        attempts += 1;
        if (attempts < 3) throw new Error('network');
        return '{"status":"Downloaded newer image"}\n';
      }
      return { Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': commit } } };
    },
  };
  const image = await pullGhcrImage(client, { commit, digest, reference: `ghcr.io/gexiaobin/home-server-dashboard@${digest}` }, {
    delays: [0, 10, 30],
    pause: async (value) => pauses.push(value),
  });
  assert.equal(image.Architecture, 'amd64');
  assert.equal(attempts, 3);
  assert.deepEqual(pauses, [10, 30]);
});

test('pullGhcrImage rejects a mismatched source revision', async () => {
  const client = {
    docker: async (method) => method === 'POST'
      ? '{"status":"Image is up to date"}\n'
      : { Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': 'c'.repeat(40) } } },
  };
  await assert.rejects(
    pullGhcrImage(client, { commit, digest, reference: `ghcr.io/gexiaobin/home-server-dashboard@${digest}` }, { delays: [0] }),
    /ghcr_pull_retries_exhausted:ghcr_image_revision_invalid/,
  );
});
