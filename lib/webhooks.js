// Vonage inbound webhooks: customer SMS (/inbound) and delivery receipts (/status).

const { sanitizeForSMS } = require('./sms');

// STOP/START/HELP keywords, English (the registered 10DLC set) plus Spanish.
// We message a Spanish-speaking audience, so an opt-out has to be honored in
// the language we wrote in — "ALTO" left a contact opted_in until now.
//
// Matching stays whole-string: `keyword()` folds case, accents, and trailing
// punctuation, so "Alto!" and "ALTO" are one entry. Anything wordier than a bare
// keyword ("ya no me manden mensajes") still falls through to a seller in Kommo
// rather than being guessed at here.
//
// Deliberately absent: "si" and "no". Both are ordinary answers to a seller's
// question, and either one would silently flip consent for a contact who was
// just holding a conversation.
const OPT_OUT_KEYWORDS = new Set([
  'stop', 'unsubscribe', 'cancel', 'quit', 'end',
  'alto', 'pare', 'parar', 'detener', 'cancelar', 'fin',
  'basta', 'eliminar', 'quitar'
]);

const OPT_IN_KEYWORDS = new Set([
  'start',
  'alta', 'empezar', 'iniciar', 'comenzar', 'suscribir', 'suscribirme'
]);

const HELP_KEYWORDS = new Set([
  'help', 'info',
  'soporte'
]);

// Spanish keywords get a Spanish confirmation; the English keywords keep the
// exact copy registered with the carrier under 10DLC, untouched.
const SPANISH_REPLIES = {
  optOut: 'Brinteva Worlds: Tu suscripcion fue cancelada y no recibiras mas mensajes. Responde START para suscribirte de nuevo.',
  optIn: 'Brinteva Worlds: Te suscribiste para recibir mensajes promocionales recurrentes. La frecuencia varia. Pueden aplicar tarifas de mensajes y datos. Responde STOP para cancelar, HELP para ayuda.',
  help: 'Brinteva Worlds: Para ayuda, escribenos a nicoll@brintevaworlds.com o llama al +1 (925) 262-8150. Pueden aplicar tarifas de mensajes y datos. Responde STOP para cancelar.'
};

// Fold an inbound message to a bare comparison key: trimmed, accent-stripped,
// lowercased, with trailing punctuation dropped so "STOP." and "STOP!" count.
// Returns '' for anything that isn't a single word.
function keyword(text) {
  const bare = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.!¡?¿,;:]+/g, '')
    .trim()
    .toLowerCase();
  return /^[a-z]+$/.test(bare) ? bare : '';
}

// The exact keyword set registered with the carrier for campaign VCBCFN4Y.
// A hit here answers in the registered English copy; every other keyword is one
// we added for Spanish speakers and answers in Spanish. Kept as one list rather
// than per-branch arrays so adding an English keyword can't drift out of sync
// and start returning a Spanish reply.
const REGISTERED_EN = new Set([
  'stop', 'unsubscribe', 'cancel', 'quit', 'end', 'start', 'help', 'info'
]);

// Registers POST /inbound and POST /status. `deps` carries the shared server
// state (db pool, axios, env) plus the two things this module can't build
// itself: `sendSMS` (writes to `messages`, needs the db + Vonage creds) and the
// Kommo mirror helpers (need the KOMMO_* config assembled in index.js).
function registerWebhookRoutes(app, deps) {
  const { db, axios, env, sendSMS, mirrorInboundToKommo, mirrorOutboundToKommo, pushKommoDeliveryStatus } = deps;

  app.post('/inbound', async (req, res) => {
    const { from: msisdn, text, message_uuid: messageId } = req.body;
    console.log(`Inbound SMS from ${msisdn}: ${text}`);

    res.sendStatus(200);

    // Non-text inbound (MMS, unexpected webhook formats) lacks these fields;
    // skip instead of passing undefined binds to MySQL.
    if (!msisdn || !text) {
      console.warn('[inbound] missing from/text — ignoring');
      return;
    }

    try {
      await db.execute(
        `INSERT INTO contacts (phone) VALUES (?)
         ON DUPLICATE KEY UPDATE updated_at = NOW()`,
        [msisdn]
      );

      const [contacts] = await db.execute(
        'SELECT id FROM contacts WHERE phone = ?', [msisdn]
      );
      const contactId = contacts[0].id;

      let [convRows] = await db.execute(
        `SELECT id FROM conversations
         WHERE contact_id = ? AND status != 'resolved'
         ORDER BY created_at DESC LIMIT 1`,
        [contactId]
      );

      let conversationId;
      if (convRows.length === 0) {
        const [newConv] = await db.execute(
          `INSERT INTO conversations (contact_id, status) VALUES (?, 'ai_handling')`,
          [contactId]
        );
        conversationId = newConv.insertId;
      } else {
        conversationId = convRows[0].id;
      }

      const [inboundMsg] = await db.execute(
        `INSERT INTO messages (conversation_id, direction, body, vonage_message_id, status, sent_by)
         VALUES (?, 'inbound', ?, ?, 'received', 'human')`,
        [conversationId, text, messageId || null]
      );
      const inboundMsgId = inboundMsg.insertId;

      // Every inbound message mirrors into Kommo, including STOP/START/HELP, so
      // a seller sees an opt-out happen instead of a chat going silently stale.
      await mirrorInboundToKommo({ phone: msisdn, name: null, text, msgid: inboundMsgId });

      const kw = keyword(text);
      const registered = REGISTERED_EN.has(kw);

      if (OPT_OUT_KEYWORDS.has(kw)) {
        await db.execute(
          `UPDATE contacts SET opted_in = FALSE, opted_out_at = NOW() WHERE id = ?`,
          [contactId]
        );
        await db.execute(
          `UPDATE conversations SET status = 'resolved' WHERE id = ?`,
          [conversationId]
        );
        const reply = registered
          ? 'Brinteva Worlds: You have been successfully unsubscribed and will no longer receive messages. Reply START to resubscribe.'
          : SPANISH_REPLIES.optOut;
        await sendSMS(msisdn, reply, conversationId, 'system');
        await mirrorOutboundToKommo({ phone: msisdn, text: reply, msgid: `optout-${inboundMsgId}`, senderName: 'Brinteva Worlds', force: true });
        return;
      }

      if (OPT_IN_KEYWORDS.has(kw)) {
        await db.execute(
          `UPDATE contacts SET opted_in = TRUE, opted_out_at = NULL WHERE id = ?`,
          [contactId]
        );
        const reply = registered
          ? 'Brinteva Worlds: You have subscribed to receive recurring promotional messages. Message frequency varies. Message and data rates may apply. Reply STOP to cancel, HELP for help.'
          : SPANISH_REPLIES.optIn;
        await sendSMS(msisdn, reply, conversationId, 'system');
        await mirrorOutboundToKommo({ phone: msisdn, text: reply, msgid: `optin-${inboundMsgId}`, senderName: 'Brinteva Worlds', force: true });
        return;
      }

      // HELP auto-responder (registered 10DLC help keyword; must always reply,
      // even for opted-out contacts, so it runs before any AI/Kommo handling).
      if (HELP_KEYWORDS.has(kw)) {
        const reply = registered
          ? 'Brinteva Worlds: For help, email us at nicoll@brintevaworlds.com or call +1 (925) 262-8150. Message and data rates may apply. Reply STOP to cancel.'
          : SPANISH_REPLIES.help;
        await sendSMS(msisdn, reply, conversationId, 'system');
        await mirrorOutboundToKommo({ phone: msisdn, text: reply, msgid: `help-${inboundMsgId}`, senderName: 'Brinteva Worlds', force: true });
        return;
      }

      const [convStatus] = await db.execute(
        'SELECT status FROM conversations WHERE id = ?', [conversationId]
      );
      if (convStatus[0].status === 'needs_human') {
        console.log(`Conversation ${conversationId} flagged for human — skipping AI`);
        return;
      }

      // AI auto-reply is opt-in: set AI_AUTOREPLY=1 to enable. Default off so a
      // missing env var never results in unattended messages to customers.
      // The inbound message is still stored and mirrored into Kommo above, where
      // an agent answers it. STOP/START/HELP compliance replies run earlier and
      // are unaffected, as is the /api/suggest campaign drafting endpoint.
      if (env.AI_AUTOREPLY !== '1') {
        console.log(`AI auto-reply off — conversation ${conversationId} left for an agent`);
        return;
      }

      // Load active promotions and build the catalog block injected into the prompt
      const [promos] = await db.execute(
        'SELECT title, flag, month, duration, description FROM promotions WHERE active = TRUE ORDER BY sort_order'
      );
      const catalog = promos.map(p =>
        `${p.title}\n${p.month} | ${p.duration}\n${p.description}`
      ).join('\n\n');

      const aiResponse = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `You are a helpful bilingual travel assistant for Brinteva Worlds, a travel agency.
Answer in the same language the customer uses (English or Spanish).

GREETING: Greet warmly and briefly. Always mention we have group trip promotions ("tenemos promociones grupales" / "we have group trip deals"). Keep the greeting itself short.

GROUP TRIPS / PROMOCIONES GRUPALES (current live catalog):
${catalog}

RULES:
- Always use plain ASCII only. No emojis, no markdown (no ** or __), no accent marks or tildes. Write "dias" not "dias" with accent, "Paris" not with accent.
- Normal chat and greetings: keep replies under 160 characters.
- When the customer asks about group trips, promotions, or asks for more details ("cuentame mas"): list the full catalog above, one trip per block, plain text only.
- If the customer wants pricing, wants to book, asks a complex question, has a complaint, or needs account access: respond briefly and end your reply with the exact tag [NEEDS_HUMAN]`,
        messages: [{ role: 'user', content: text }]
      }, {
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      });

      let reply = aiResponse.data.content[0].text;
      const needsHuman = reply.includes('[NEEDS_HUMAN]');
      reply = reply.replace('[NEEDS_HUMAN]', '').trim();

      if (needsHuman) {
        await db.execute(
          `UPDATE conversations SET status = 'needs_human' WHERE id = ?`,
          [conversationId]
        );
        console.log(`Conversation ${conversationId} escalated to human`);
      }

      const cleanReply = sanitizeForSMS(reply);
      await sendSMS(msisdn, cleanReply, conversationId, 'ai');
      await mirrorOutboundToKommo({ phone: msisdn, text: cleanReply, msgid: `ai-${inboundMsgId}`, senderName: 'Brinteva AI' });

    } catch (err) {
      console.error('Inbound handler error:', err.message);
    }
  });

  app.post('/status', async (req, res) => {
    // Messages API reports message_uuid; the legacy SMS API sent messageId.
    // Accept both so receipts still resolve if the account API type ever changes.
    const messageId = req.body.message_uuid || req.body.messageId;
    const { status } = req.body;
    console.log(`Status update for ${messageId}: ${status}`);
    res.sendStatus(200);

    // The Messages API reports a lifecycle (submitted -> delivered), but
    // messages.status is enum('received','sent','delivered','failed') and outbound
    // rows are already inserted as 'sent'. Map to the enum and ignore intermediate
    // states -- writing 'submitted' raises "Data truncated for column 'status'",
    // which aborted the handler before the Kommo push below could run.
    const s = String(status || '').toLowerCase();
    const dbStatus = s === 'delivered' ? 'delivered'
      : ['failed', 'rejected', 'expired', 'undeliverable'].includes(s) ? 'failed'
      : null;

    if (messageId && dbStatus) {
      const kommoStatus = dbStatus === 'delivered' ? 1 : -1;
      try {
        // A message id belongs to exactly one of two places: conversational
        // messages live in `messages`, campaign sends only in
        // `broadcast_recipients`. Look before writing rather than relying on
        // affectedRows, which is 0 when the value is already correct.
        const [owned] = await db.execute(
          `SELECT kommo_msgid FROM messages WHERE vonage_message_id = ?`,
          [messageId]
        );

        if (owned.length > 0) {
          await db.execute(
            `UPDATE messages SET status = ? WHERE vonage_message_id = ?`,
            [dbStatus, messageId]
          );
          // If this message was an agent reply relayed from Kommo, report the
          // carrier verdict back so the agent sees delivered/failed in the chat.
          if (owned[0].kommo_msgid) {
            await pushKommoDeliveryStatus(owned[0].kommo_msgid, kommoStatus, `carrier status: ${s}`);
          }
          return;
        }

        const [recips] = await db.execute(
          `SELECT id, kommo_msgid FROM broadcast_recipients WHERE vonage_message_id = ?`,
          [messageId]
        );
        if (recips.length > 0) {
          const r = recips[0];
          await db.execute(`UPDATE broadcast_recipients SET status = ? WHERE id = ?`, [
            dbStatus,
            r.id
          ]);
          if (r.kommo_msgid) {
            await pushKommoDeliveryStatus(r.kommo_msgid, kommoStatus, `carrier status: ${s}`);
          }
        }
      } catch (err) {
        console.error('Status update error:', err.message);
      }
    }
  });
}

module.exports = {
  registerWebhookRoutes,
  keyword,
  OPT_OUT_KEYWORDS,
  OPT_IN_KEYWORDS,
  HELP_KEYWORDS,
  REGISTERED_EN
};
