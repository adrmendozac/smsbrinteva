import type { Contact, Conversation, Message } from "../types";

// Realistic bilingual contacts. Real-format US numbers (555-01xx reserved range).
export const contacts: Contact[] = [
  { id: "p1", name: "Ana Reyes", phone: "+1 (412) 555-0173", language: "es", optedIn: true },
  { id: "p2", name: "Marcus Bell", phone: "+1 (312) 555-0148", language: "en", optedIn: true },
  { id: "p3", name: "Lucía Fernández", phone: "+1 (510) 555-0192", language: "es", optedIn: true },
  { id: "p4", name: "Devon Pierce", phone: "+1 (646) 555-0107", language: "en", optedIn: true },
  { id: "p5", name: "Camila Ortiz", phone: "+1 (305) 555-0164", language: "es", optedIn: false },
  { id: "p6", name: "Priya Nair", phone: "+1 (206) 555-0139", language: "en", optedIn: true },
  { id: "p7", name: "Tomás Guerrero", phone: "+1 (915) 555-0121", language: "es", optedIn: true },
];

export const conversations: Conversation[] = [
  { id: "c1", contactId: "p1", status: "needs_human", unread: 2, lastMessageAt: "2026-06-22T14:58:00Z" },
  { id: "c2", contactId: "p2", status: "ai_handling", unread: 0, lastMessageAt: "2026-06-22T14:41:00Z" },
  { id: "c3", contactId: "p3", status: "open", unread: 1, lastMessageAt: "2026-06-22T13:20:00Z" },
  { id: "c4", contactId: "p4", status: "resolved", unread: 0, lastMessageAt: "2026-06-22T11:05:00Z" },
  { id: "c5", contactId: "p5", status: "resolved", unread: 0, lastMessageAt: "2026-06-21T18:30:00Z" },
  { id: "c6", contactId: "p6", status: "ai_handling", unread: 0, lastMessageAt: "2026-06-22T09:12:00Z" },
  { id: "c7", contactId: "p7", status: "needs_human", unread: 3, lastMessageAt: "2026-06-22T14:50:00Z" },
];

export const messages: Message[] = [
  // c1 — Ana, escalated to human
  { id: "m1", conversationId: "c1", direction: "inbound", sender: "contact", body: "Hola, reservé un tour a Cancún pero no me llegó la confirmación.", createdAt: "2026-06-22T14:40:00Z" },
  { id: "m2", conversationId: "c1", direction: "outbound", sender: "ai", body: "Hola Ana, con gusto reviso tu reserva. ¿Me confirmas el correo que usaste?", createdAt: "2026-06-22T14:41:00Z" },
  { id: "m3", conversationId: "c1", direction: "inbound", sender: "contact", body: "areyes@correo.com, pero ya pagué y necesito hablar con alguien hoy.", createdAt: "2026-06-22T14:55:00Z" },
  { id: "m4", conversationId: "c1", direction: "inbound", sender: "system", body: "Conversation escalated to a human agent.", createdAt: "2026-06-22T14:58:00Z" },

  // c2 — Marcus, AI handling
  { id: "m5", conversationId: "c2", direction: "inbound", sender: "contact", body: "What time does the Lima airport shuttle leave?", createdAt: "2026-06-22T14:39:00Z" },
  { id: "m6", conversationId: "c2", direction: "outbound", sender: "ai", body: "The shuttle departs at 6:15am and 2:30pm daily from the main terminal. Want me to add you to the morning run?", createdAt: "2026-06-22T14:41:00Z" },

  // c3 — Lucía, open, one unread
  { id: "m7", conversationId: "c3", direction: "inbound", sender: "contact", body: "¿Puedo cambiar la fecha de mi vuelo a Guadalajara?", createdAt: "2026-06-22T13:18:00Z" },
  { id: "m8", conversationId: "c3", direction: "outbound", sender: "human", body: "Claro Lucía, ¿para qué fecha lo necesitas?", createdAt: "2026-06-22T13:19:00Z" },
  { id: "m9", conversationId: "c3", direction: "inbound", sender: "contact", body: "Para el 5 de julio si se puede.", createdAt: "2026-06-22T13:20:00Z" },

  // c4 — Devon, resolved
  { id: "m10", conversationId: "c4", direction: "inbound", sender: "contact", body: "Got my itinerary, thanks!", createdAt: "2026-06-22T11:03:00Z" },
  { id: "m11", conversationId: "c4", direction: "outbound", sender: "human", body: "Glad it arrived, Devon. Safe travels to Cusco!", createdAt: "2026-06-22T11:05:00Z" },

  // c5 — Camila, opted out
  { id: "m12", conversationId: "c5", direction: "inbound", sender: "contact", body: "STOP", createdAt: "2026-06-21T18:29:00Z" },
  { id: "m13", conversationId: "c5", direction: "outbound", sender: "system", body: "You have been unsubscribed. Reply START to opt back in.", createdAt: "2026-06-21T18:30:00Z" },

  // c6 — Priya, AI handling
  { id: "m14", conversationId: "c6", direction: "inbound", sender: "contact", body: "Do you offer travel insurance for the Italy package?", createdAt: "2026-06-22T09:10:00Z" },
  { id: "m15", conversationId: "c6", direction: "outbound", sender: "ai", body: "Yes, we offer optional coverage starting at $39 per traveler. Would you like the details?", createdAt: "2026-06-22T09:12:00Z" },

  // c7 — Tomás, needs human, multiple unread
  { id: "m16", conversationId: "c7", direction: "inbound", sender: "contact", body: "Me cobraron dos veces el paquete a Machu Picchu.", createdAt: "2026-06-22T14:44:00Z" },
  { id: "m17", conversationId: "c7", direction: "outbound", sender: "ai", body: "Lamento el inconveniente, Tomás. Voy a pasar tu caso a un agente para revisar el cargo duplicado.", createdAt: "2026-06-22T14:45:00Z" },
  { id: "m18", conversationId: "c7", direction: "inbound", sender: "system", body: "Conversation escalated to a human agent.", createdAt: "2026-06-22T14:45:30Z" },
  { id: "m19", conversationId: "c7", direction: "inbound", sender: "contact", body: "Necesito el reembolso antes del viernes por favor.", createdAt: "2026-06-22T14:50:00Z" },
];
