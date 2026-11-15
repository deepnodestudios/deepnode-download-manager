/**
 * Telemetri kapatma (opt-out) regresyon testi.
 *
 * Sentry v11'de varsayılan `traceLifecycle: 'stream'` olduğu için `beforeSendTransaction`
 * yok sayılır; örnekleme kararını `tracesSampler` verir. Bu test, telemetri kapalıyken
 * örneklem oranının 0'a düştüğünü ve hata olaylarının gönderilmediğini doğrular.
 *
 * Gerçek kullanıcı verisine dokunmamak için HOME/USERPROFILE geçici bir klasöre çevrilir
 * ve DSN yerel bir adrese yönlendirilir.
 */
import assert from 'assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

const childMode = process.argv.includes('--child')
  ? process.argv[process.argv.indexOf('--child') + 1]
  : null;

if (childMode) {
  await runChild(childMode);
} else {
  runParent();
}

async function runChild(mode) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ddm-telemetry-'));
  process.env.USERPROFILE = home;
  process.env.HOME = home;

  const dataDir = path.join(home, '.deepnode');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'settings.json'),
    JSON.stringify({ telemetryEnabled: mode !== 'disabled', anonymousId: 'test-anonymous-id' })
  );

  // Gerçek Sentry projesine istek gitmesin diye DSN yerel adrese yönlendirilir.
  process.env.SENTRY_DSN = 'https://publickey@127.0.0.1:9/1';

  const { initSentry, Sentry } = await import('../../backend/src/sentry.js');
  initSentry({ processName: 'test' });

  const client = Sentry.getClient();
  assert.ok(client, 'Sentry istemcisi başlatılmadı');

  const options = client.getOptions();
  assert.equal(typeof options.tracesSampler, 'function', 'tracesSampler tanımlı değil');
  assert.equal(
    options.beforeSendTransaction,
    undefined,
    'beforeSendTransaction v11 stream modunda yok sayılıyor, kullanılmamalı'
  );

  const sampleRate = options.tracesSampler({});
  const eventResult = options.beforeSend({ message: 'test' });
  const clientReportsEnabled = Sentry.getClient().getOptions().sendClientReports;

  if (mode === 'disabled') {
    assert.equal(sampleRate, 0, 'telemetri kapalıyken örneklem oranı 0 olmalı');
    assert.equal(eventResult, null, 'telemetri kapalıyken hata olayı gönderilmemeli');
    assert.equal(
      clientReportsEnabled,
      false,
      'telemetri kapalıyken düşürülen olay sayısı (client report) gönderilmemeli'
    );
  } else {
    assert.equal(sampleRate, 0.1, 'telemetri açıkken örneklem oranı 0.1 olmalı');
    assert.ok(eventResult, 'telemetri açıkken hata olayı korunmalı');
    assert.equal(clientReportsEnabled, true, 'telemetri açıkken client report gönderimi açık kalmalı');
  }

  fs.rmSync(home, { recursive: true, force: true });
  console.log(`OK ${mode}`);
}

function runParent() {
  for (const mode of ['enabled', 'disabled']) {
    const out = execFileSync(process.execPath, [__filename, '--child', mode], {
      encoding: 'utf8',
      env: { ...process.env, SENTRY_DSN: 'https://publickey@127.0.0.1:9/1' }
    });
    assert.match(out, new RegExp(`OK ${mode}`), `child (${mode}) beklenen sonucu vermedi: ${out}`);
  }
  console.log('telemetry-optout: tüm kontroller geçti');
}
