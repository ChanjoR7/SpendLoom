# SpendLoom

An AI-powered student finance dashboard built at a hackathon. Track expenses, set a monthly budget, and ask an AI money coach (Gemini) questions about your spending.

## Project structure

```
spendloom/
├── backend/          Express API + MongoDB Atlas + Gemini
│   ├── server.js
│   ├── test/         Automated API tests (no real DB or AI needed)
│   ├── .env.example  Copy to .env and add your keys
│   └── package.json
└── frontend/         Static dashboard (served by the backend)
    ├── index.html
    ├── script.js
    └── style.css
```

## Run it

Requires Node.js 20.19 or newer.

```bash
cd backend
cp .env.example .env      # then fill in MONGODB_URI and GEMINI_API_KEY
npm install
npm start
```

Open **http://localhost:3000** — the backend serves the dashboard too, so you don't need Live Server. (Opening `frontend/index.html` another way still works; it talks to `http://localhost:3000`.)

If MongoDB won't connect, check Atlas → **Network Access** allows your IP address.

## Tests

```bash
cd backend
npm test
```

## API

All routes except sign up, log in and health need `Authorization: Bearer <token>`.

| Method | Route               | Description |
| ------ | ------------------- | ----------- |
| GET    | `/api/health`       | Server, database and AI status |
| POST   | `/api/auth/signup`  | Create an account `{ name, email, password }` → `{ token, user, plan }` |
| POST   | `/api/auth/login`   | Log in `{ email, password }` → `{ token, user, plan }` |
| POST   | `/api/auth/logout`  | End this session |
| GET    | `/api/auth/me`      | Current user and plan |
| GET    | `/api/plan`         | Your starting balance and monthly budgets |
| PUT    | `/api/plan`         | Save `{ startingBalance, month: "YYYY-MM", monthlyBudget }` |
| GET    | `/api/expenses`     | Your latest 500 expenses |
| POST   | `/api/expenses`     | Save `{ name, amount, category, date? }` |
| DELETE | `/api/expenses/:id` | Delete one of your expenses |
| POST   | `/api/ai/coach`     | Ask `{ question, financialContext, history? }` (15/min per account) |

Categories: `food`, `transport`, `shopping`, `entertainment`, `bills`, `other`.

## Features

- Accounts: sign up, log in, log out — each person only sees their own data

- Monthly budget plan with a progress bar and over-budget warning
- Record expenses with a date (backdating allowed, no future dates), delete mistakes
- Dashboard, category totals and transaction list all follow the selected month
- AI money coach that remembers the last few messages, so follow-up answers work

## Notes

- Users, sessions and expenses are stored in MongoDB (`users`, `sessions`, `expenses` collections). The starting balance and budgets are saved on the account, so they follow you to any device.
- Passwords are hashed with scrypt (Node's built-in crypto); only a SHA-256 hash of each login token is stored. Sessions last 30 days and MongoDB removes expired ones automatically.
- Sign up / log in is limited to 30 attempts per 15 minutes per IP (`AUTH_RATE_LIMIT`).
- Expenses saved before accounts existed have no owner, so they won't appear for anyone.
- AI answers are guidance, not professional financial advice.
