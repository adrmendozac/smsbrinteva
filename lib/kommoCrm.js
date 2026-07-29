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
  triggerSalesbot
};
