#!/usr/bin/env node
// Seeds a local Bigtable emulator with sample JSON data for development.
//
//   gcloud beta emulators bigtable start --host-port=localhost:8086
//   npm run seed:emulator
//
// Then add project "demo-project" with emulator host localhost:8086 in the app,
// and add instance "demo-instance" (the emulator cannot list instances).
import bigtablePkg from '@google-cloud/bigtable';

const { Bigtable } = bigtablePkg;
const host = process.env.BIGTABLE_EMULATOR_HOST || process.argv[2] || 'localhost:8086';
const bigtable = new Bigtable({ projectId: 'demo-project', apiEndpoint: host, metricsEnabled: false });
const instance = bigtable.instance('demo-instance');

const HOUR = 3600 * 1000;
const now = Date.now();

async function recreate(id, families) {
  const table = instance.table(id);
  const [exists] = await table.exists();
  if (exists) await table.delete();
  await table.create({ families });
  return table;
}

async function seedUsers() {
  const table = await recreate('users', ['profile', 'prefs', 'stats']);
  const names = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Edsger Dijkstra', 'Barbara Liskov'];
  const plans = ['free', 'pro', 'team'];
  for (let i = 0; i < 60; i++) {
    const key = `user#${String(i + 1).padStart(4, '0')}`;
    const name = names[i % names.length];
    const versions = 1 + (i % 4);
    for (let v = versions - 1; v >= 0; v--) {
      const ts = new Date(now - v * 26 * HOUR - i * 60_000);
      await table.insert({
        key,
        data: {
          profile: {
            json: {
              value: JSON.stringify({
                id: i + 1,
                name,
                email: `${name.split(' ')[0].toLowerCase()}${i}@example.com`,
                plan: plans[(i + v) % plans.length],
                address: { city: ['Amsterdam', 'Denver', 'London', 'Tokyo'][i % 4], zip: `${10000 + i * 7}` },
                tags: ['beta', 'newsletter', 'admin'].slice(0, 1 + ((i + v) % 3)),
                active: (i + v) % 5 !== 0,
                updatedBy: v === 0 ? 'api' : 'migration',
              }),
              timestamp: ts,
            },
            status: { value: (i + v) % 5 === 0 ? 'inactive' : 'active', timestamp: ts },
          },
          prefs: i % 3 === 0 ? { theme: { value: JSON.stringify({ mode: v % 2 ? 'light' : 'dark', fontSize: 12 + v }), timestamp: ts } } : {},
        },
      });
    }
    // Counter (8-byte big-endian) like ReadModifyWrite increments produce.
    const counter = Buffer.alloc(8);
    counter.writeBigInt64BE(BigInt(i * 17 + 3));
    await table.insert({ key, data: { stats: { logins: { value: counter, timestamp: new Date(now - i * 1000) } } } });
  }
}

async function seedEvents() {
  const table = await recreate('events', ['e']);
  const types = ['page_view', 'click', 'purchase', 'signup'];
  for (let i = 0; i < 200; i++) {
    const ts = now - i * 7 * 60_000;
    const reverse = String(9_999_999_999_999 - ts);
    await table.insert({
      key: `device-${(i % 5) + 1}#${reverse}`,
      data: {
        e: {
          payload: {
            value: JSON.stringify({ type: types[i % types.length], at: new Date(ts).toISOString(), props: { path: `/products/${i % 13}`, amount: i % 4 === 2 ? (i * 3.17).toFixed(2) : undefined } }),
            timestamp: new Date(ts),
          },
          raw: { value: Buffer.from([0xde, 0xad, 0xbe, 0xef, i & 0xff]), timestamp: new Date(ts) },
        },
      },
    });
  }
}

await instance.table('users').exists(); // fail fast if the emulator is not running
await seedUsers();
await seedEvents();
console.log(`Seeded tables "users" and "events" in demo-project/demo-instance on ${host}`);
process.exit(0);
