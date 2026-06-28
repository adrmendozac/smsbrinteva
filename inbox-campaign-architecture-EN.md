# Shared Inbox + Campaigns — Architecture

## Overview

Multi-user system for Brinteva Worlds that lets 2 administrators (CEO + Adrian) send bulk SMS campaigns, and 9 sellers follow up on replies through a **shared pool** of conversations. AI (Claude Haiku) responds automatically first; sellers claim leads to work them manually.

---

## Roles

| Role | Users | Permissions |
|---|---|---|
| **Admin** | CEO (Nicoll) + Adrian | Send campaigns, manage users, see EVERYTHING, full analytics |
| **Seller** | 9 sellers | View shared queue, claim leads, reply, change status of their own leads |

**Total: 11 users** (2 admins + 9 sellers)

---

## Shared Pool Model

```
Campaign sent (admin)
        ↓
Replies come in → SHARED QUEUE (visible to all 9 sellers)
        ↓
Seller claims a conversation → it gets assigned to them
        ↓
Conversation moves to seller's "My conversations"
        ↓
Admin sees EVERYTHING at all times (queue, who claimed what, statuses)
```

- Any seller can claim any unclaimed lead
- Claiming locks it to prevent duplicate replies
- Admins have full, permanent visibility

---

## Lead Pipeline

Each conversation has a status (`lead_status`):

```
new → working → quoted → booked → lost
```

This lets the admin see the conversion funnel live:

```
Campaign "Cancún Promo"
5,000 sent → 487 replied → 156 claimed → 89 working → 34 quoted → 11 booked
```

---

## Tech Stack

### Backend
| Component | Technology | Notes |
|---|---|---|
| Runtime | Node.js 20 | Already installed on VPS |
| Framework | Express | API server + webhooks |
| Process manager | PM2 | Process `sms-bot` |
| Database | MySQL 8.4 | DB `brinteva_sms` |
| Real-time | Socket.io | Live notifications for new leads / claims |
| Cache / pub-sub | Redis (port 6379) | Already running; supports Socket.io at scale |
| Auth | JWT (`jsonwebtoken`) + `bcrypt` | Tokens for 11 users, hashed passwords |
| Scheduler | `node-cron` | Campaign send scheduling |

### Frontend
| Component | Technology | Notes |
|---|---|---|
| Framework | React 18 | Via CDN (no build step) or Vite if preferred |
| Styling | Tailwind CSS | Via CDN |
| Real-time client | Socket.io-client | Receives server updates |
| Routing | React Router | Views: login, inbox, campaigns, admin |
| HTTP | fetch / axios | API calls |

### Infrastructure
| Component | Detail |
|---|---|
| Web server | Nginx (reverse proxy + SSL) |
| SSL | Let's Encrypt (Certbot, auto-renew) |
| Domain | `sms.brintevaworlds.com` |
| Inbox URL | `https://sms.brintevaworlds.com/inbox` |

### External services
| Service | Use |
|---|---|
| Vonage Messages API | Send and receive SMS |
| Anthropic Claude Haiku | Automatic AI replies (bilingual) |

---

## npm Dependencies to Install

```bash
cd /var/www/sms.brintevaworlds.com
npm install express mysql2 dotenv axios          # already installed
npm install jsonwebtoken bcrypt                   # auth
npm install socket.io                             # real-time
npm install node-cron                             # campaign scheduler
```

Frontend (if using a Vite build instead of CDN):
```bash
npm install react react-dom react-router-dom socket.io-client
```

---

## Database Schema (additions)

```sql
-- Users table (2 admins + 9 sellers)
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'seller') DEFAULT 'seller',
  active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lead pipeline + claim tracking on conversations
ALTER TABLE conversations 
  ADD COLUMN lead_status ENUM('new','working','quoted','booked','lost') DEFAULT 'new',
  ADD COLUMN claimed_by INT NULL,
  ADD COLUMN claimed_at TIMESTAMP NULL,
  ADD FOREIGN KEY (claimed_by) REFERENCES users(id);

-- Link campaigns to the admin who sent them
ALTER TABLE broadcasts
  ADD COLUMN sent_by_user_id INT NULL,
  ADD FOREIGN KEY (sent_by_user_id) REFERENCES users(id);
```

---

## API Endpoints (planned)

### Auth
| Method | Route | Role | Description |
|---|---|---|---|
| `POST` | `/api/login` | public | Login, returns JWT |
| `POST` | `/api/logout` | auth | Log out |

### Inbox / Leads
| Method | Route | Role | Description |
|---|---|---|---|
| `GET` | `/api/queue` | seller+admin | Shared queue (unclaimed leads) |
| `GET` | `/api/my-leads` | seller+admin | Conversations claimed by the user |
| `GET` | `/api/all-leads` | admin | ALL conversations (admin only) |
| `POST` | `/api/claim/:conversationId` | seller+admin | Claim a lead |
| `POST` | `/api/reply` | seller+admin | Reply to a customer |
| `PATCH` | `/api/lead-status/:id` | seller+admin | Change lead status |
| `GET` | `/api/messages/:conversationId` | seller+admin | Message thread |

### Campaigns (admin only)
| Method | Route | Role | Description |
|---|---|---|---|
| `POST` | `/api/broadcasts` | admin | Create campaign |
| `POST` | `/api/broadcasts/:id/send` | admin | Send / schedule |
| `GET` | `/api/broadcasts` | admin | Campaign list |
| `GET` | `/api/broadcasts/:id/stats` | admin | Live conversion funnel |

### Users (admin only)
| Method | Route | Role | Description |
|---|---|---|---|
| `GET` | `/api/users` | admin | User list |
| `POST` | `/api/users` | admin | Create user |
| `PATCH` | `/api/users/:id` | admin | Edit / deactivate |

### Webhooks (Vonage)
| Method | Route | Description |
|---|---|---|
| `POST` | `/inbound` | Incoming SMS |
| `POST` | `/status` | Delivery receipts |

---

## Socket.io Events (real-time)

| Event | Direction | Description |
|---|---|---|
| `new_lead` | server → all | New reply entered the shared queue |
| `lead_claimed` | server → all | A seller claimed a lead (remove from others' queue) |
| `new_message` | server → claimer + admins | New message in a conversation |
| `campaign_progress` | server → admins | Campaign send progress update |

---

## Frontend Views

### Login (`/inbox/login`)
- Bilingual login screen
- JWT stored in localStorage

### Seller
- **Shared queue** — unclaimed leads, "Claim" button
- **My conversations** — claimed threads, WhatsApp-style
- **Reply box** — respond to customer (from the campaign number)
- **Status tags** — label lead: working / quoted / booked / lost
- **Campaign feed (read-only)** — which campaigns went out and when

### Admin
- **Campaign composer** — write, segment, schedule, estimate cost
- **Campaign monitor** — live send (sent / delivered / failed / replies)
- **Conversion funnel** — new → working → quoted → booked → lost
- **All-leads view** — every conversation across the 9 sellers
- **User management** — add / remove / reset sellers
- **Per-seller analytics** — response speed, conversion

---

## Recommended Build Order

1. ✅ Base: VPS, Nginx, SSL, PM2, Express, MySQL
2. ✅ Inbound webhook + Claude Haiku responder
3. ⏳ `users` table + schema additions
4. ⏳ Auth system (JWT + bcrypt)
5. ⏳ Inbox API (queue, claim, reply, status)
6. ⏳ React frontend — seller view
7. ⏳ React frontend — admin view
8. ⏳ Socket.io for real-time
9. ⏳ Campaign module (composer + scheduler + batching)
10. ⏳ Conversion funnel / analytics
11. ⏳ Migrate from legacy SMS API → Messages API with JWT

---

*Brinteva Worlds, Inc. — EIN 92-3293741 — Pittsburg, CA*
