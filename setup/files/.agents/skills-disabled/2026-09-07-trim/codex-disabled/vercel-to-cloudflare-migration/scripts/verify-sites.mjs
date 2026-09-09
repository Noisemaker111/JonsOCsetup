import { readFile } from 'node:fs/promises';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: node verify-sites.mjs <manifest.json>');
  process.exit(2);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const checks = manifest.domains.flatMap((entry) => {
  if (Array.isArray(entry.verification) && entry.verification.length) {
    return entry.verification.map((check) => ({ domain: entry.domain, ...check }));
  }
  return [{
    domain: entry.domain,
    url: `https://${entry.domain}/`,
    expectedStatus: entry.classification === 'intentional-404' ? 404 : undefined
  }];
});

let failures = 0;
for (const check of checks) {
  try {
    const response = await fetch(check.url, {
      redirect: check.followRedirects ? 'follow' : 'manual',
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.text();
    const location = response.headers.get('location');
    const allowedStatuses = check.expectedStatuses ?? (check.expectedStatus == null ? null : [check.expectedStatus]);
    const statusOk = allowedStatuses == null || allowedStatuses.includes(response.status);
    const redirectOk = check.expectedLocation == null || (location ?? '').startsWith(check.expectedLocation);
    const bodyOk = check.expectedSubstring == null || body.includes(check.expectedSubstring);
    const headersOk = check.expectedHeaders == null || Object.entries(check.expectedHeaders)
      .every(([name, value]) => (response.headers.get(name) ?? '').toLowerCase().includes(String(value).toLowerCase()));
    const ok = statusOk && redirectOk && bodyOk && headersOk;
    if (!ok) failures += 1;
    console.log(JSON.stringify({
      domain: check.domain,
      url: check.url,
      status: response.status,
      location,
      server: response.headers.get('server'),
      ok
    }));
  } catch (error) {
    failures += 1;
    console.log(JSON.stringify({ domain: check.domain, url: check.url, ok: false, error: String(error) }));
  }
}

process.exitCode = failures ? 1 : 0;
