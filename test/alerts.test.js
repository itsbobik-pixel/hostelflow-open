import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alert } from '../src/alerts.js';
import { createD1 } from './helpers/d1.js';

test('alerts: one e-mail per kind an hour, the rest counted for the next one; never throws', async () => {
  const mails = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
  try {
    const env = { DB: createD1(), RESEND_API_KEY: 'k', SUPPORT_EMAIL: 'support@example.com' };
    assert.equal(await alert(env, 'scan', 'first'), true);
    assert.equal(await alert(env, 'scan', 'second'), false);
    assert.equal(await alert(env, 'scan', 'third'), false);
    assert.equal(await alert(env, 'server-error', 'other kind'), true);
    assert.equal(mails.length, 2);
    assert.deepEqual(mails[0].to, ['support@example.com']);
    assert.equal(mails[0].subject, 'HostelFlow alert: scan');
    const row = await env.DB.prepare('SELECT missed, last_detail FROM alerts WHERE kind = ?').bind('scan').first();
    assert.deepEqual({ ...row }, { missed: 2, last_detail: 'third' });
    // An hour later the next one goes out and says how many waited.
    await env.DB.prepare('UPDATE alerts SET last_sent_at = last_sent_at - 3600001').run();
    assert.equal(await alert(env, 'scan', 'fourth'), true);
    assert.match(mails[2].text, /2 more like this/);
    // No database: no e-mail, no exception.
    assert.equal(await alert({ RESEND_API_KEY: 'k', SUPPORT_EMAIL: 'x@example.com' }, 'scan', 'x'), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
