// Kommo CRM REST v4 API module.
//
// Extends the CRM primitives in lib/kommo.js with:
//   - Custom field sync (push DB values into Kommo lead fields)
//   - Task creation (auto-create a follow-up task)
//   - Pipeline management (list pipelines, move leads through stages)
//   - Salesbot trigger (POST /api/v4/bots/{id}/run)
//
// All functions follow the same pattern as kommo.js: injected axios + env,
// best-effort (never throw — log and return null on failure).

const { crmRequest } = require('./kommo');

// ── Custom Fields ─────────────────────────────────────────────────────────

// Fetch all custom field definitions for leads.
// Returns an array of { id, name, type, enums, ... } or null.
async function getLeadCustomFields({ axios, subdomain, token }) {
  try {
    const res = await crmRequest({ axios, subdomain, token, method: 'GET', path: '/leads/custom_fields' });
    if (res.status !== 200) return null;
    return (res.data && res.data._embedded && res.data._embedded.custom_fields) || null;
  } catch (err) {
    console.error('[kommoCrm] getLeadCustomFields error:', err.message);
    return null;
  }
}

// Update custom field values on a lead.
// fields: [{ field_id, values: [{ value }] }]
async function updateLeadCustomFields({ axios, subdomain, token, leadId, fields }) {
  try {
    const res = await crmRequest({
      axios, subdomain, token, method: 'PATCH',
      path: `/leads/${leadId}`,
      data: [{ id: leadId, custom_fields_values: fields }]
    });
    if (res.status >= 300) {
      console.error('[kommoCrm] updateLeadCustomFields failed', res.status, JSON.stringify(res.data));
      return null;
    }
    return true;
  } catch (err) {
    console.error('[kommoCrm] updateLeadCustomFields error:', err.message);
    return null;
  }
}

// ── Tasks ─────────────────────────────────────────────────────────────────

// Create a task linked to a lead or contact.
// Options: { leadId, contactId, text, taskTypeId (1=call, 2=meeting, 3=to_do),
//            completeTill (ISO string deadline) }
async function createTask({ axios, subdomain, token, leadId, contactId, text, taskTypeId = 3, completeTill }) {
  try {
    const body = [{
      text,
      task_type_id: taskTypeId,
      complete_till: completeTill || Math.floor(Date.now() / 1000) + 86400, // default 24h
      entity_id: leadId || contactId,
      entity_type: leadId ? 'leads' : 'contacts'
    }];
    const res = await crmRequest({ axios, subdomain, token, method: 'POST', path: '/tasks', data: body });
    if (res.status >= 300) {
      console.error('[kommoCrm] createTask failed', res.status, JSON.stringify(res.data));
      return null;
    }
    return (res.data && res.data._embedded && res.data._embedded.tasks && res.data._embedded.tasks[0]) || null;
  } catch (err) {
    console.error('[kommoCrm] createTask error:', err.message);
    return null;
  }
}

// ── Pipelines ─────────────────────────────────────────────────────────────

// List all pipelines with their statuses (stages).
// Returns [{ id, name, _embedded: { statuses: [{ id, name, sort }] } }]
async function getPipelines({ axios, subdomain, token }) {
  try {
    const res = await crmRequest({ axios, subdomain, token, method: 'GET', path: '/pipelines' });
    if (res.status !== 200) return null;
    return (res.data && res.data._embedded && res.data._embedded.pipelines) || null;
  } catch (err) {
    console.error('[kommoCrm] getPipelines error:', err.message);
    return null;
  }
}

// Move a lead to a different pipeline status.
async function moveLead({ axios, subdomain, token, leadId, statusId }) {
  try {
    const res = await crmRequest({
      axios, subdomain, token, method: 'PATCH',
      path: `/leads/${leadId}`,
      data: [{ id: leadId, status_id: statusId }]
    });
    if (res.status >= 300) {
      console.error('[kommoCrm] moveLead failed', res.status, JSON.stringify(res.data));
      return null;
    }
    return true;
  } catch (err) {
    console.error('[kommoCrm] moveLead error:', err.message);
    return null;
  }
}

// ── Lead lookup ───────────────────────────────────────────────────────────

// DISABLED pending review — see deps.tagLeadByPhone in index.js for the full
// reasoning. The blocker is the last return: when no embedded contact confirms
// the phone, this hands back an unrelated lead rather than admitting it did not
// find one. Fix that (return null) before re-enabling.
//
// Search for a lead by phone number. Returns the first lead id found, or null.
// Searches leads by query (Kommo substring match on name/contact phone/email).
// async function searchLeadByPhone({ axios, subdomain, token, phone }) {
//   try {
//     const res = await crmRequest({
//       axios, subdomain, token, method: 'GET',
//       path: `/leads?query=${encodeURIComponent(phone)}&with=contacts&limit=3`
//     });
//     if (res.status !== 200) return null;
//     const leads = res.data && res.data._embedded && res.data._embedded.leads;
//     if (!leads || leads.length === 0) return null;
//     // Walk each lead's embedded contacts to confirm the phone matches.
//     for (const lead of leads) {
//       const contacts = lead._embedded && lead._embedded.contacts;
//       if (!contacts) continue;
//       for (const c of contacts) {
//         if (c.custom_fields_values) {
//           for (const f of c.custom_fields_values) {
//             if (f.field_code === 'PHONE' && f.values.some(v => String(v.value).replace(/\D/g, '').includes(phone.replace(/\D/g, '')))) {
//               return lead.id;
//             }
//           }
//         }
//       }
//     }
//     return leads[0].id; // fallback: return first match even without phone confirm
//   } catch (err) {
//     console.error('[kommoCrm] searchLeadByPhone error:', err.message);
//     return null;
//   }
// }

// ── Tags ──────────────────────────────────────────────────────────────────

// Add one or more tags to a lead. GETs current tags first, merges, then PATCHes
// (Kommo v4 stores tags as a comma-separated string and PATCH replaces it).
async function addLeadTags({ axios, subdomain, token, leadId, tags }) {
  try {
    const get = await crmRequest({
      axios, subdomain, token, method: 'GET',
      path: `/leads/${leadId}?with=tags`
    });
    if (get.status !== 200) return null;
    const existing = get.data.tags || '';
    const existingSet = new Set(existing.split(',').map(t => t.trim()).filter(Boolean));
    for (const t of tags) existingSet.add(t);
    const merged = [...existingSet].join(',');
    const res = await crmRequest({
      axios, subdomain, token, method: 'PATCH',
      path: `/leads/${leadId}`,
      data: [{ id: leadId, tags: merged }]
    });
    if (res.status >= 300) {
      console.error('[kommoCrm] addLeadTags failed', res.status, JSON.stringify(res.data));
      return null;
    }
    return true;
  } catch (err) {
    console.error('[kommoCrm] addLeadTags error:', err.message);
    return null;
  }
}

// ── Notes ─────────────────────────────────────────────────────────────────

// Add a text note to a lead.
//
// The note body belongs INSIDE `params`. Sending `text` as a sibling of
// `params` is what made every call 400 with
// `{"code":"FieldMissing","path":"params.text"}` from 837d915 onward — silently,
// because the caller swallows the failure. No lead note has been written since.
async function createLeadNote({ axios, subdomain, token, leadId, text }) {
  try {
    const res = await crmRequest({
      axios, subdomain, token, method: 'POST',
      path: `/leads/${leadId}/notes`,
      data: [{ note_type: 'common', params: { text: String(text ?? '') } }]
    });
    if (res.status >= 300) {
      console.error('[kommoCrm] createLeadNote failed', res.status, JSON.stringify(res.data));
      return null;
    }
    return true;
  } catch (err) {
    console.error('[kommoCrm] createLeadNote error:', err.message);
    return null;
  }
}

// ── Salesbot ──────────────────────────────────────────────────────────────

// Trigger a Salesbot automation for a lead.
// botId: the Salesbot id from Kommo.
async function triggerSalesbot({ axios, subdomain, token, botId, leadId }) {
  try {
    const res = await crmRequest({
      axios, subdomain, token, method: 'POST',
      path: `/bots/${botId}/run`,
      data: { lead_id: leadId }
    });
    if (res.status >= 300) {
      console.error('[kommoCrm] triggerSalesbot failed', res.status, JSON.stringify(res.data));
      return null;
    }
    return true;
  } catch (err) {
    console.error('[kommoCrm] triggerSalesbot error:', err.message);
    return null;
  }
}

module.exports = {
  getLeadCustomFields,
  updateLeadCustomFields,
  createTask,
  getPipelines,
  moveLead,
  createLeadNote,
  addLeadTags,
  // searchLeadByPhone,  // disabled — see above
  triggerSalesbot
};
