// Inbound voice for the SMS number.
//
// 19252628150 is a mobile-LVN whose features include VOICE, and that can't be
// removed — the number will always accept a call. Until now the Vonage
// application carried only a `messages` capability, so calls reached nothing.
// That number is published as the support line in sms-terms.html and
// privacy.html and is named in the HELP auto-reply registered with the carriers
// for campaign VCBCFN4Y, so it has to land on a human.
//
// Calls connect to the VBC "Main" call group (extension 100) through the `vbc`
// endpoint type. That keeps the call inside Vonage's network — there is no
// outbound PSTN leg to bill — and leaves the ring strategy and seller roster in
// the VBC admin portal instead of in this repo.

// Callers are the same Spanish-speaking audience the SMS campaigns target, so
// every prompt is Spanish. This has no bearing on the English-only sample
// messages registered for 10DLC campaign VCBCFN4Y — that requirement covers SMS
// samples, not voice prompts.
const VOICE_LANG = 'es-US';

// Read digits one at a time so TTS says "nueve dos cinco" and not "novecientos
// veinticinco".
function spellDigits(number) {
  const digits = String(number).replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return String(number);
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)]
    .map(part => part.split('').join(' '))
    .join(', ');
}

// Build the NCCO Vonage runs when a call comes in.
//
// `from` is deliberately omitted. On a `phone` endpoint it has to be a Vonage
// number we own, which would stamp 19252628150 over the customer's caller ID;
// leaving it off gives the VBC seat the best chance of showing who is actually
// calling.
//
// The timeout bounds the whole connect while VBC runs its own ring strategy
// inside it. Set it above the group's worst-case cycle (sequential ringing
// across ten sellers adds up) or the call is severed mid-rotation and it looks
// like sellers stopped receiving calls.
function buildNCCO(env) {
  const extension = env.VBC_GROUP_EXTENSION;
  const fallbackNumber = env.VOICE_FALLBACK_NUMBER || '19256658003';
  const spoken = spellDigits(fallbackNumber);

  // No extension configured: still answer with something useful rather than
  // dropping the caller into silence.
  if (!extension) {
    return [{
      action: 'talk',
      language: VOICE_LANG,
      text: `Gracias por llamar a Brinteva Worlds. Para comunicarse con un asesor de viajes, por favor llame al ${spoken}, o responda a nuestro mensaje de texto y le contactaremos.`
    }];
  }

  const ncco = [
    {
      action: 'talk',
      language: VOICE_LANG,
      text: 'Gracias por llamar a Brinteva Worlds. Le comunicamos con un asesor de viajes.'
    },
    {
      action: 'connect',
      timeout: Number(env.VOICE_RING_TIMEOUT) || 90,
      endpoint: [{ type: 'vbc', extension: String(extension) }]
    },
    {
      action: 'talk',
      language: VOICE_LANG,
      text: `En este momento no hay asesores disponibles. Por favor llame al ${spoken}, o responda a nuestro mensaje de texto y le contactaremos.`
    }
  ];

  if (env.VOICE_EVENT_URL) {
    ncco[1].eventUrl = [env.VOICE_EVENT_URL];
  }

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
