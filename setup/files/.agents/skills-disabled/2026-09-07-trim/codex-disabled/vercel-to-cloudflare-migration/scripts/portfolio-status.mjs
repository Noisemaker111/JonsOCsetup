import { readFile } from 'node:fs/promises';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node portfolio-status.mjs <manifest.json>');
  process.exit(2);
}

const data = JSON.parse(await readFile(path, 'utf8'));
if (!Array.isArray(data.domains)) throw new Error('manifest.domains must be an array');

const validClasses = new Set(['application', 'redirect', 'intentional-404', 'inactive', 'blocked']);
const counts = {};
const problems = [];

for (const item of data.domains) {
  const domain = item.domain || '<missing-domain>';
  const classification = item.classification || 'unclassified';
  counts[classification] = (counts[classification] || 0) + 1;
  if (!item.domain) problems.push(`${domain}: missing domain`);
  if (!validClasses.has(item.classification)) problems.push(`${domain}: classification required`);
  if (item.classification === 'inactive') continue;
  if (!item.target?.serviceType || !item.target?.name) problems.push(`${domain}: target incomplete`);
  if (item.dns?.parity !== 'verified') problems.push(`${domain}: DNS parity not verified`);
  if (item.dns?.mailParity !== 'verified') problems.push(`${domain}: mail parity not verified`);
  for (const blocker of item.blockers || []) problems.push(`${domain}: BLOCKER ${typeof blocker === 'string' ? blocker : JSON.stringify(blocker)}`);
}

const active = data.domains.filter((d) => d.classification !== 'inactive');
const deployed = active.length > 0 && active.every((d) => d.target?.serviceType && d.target?.name);
const dnsReady = deployed && active.every((d) => d.dns?.parity === 'verified' && d.dns?.mailParity === 'verified');
const cutoverDone = dnsReady && active.every((d) => d.cutover?.authoritativeConfirmed === true && d.cutover?.routeResult === 'verified');
const verified = cutoverDone && active.every((d) => Array.isArray(d.verification) && d.verification.some((v) => v.result === 'pass'));
const phase = !deployed ? 'inventory-deploy' : !dnsReady || !cutoverDone ? 'dns-cutover' : !verified ? 'verification' : 'retirement';

console.log(JSON.stringify({
  migration: data.migration?.name || null,
  recordedStatus: data.migration?.status || null,
  phase,
  domains: data.domains.length,
  classifications: counts,
  problemCount: problems.length,
  problems
}, null, 2));

process.exitCode = problems.length ? 1 : 0;
