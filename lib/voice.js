

// Callers are the same Spanish-speaking audience the SMS campaigns target, so
// every prompt is Spanish. This has no bearing on the English-only sample
// messages registered for 10DLC campaign VCBCFN4Y — that requirement covers SMS
// samples, not voice prompts.
const VOICE_LANG = 'es-US';

// Read digits one at a time so TTS says "nueve dos cinco" and not "novecientos
// veinticinco".
function spellDigits(number) {
  if (number == null) return '';
  const digits = String(number).replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return String(number);
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)]
    .map(part => part.split('').join(' '))
    .join(', ');
}
function parseTarget(env = {}) {
  const raw = env.VOICE_CONNECT || '';
  const [type, value] = raw.split(':');
  if (!type || !value) return null;
  if (type === 'vbc') return { type: 'vbc', extension: String(value) };
  if (type === 'phone') return { type: 'phone', number: String(value) };
  return null;
}

function buildNCCO(env = {}) {
  const target = parseTarget(env);
  const spoken = spellDigits(env.VOICE_FALLBACK_NUMBER || '19256658003');

  // Nothing configured: answer with something useful rather than dropping the
  // caller into silence.
  if (!target) {
    return [{
      action: 'talk',
      language: VOICE_LANG,
      text: `Gracias por llamar a Brinteva Worlds. Para comunicarse con un asesor de viajes, por favor llame al ${spoken}, o responda a nuestro mensaje de texto y le contactaremos.`
    }];
  }

  const ncco = [];

  // The Auto Attendant plays its own greeting, so ours would be the second one
  // a caller hears. Only greet when connecting somewhere that answers silently
  // (a seller group), and only if explicitly asked for.
  if (String(env.VOICE_GREETING) === '1') {
    ncco.push({
      action: 'talk',
      language: VOICE_LANG,
      text: 'Gracias por llamar a Brinteva Worlds. Le comunicamos con un asesor de viajes.'
    });
  }

  const connect = {
    action: 'connect',
    timeout: Number(env.VOICE_RING_TIMEOUT) || 90,
    endpoint: [target]
  };
  // A phone endpoint requires `from` to be a number we own, so the far end sees
  // our number rather than the caller's. A vbc endpoint routes internally and is
  // left without `from` for the best chance of showing the real caller ID.
  if (target.type === 'phone' && env.VONAGE_NUMBER) {
    connect.from = String(env.VONAGE_NUMBER);
  }
  if (env.VOICE_EVENT_URL) {
    connect.eventUrl = [env.VOICE_EVENT_URL];
  }
  ncco.push(connect);

  // Nothing follows the connect. An NCCO continues to the next action once a
  // leg *ends*, not only when it fails, so a trailing talk played as a farewell
  // after calls that had worked — callers heard the Auto Attendant and then us.
  // The destination owns the whole experience, including its own no-answer and
  // voicemail handling. (Speaking only on failure would need the connect's
  // eventUrl with eventType "synchronous", not another action in this array.)
  return ncco;
}

function registerVoiceRoutes(app, { env }) {
  // Vonage calls answer_url with GET by default; accept POST too so the
  // application's http_method can be changed without breaking this.
  app.all('/voice/answer', (req, res) => {
    const from = req.query.from || (req.body && req.body.from) || 'unknown';
    const uuid = req.query.uuid || (req.body && req.body.uuid) || 'unknown';
    console.log(`[voice] inbound call ${uuid} from ${from}`);
    res.json(buildNCCO(env));
  });

  // Call lifecycle events for the connect leg. Logged only — there is no calls
  // table, and inventing one is a separate decision.
  app.post('/voice/events', (req, res) => {
    const { uuid, status, direction, duration } = req.body || {};
    console.log(`[voice] event ${uuid || '?'} status=${status || '?'} direction=${direction || '?'} duration=${duration || '-'}`);
    res.sendStatus(204);
  });
}

module.exports = { buildNCCO, spellDigits, registerVoiceRoutes };
