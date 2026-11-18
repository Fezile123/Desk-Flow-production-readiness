# DeskFlow Test Plan

**Sprint day:** Day 2: Test Plan
**Scope:** Backend API (`backend/`: Express, Prisma, PostgreSQL)
**Tooling:** Jest, Supertest
**Status:** Draft v1

---

## 1. Objectives

1. Establish automated test coverage for the DeskFlow backend, which currently has none.
2. Protect the business rules that matter most: authentication, role-based access control (RBAC) and the ticket lifecycle.
3. Make tests runnable without external services (no real database, no Groq API key) so they can run in CI (Day 7).
4. Produce a coverage report as sprint evidence.

## 2. Current State (Audit Findings)

| Item | Finding |
|---|---|
| Test framework | None installed (`jest` and `supertest` absent from `package.json`) |
| `test` npm script | Not defined |
| Existing tests | None |
| App/server separation | `src/app.js` exports the Express app and `server.js` starts it, so Supertest can import the app without opening a port |
| Layering | Routes → controllers → services → Prisma, so business logic can be unit-tested in `ticketService.js` |
| External dependencies | PostgreSQL (Prisma), Groq API (`groqService.js`), SSE connections (`notificationService.js`) |

## 3. Endpoint Audit

All paths are prefixed with `/api`.

| # | Method | Path | Auth | Current tests | Priority |
|---|---|---|---|---|---|
| 1 | GET | `/health` | Public | None | Low |
| 2 | POST | `/auth/register` | Public | None | High |
| 3 | POST | `/auth/login` | Public, rate-limited | None | High |
| 4 | GET | `/auth/me` | `protect` | None | Medium |
| 5 | GET | `/auth/users` | `protect` + `authorize('admin')` | None | High (RBAC) |
| 6 | POST | `/tickets` | `protect` + validation | None | High |
| 7 | GET | `/tickets` | `protect` | None | High (RBAC) |
| 8 | PUT | `/tickets/:id` | `protect` + validation | None | High (RBAC, status rules) |
| 9 | POST | `/ai/analyze-ticket` | `protect` | None | Medium (needs Groq mock) |
| 10 | GET | `/notifications/stream` | Query-string JWT | None | Low (SSE; see Risks) |
| 11 | GET | `/notifications` | `protect` | None | Medium |
| 12 | GET | `/notifications/unread-count` | `protect` | None | Low |
| 13 | PATCH | `/notifications/mark-all-read` | `protect` | None | Medium |
| 14 | PATCH | `/notifications/:id/read` | `protect` | None | Medium |
| 15 | DELETE | `/notifications/clear-all` | `protect` | None | Low |
| 16 | DELETE | `/notifications/:id` | `protect` | None | Medium (ownership) |

## 4. Test Strategy

### 4.1 Unit tests (Days 3-4)

Test one module in isolation. Prisma and collaborating services are mocked.

| Unit | What is tested |
|---|---|
| `services/ticketService.js` | Ticket creation, list filtering by role, update rules, notification triggers |
| `middleware/auth.js` | `protect` (missing, invalid and valid token), `authorize` (allowed and denied roles) |
| `validations/*.js` | Accepted and rejected payloads |
| `services/notificationService.js` | Notification created for the right user; admins notified on new ticket; owner notified on update |

### 4.2 Integration tests (Days 3-4)

Use Supertest against the real Express `app` with the full middleware chain (routing, validation, auth, error handler). Prisma is mocked at the module boundary, so no database is required.

Focus areas:
- Auth flow (register, login, `me`)
- Ticket CRUD with employee and admin tokens
- RBAC rejections (401 and 403)
- Notification endpoints and ownership checks

### 4.3 Out of the automated plan

- Browser/UI tests (frontend is not in this sprint's scope)
- Load and performance testing
- Real Groq responses (mocked only)
- Real database queries (covered by the deployed environment, not CI)

## 5. Test Cases

Convention: **UT** = unit test, **IT** = integration test.

### 5.1 Authentication

| ID | Type | Case | Expected |
|---|---|---|---|
| AUTH-01 | IT | Register with valid name, email and password | 201, token returned, role is `employee` |
| AUTH-02 | IT | Register with a missing field | 400 |
| AUTH-03 | IT | Register with an existing email | 400 "User already exists" |
| AUTH-04 | IT | Register attempts `role: "admin"` in the body | Created user is still `employee` |
| AUTH-05 | IT | Login with valid credentials | 200, token and user returned, password not exposed |
| AUTH-06 | IT | Login with a wrong password | 401 |
| AUTH-07 | IT | Login with an unknown email | 401 |
| AUTH-08 | IT | Login with an invalid body (fails validation) | 400 |
| AUTH-09 | IT | `GET /auth/me` with a valid token | 200, current user |
| AUTH-10 | IT | `GET /auth/me` without a token | 401 |
| AUTH-11 | UT | `protect` with an expired or invalid token | 401 |
| AUTH-12 | UT | `protect` where the token's user no longer exists | 401 |

### 5.2 RBAC

| ID | Type | Case | Expected |
|---|---|---|---|
| RBAC-01 | UT | `authorize('admin')` with an admin user | `next()` called |
| RBAC-02 | UT | `authorize('admin')` with an employee user | 403 |
| RBAC-03 | IT | `GET /auth/users` as admin | 200, admin users only |
| RBAC-04 | IT | `GET /auth/users` as employee | 403 |
| RBAC-05 | IT | `GET /auth/users` without a token | 401 |

### 5.3 Tickets

| ID | Type | Case | Expected |
|---|---|---|---|
| TKT-01 | IT | Create a ticket with valid data | 201, ticket returned |
| TKT-02 | IT | Create a ticket with a missing title or description | 400 |
| TKT-03 | UT | `createTicket` stores the correct `createdById` | Prisma called with the expected data |
| TKT-04 | UT | `createTicket` notifies admins | `notifyAdminsNewTicket` called once |
| TKT-05 | UT | `listTicketsForUser` as employee | Query filtered by `createdById` |
| TKT-06 | UT | `listTicketsForUser` as admin | No owner filter |
| TKT-07 | UT | `listTicketsForUser` with `status`, `priority` and `search` | Filters applied to the query |
| TKT-08 | IT | `GET /tickets` without a token | 401 |

### 5.4 Ticket status transitions and update rules

| ID | Type | Case | Expected |
|---|---|---|---|
| STAT-01 | UT | Admin changes status Open → In Progress | Ticket updated; owner notified (`ticket_updated`) |
| STAT-02 | UT | Admin changes status In Progress → Resolved | Ticket updated; owner notified (`ticket_resolved`) |
| STAT-03 | UT | Employee tries to change status | 403 "Only admins can change ticket status" |
| STAT-04 | UT | Employee updates another user's ticket | 403 "You can only update your own tickets" |
| STAT-05 | UT | Employee edits their own ticket without changing status | Update succeeds |
| STAT-06 | UT | Update for a non-existent ticket id | 404 |
| STAT-07 | UT | Admin updates without a status change | No notification sent |
| STAT-08 | IT | `PUT /tickets/:id` as admin with valid data | 200 |
| STAT-09 | IT | `PUT /tickets/:id` with an invalid payload | 400 |
| STAT-10 | IT | `PUT /tickets/:id` as employee including `status` | 403 |

### 5.5 Notifications

| ID | Type | Case | Expected |
|---|---|---|---|
| NOT-01 | UT | `createNotification` persists a record for `userId` | Prisma `create` called |
| NOT-02 | UT | `notifyAdminsNewTicket` | One notification per admin user |
| NOT-03 | UT | `notifyUserTicketUpdated` targets the ticket owner (`createdById`) | Correct `userId` |
| NOT-04 | IT | `GET /notifications` returns only the caller's notifications | Prisma queried with `userId` |
| NOT-05 | IT | `PATCH /notifications/:id/read` scoped to the caller | Update uses `id` and `userId` |
| NOT-06 | IT | `DELETE /notifications/:id` scoped to the caller | Delete uses `id` and `userId` |
| NOT-07 | IT | Any notification route without a token | 401 |
| NOT-08 | IT | `GET /notifications/stream` with no or an invalid token | 401 |

### 5.6 AI and health

| ID | Type | Case | Expected |
|---|---|---|---|
| AI-01 | IT | `POST /ai/analyze-ticket` with Groq mocked | 200, analysis returned |
| AI-02 | IT | Same call with Groq mocked to fail | Error handled, no unhandled crash |
| AI-03 | IT | Same call without a token | 401 |
| HLTH-01 | IT | `GET /api/health` | 200, `success: true` |

## 6. Mocking Approach

| Dependency | Technique |
|---|---|
| Prisma (`config/prisma`) | `jest.mock('../src/config/prisma')`, with `prisma.user`, `prisma.ticket` and `prisma.notification` as `jest.fn()` methods |
| `notificationService` (in ticket tests) | `jest.mock` so ticket tests assert on calls rather than side effects |
| Groq (`groqService`) | `jest.mock` returning canned responses or rejections |
| Auth tokens | Generate real JWTs in tests with a test `JWT_SECRET` set in the test environment |
| bcrypt | Use real `bcryptjs` with the small hash costs the code already uses |
| Environment | `.env.test` or setup file sets `JWT_SECRET`, `NODE_ENV=test`, dummy `DATABASE_URL` |

Notes:
- `server.js` is never imported by tests. Tests import `src/app.js` only.
- `protect` loads the user via `prisma.user.findUnique`, so integration tests mock that call to return an admin or an employee.

## 7. Tooling and Configuration

- **Dependencies (dev):** `jest`, `supertest`
- **Scripts:** `"test": "jest"`, `"test:coverage": "jest --coverage"`
- **Test location:** `backend/tests/unit/` and `backend/tests/integration/`
- **Coverage output:** terminal summary plus HTML report in `backend/coverage/` (added to `.gitignore`)

## 8. Coverage Targets

| Scope | Target |
|---|---|
| Overall (statements, lines) | 70% |
| `services/ticketService.js` | 90% |
| `middleware/auth.js` | 90% |
| `controllers/` | 70% |

Enforced through `coverageThreshold` in the Jest config once the first tests are in place.

## 9. Entry and Exit Criteria

**Entry:** test plan reviewed and merged; dependencies installed; `app.js` imports cleanly under Jest.

**Exit:**
- All High-priority cases implemented and passing
- Coverage targets met
- Coverage report saved as evidence
- Tests run via a single command (`npm test`)

## 10. Risks and Limitations

| Risk | Mitigation |
|---|---|
| Mocked Prisma may hide real query bugs | Keep unit logic thin; verify queries manually and in the deployed environment |
| SSE streaming (`/notifications/stream`) is hard to test | Test only auth rejection (NOT-08); leave stream behaviour to manual verification |
| `notificationService` and routes may create their own Prisma client rather than the shared one | Confirm all modules import from `config/prisma` so a single mock covers them; refactor if needed |
| Rate limiter can interfere with repeated login tests | Mock `authLimiter` or reset between tests |
| `notificationRoutes.js` has no unit seam (logic is inline in route handlers) | Cover through integration tests |

## 11. Schedule

| Day | Activity |
|---|---|
| Day 2 | This plan |
| Days 3-4 | Implement unit and integration tests; configure `jest --coverage` |
| Day 7 | Run tests in the CI pipeline |
