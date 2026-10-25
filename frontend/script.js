// =============================================
// SPENDLOOM — COMPLETE FRONTEND SCRIPT
// =============================================

// When the page is served by the backend (http://localhost:3000) use the same
// origin; when opened another way (Live Server, file://) talk to port 3000.
const API_BASE = "https://spendloom-backend.onrender.com";

const API_URL = `${API_BASE}/api/expenses`;
const AI_API_URL = `${API_BASE}/api/ai/coach`;

const TOKEN_KEY = "spendloom-session";

const MAX_LISTED_TRANSACTIONS = 50;
const MAX_CHAT_HISTORY = 6;

const CATEGORY_LABELS = {
    food: "Food & Groceries",
    transport: "Transport",
    shopping: "Shopping",
    entertainment: "Entertainment",
    bills: "Bills",
    other: "Other"
};

// Finance plan elements
const financeForm = document.getElementById("finance-form");
const financeMessage = document.getElementById("finance-message");
const financeMonth = document.getElementById("finance-month");
const startingBalanceInput = document.getElementById("starting-balance");
const monthlyBudgetInput = document.getElementById("monthly-budget");

// Expense elements
const expenseForm = document.getElementById("expense-form");
const transactionList = document.getElementById("transaction-list");
const formMessage = document.getElementById("form-message");
const expenseNameInput = document.getElementById("expense-name");
const expenseAmountInput = document.getElementById("expense-amount");
const expenseDateInput = document.getElementById("expense-date");
const expenseCategoryInput = document.getElementById("expense-category");

// AI chat elements
const chatForm = document.getElementById("ai-chat-form");
const chatInput = document.getElementById("ai-chat-input");
const chatMessages = document.getElementById("ai-chat-messages");
const chatSend = document.getElementById("ai-chat-send");
const quickPrompts = document.querySelectorAll(".ai-prompt");

let transactions = [];
let transactionsLoaded = false;
let financialData = { startingBalance: 0, hasStartingBalance: false, monthlyBudgets: {} };
let authToken = readToken();
let currentUser = null;
let coachBusy = false;
let chatHistory = [];
const messageTimers = new WeakMap();

// ---------------------------------------------
// HELPERS
// ---------------------------------------------

function pad(number) {
    return String(number).padStart(2, "0");
}

function monthKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function todayInputValue() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function currentMonthKey() {
    return monthKey(new Date());
}

function selectedMonthKey() {
    return financeMonth?.value || currentMonthKey();
}

function monthLabel(key) {
    const [year, month] = key.split("-").map(Number);
    if (!year || !month) return key;

    return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric"
    });
}

function money(amount) {
    return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP"
    }).format(Number(amount) || 0);
}

// Store a picked date at local midday so it never slips to the day before
// or after when converted to UTC.
function dateInputToISO(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    if (!year || !month || !day) return new Date().toISOString();

    return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

function parseExpenseDate(expense) {
    const rawDate = expense.date || expense.createdAt;
    if (!rawDate) return null;

    const date = new Date(rawDate);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getExpenseDate(expense) {
    const date = parseExpenseDate(expense);

    return date
        ? date.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric"
        })
        : "";
}

function getExpenseMonth(expense) {
    const date = parseExpenseDate(expense);
    return date ? monthKey(date) : "";
}

// Work in pennies to avoid floating-point drift (e.g. 0.1 + 0.2).
function sumAmounts(list) {
    const pennies = list.reduce(
        (total, expense) => total + Math.round((Number(expense.amount) || 0) * 100),
        0
    );
    return pennies / 100;
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

function setMessage(element, text, isError = false) {
    if (!element) return;

    clearTimeout(messageTimers.get(element));

    element.textContent = text;
    element.classList.toggle("is-error", isError);

    // Success messages fade away after a few seconds.
    if (text && !isError) {
        messageTimers.set(element, setTimeout(() => {
            element.textContent = "";
        }, 4000));
    }
}

async function readJson(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

// The coach is asked for plain text, but strip stray markdown just in case.
function cleanAiText(text) {
    return String(text)
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^\s*[-*]\s+/gm, "• ")
        .replace(/`([^`]+)`/g, "$1")
        .trim();
}

function friendlyError(error, fallback) {
    return error instanceof TypeError
        ? "Could not reach the backend. Is it running?"
        : error.message || fallback;
}

// ---------------------------------------------
// ACCOUNT, SESSION AND API REQUESTS
// ---------------------------------------------

function readToken() {
    try {
        return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
        return "";
    }
}

function writeToken(token) {
    authToken = token || "";

    try {
        if (authToken) localStorage.setItem(TOKEN_KEY, authToken);
        else localStorage.removeItem(TOKEN_KEY);
    } catch {
        // Private mode: stay logged in for this tab only.
    }
}

class SessionExpiredError extends Error {}

// fetch() that sends the login token and handles an expired session.
async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 && authToken) {
        const data = await readJson(response);
        signOutLocally(data.error || "Your session has expired. Please log in again.");
        throw new SessionExpiredError(data.error || "Please log in again.");
    }

    return response;
}

function normalisePlan(plan) {
    const budgets = plan && typeof plan.monthlyBudgets === "object" &&
        plan.monthlyBudgets !== null && !Array.isArray(plan.monthlyBudgets)
        ? plan.monthlyBudgets
        : {};

    return {
        startingBalance: Number(plan?.startingBalance) || 0,
        hasStartingBalance: Boolean(plan?.hasStartingBalance),
        monthlyBudgets: budgets
    };
}

// ---------------------------------------------
// SIGN UP / LOG IN SCREEN
// ---------------------------------------------

const authScreen = document.getElementById("auth-screen");
const authForm = document.getElementById("auth-form");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authNameGroup = document.getElementById("auth-name-group");
const authNameInput = document.getElementById("auth-name");
const authEmailInput = document.getElementById("auth-email");
const authPasswordInput = document.getElementById("auth-password");
const authPasswordHint = document.getElementById("auth-password-hint");
const authPasswordToggle = document.getElementById("auth-password-toggle");
const authSubmit = document.getElementById("auth-submit");
const authMessage = document.getElementById("auth-message");
const authTabs = document.querySelectorAll(".auth-tab");

const accountButton = document.getElementById("account-button");
const accountDropdown = document.getElementById("account-dropdown");
const logoutButton = document.getElementById("logout-button");

let authMode = "login";

function setAuthMode(mode) {
    authMode = mode === "signup" ? "signup" : "login";
    const signup = authMode === "signup";

    authTabs.forEach(tab => {
        const active = tab.dataset.mode === authMode;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
    });

    if (authNameGroup) authNameGroup.hidden = !signup;
    if (authPasswordHint) authPasswordHint.hidden = !signup;
    if (authPasswordInput) {
        authPasswordInput.autocomplete = signup ? "new-password" : "current-password";
        authPasswordInput.placeholder = signup ? "Create a password" : "Your password";
    }

    if (authTitle) {
        authTitle.innerHTML = signup
            ? 'Create your account<span class="heading-period">.</span>'
            : 'Welcome back<span class="heading-period">.</span>';
    }

    if (authSubtitle) {
        authSubtitle.textContent = signup
            ? "Track your spending, set budgets and get AI money tips — just for you."
            : "Log in to see your budget, expenses and money coach.";
    }

    if (authSubmit) {
        authSubmit.innerHTML = signup
            ? 'Create account <span aria-hidden="true">↗</span>'
            : 'Log in <span aria-hidden="true">↗</span>';
    }

    setMessage(authMessage, "");
    (signup ? authNameInput : authEmailInput)?.focus();
}

function showAuthScreen(message = "") {
    document.body.classList.add("is-locked");
    if (authScreen) authScreen.hidden = false;
    if (accountDropdown) accountDropdown.hidden = true;

    setAuthMode(authMode);
    if (message) setMessage(authMessage, message, true);
}

function hideAuthScreen() {
    document.body.classList.remove("is-locked");
    if (authScreen) authScreen.hidden = true;
    if (authPasswordInput) authPasswordInput.value = "";
    setMessage(authMessage, "");
}

function validateAuthForm() {
    const email = authEmailInput?.value.trim() || "";
    const password = authPasswordInput?.value || "";

    if (authMode === "signup" && !authNameInput?.value.trim()) {
        return "Enter your name.";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return "Enter a valid email address.";
    }

    if (!password) {
        return "Enter your password.";
    }

    if (authMode === "signup") {
        if (password.length < 8) return "Password must be at least 8 characters.";
        if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
            return "Password needs at least one letter and one number.";
        }
    }

    return "";
}

authTabs.forEach(tab => {
    tab.addEventListener("click", () => setAuthMode(tab.dataset.mode));
});

authPasswordToggle?.addEventListener("click", () => {
    const show = authPasswordInput.type === "password";
    authPasswordInput.type = show ? "text" : "password";
    authPasswordToggle.textContent = show ? "Hide" : "Show";
    authPasswordToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

authForm?.addEventListener("submit", async event => {
    event.preventDefault();

    const problem = validateAuthForm();
    if (problem) {
        setMessage(authMessage, problem, true);
        return;
    }

    const body = {
        email: authEmailInput.value.trim(),
        password: authPasswordInput.value
    };
    if (authMode === "signup") body.name = authNameInput.value.trim();

    authSubmit.disabled = true;
    setMessage(authMessage, authMode === "signup" ? "Creating your account…" : "Logging in…");

    try {
        const response = await fetch(`${API_BASE}/api/auth/${authMode}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await readJson(response);

        if (!response.ok) {
            throw new Error(data.error || "Something went wrong. Please try again.");
        }

        writeToken(data.token);
        enterApp(data.user, data.plan);
    } catch (error) {
        setMessage(authMessage, friendlyError(error, "Something went wrong."), true);
    } finally {
        authSubmit.disabled = false;
    }
});

// Account menu
accountButton?.addEventListener("click", event => {
    event.stopPropagation();
    const open = accountDropdown.hidden;
    accountDropdown.hidden = !open;
    accountButton.setAttribute("aria-expanded", String(open));
});

document.addEventListener("click", event => {
    if (accountDropdown && !accountDropdown.hidden &&
        !accountDropdown.contains(event.target)) {
        accountDropdown.hidden = true;
        accountButton?.setAttribute("aria-expanded", "false");
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && accountDropdown && !accountDropdown.hidden) {
        accountDropdown.hidden = true;
        accountButton?.setAttribute("aria-expanded", "false");
        accountButton?.focus();
    }
});

logoutButton?.addEventListener("click", async () => {
    logoutButton.disabled = true;

    try {
        if (authToken) {
            await fetch(`${API_BASE}/api/auth/logout`, {
                method: "POST",
                headers: { Authorization: `Bearer ${authToken}` }
            });
        }
    } catch {
        // Even if the server can't be reached, log out on this device.
    } finally {
        logoutButton.disabled = false;
        setAuthMode("login");
        signOutLocally();
    }
});

const WELCOME_MESSAGE = chatMessages?.firstElementChild?.textContent || "";

// Clear everything belonging to the previous account.
function resetAppState() {
    transactions = [];
    transactionsLoaded = false;
    financialData = normalisePlan(null);
    chatHistory = [];

    if (chatMessages) {
        const welcome = document.createElement("div");
        welcome.className = "ai-chat-bubble ai-chat-bot";
        welcome.textContent = WELCOME_MESSAGE;
        chatMessages.replaceChildren(welcome);
    }

    [financeMessage, formMessage].forEach(element => setMessage(element, ""));
    expenseForm?.reset();
    if (expenseDateInput) expenseDateInput.value = todayInputValue();
    if (financeMonth) financeMonth.value = currentMonthKey();
}

function signOutLocally(message = "") {
    writeToken("");
    currentUser = null;
    resetAppState();
    showAuthScreen(message);
}

function enterApp(user, plan) {
    resetAppState();

    currentUser = user;
    financialData = normalisePlan(plan);

    const firstName = String(user?.name || "").split(" ")[0] || "there";

    if (accountButton) {
        accountButton.textContent = (user?.name || "S").trim().charAt(0).toUpperCase();
        accountButton.title = `${user?.name || "Your account"} — account menu`;
    }
    setText("account-name", user?.name || "");
    setText("account-email", user?.email || "");
    setText("hero-greeting", `Hi ${firstName} 👋`);

    hideAuthScreen();
    loadSelectedMonth();
    loadTransactions();
}

async function startApp() {
    if (!authToken) {
        showAuthScreen();
        return;
    }

    // Keep the screen locked until we know who is logged in.
    try {
        const response = await apiFetch(`${API_BASE}/api/auth/me`);
        const data = await readJson(response);

        if (!response.ok) {
            throw new Error(data.error || "Could not load your account.");
        }

        enterApp(data.user, data.plan);
    } catch (error) {
        if (error instanceof SessionExpiredError) return;

        showAuthScreen(
            error instanceof TypeError
                ? "Could not reach the backend. Is it running? (npm start in the backend folder)"
                : error.message
        );
    }
}

// ---------------------------------------------
// MONTHLY FINANCE PLAN (saved to your account)
// ---------------------------------------------

function getMonthlyBudget(month) {
    const budget = financialData.monthlyBudgets[month];
    return budget === undefined || budget === null || budget === ""
        ? null
        : Number(budget);
}

function loadSelectedMonth() {
    if (financeMonth && !financeMonth.value) {
        financeMonth.value = currentMonthKey();
    }

    const month = selectedMonthKey();

    if (startingBalanceInput) {
        startingBalanceInput.value = financialData.hasStartingBalance
            ? financialData.startingBalance
            : "";
    }

    if (monthlyBudgetInput) {
        monthlyBudgetInput.value = getMonthlyBudget(month) ?? "";
    }

    setMessage(financeMessage, "");
    refreshAll();
}

if (financeMonth) {
    financeMonth.value = currentMonthKey();
    financeMonth.addEventListener("change", loadSelectedMonth);
}

if (financeForm) {
    financeForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const startingBalance = Number(startingBalanceInput?.value);
        const monthlyBudget = Number(monthlyBudgetInput?.value);

        if (
            startingBalanceInput?.value === "" ||
            monthlyBudgetInput?.value === "" ||
            !Number.isFinite(startingBalance) ||
            !Number.isFinite(monthlyBudget) ||
            startingBalance < 0 ||
            monthlyBudget < 0
        ) {
            setMessage(financeMessage, "Please enter valid amounts of £0 or more.", true);
            return;
        }

        const month = selectedMonthKey();
        const submitButton = financeForm.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;

        setMessage(financeMessage, "Saving…");

        try {
            const response = await apiFetch(`${API_BASE}/api/plan`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ startingBalance, month, monthlyBudget })
            });
            const data = await readJson(response);

            if (!response.ok) {
                throw new Error(data.error || "Could not save your plan.");
            }

            financialData = normalisePlan(data);
            updateDashboard();
            setMessage(financeMessage, `Plan saved for ${monthLabel(month)}!`);
        } catch (error) {
            if (error instanceof SessionExpiredError) return;
            setMessage(financeMessage, friendlyError(error, "Could not save your plan."), true);
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
}


// ---------------------------------------------
// DASHBOARD
// ---------------------------------------------

function selectedMonthTransactions() {
    const month = selectedMonthKey();
    return transactions.filter(expense => getExpenseMonth(expense) === month);
}

function updateDashboard() {
    const month = selectedMonthKey();
    const label = monthLabel(month);
    const monthlyTransactions = selectedMonthTransactions();

    const monthlySpending = sumAmounts(monthlyTransactions);
    const allTimeSpending = sumAmounts(transactions);
    const monthlyBudget = getMonthlyBudget(month);

    // Available balance
    const availableBalance = financialData.startingBalance - allTimeSpending;
    const balanceElement = document.getElementById("available-balance");

    setText(
        "available-balance",
        financialData.hasStartingBalance ? money(availableBalance) : "—"
    );
    balanceElement?.classList.toggle(
        "is-negative",
        financialData.hasStartingBalance && availableBalance < 0
    );
    setText(
        "balance-caption",
        financialData.hasStartingBalance
            ? "Starting balance minus all recorded spending"
            : "Add your starting balance below"
    );

    // Safe to spend + budget progress
    const safeElement = document.getElementById("safe-to-spend");
    const progressBar = document.getElementById("budget-progress-bar");

    if (monthlyBudget === null) {
        setText("safe-to-spend", "—");
        safeElement?.classList.remove("is-negative");
        setText("safe-to-spend-caption", `No budget set for ${label}`);
        setText("budget-status", "Set a budget to get started");

        if (progressBar) progressBar.style.width = "0";
    } else {
        const safeToSpend = monthlyBudget - monthlySpending;
        const usedPercent = monthlyBudget > 0
            ? Math.round((monthlySpending / monthlyBudget) * 100)
            : (monthlySpending > 0 ? 100 : 0);

        setText("safe-to-spend", money(Math.max(safeToSpend, 0)));
        safeElement?.classList.toggle("is-negative", safeToSpend < 0);
        setText(
            "safe-to-spend-caption",
            safeToSpend < 0
                ? `Over budget by ${money(-safeToSpend)}`
                : `Left of your ${money(monthlyBudget)} budget`
        );
        setText("budget-status", `${usedPercent}% of budget used`);

        if (progressBar) {
            progressBar.style.width = `${Math.min(usedPercent, 100)}%`;
            progressBar.classList.toggle("is-warning", usedPercent >= 80 && usedPercent <= 100);
            progressBar.classList.toggle("is-over", usedPercent > 100);
        }
    }

    // Monthly spending
    setText("monthly-spending", money(monthlySpending));
    setText("monthly-spending-caption", `Spent in ${label}`);

    // Category totals
    const categoryTotals = Object.fromEntries(
        Object.keys(CATEGORY_LABELS).map(category => [category, []])
    );

    monthlyTransactions.forEach(expense => {
        const category = String(expense.category || "other").toLowerCase();
        categoryTotals[category in categoryTotals ? category : "other"].push(expense);
    });

    Object.entries(categoryTotals).forEach(([category, list]) => {
        setText(`spending-${category}`, money(sumAmounts(list)));
    });

    setText("upcoming-bills", money(sumAmounts(categoryTotals.bills)));
    setText("overview-month", `Where your money went in ${label}.`);
}

function refreshAll() {
    updateDashboard();
    renderTransactions();
}

// ---------------------------------------------
// LOAD EXPENSES FROM MONGODB
// ---------------------------------------------

function renderStatus(title, subtitle) {
    if (!transactionList) return;

    const box = document.createElement("div");
    box.className = "empty-state";

    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.textContent = "↗";

    const heading = document.createElement("p");
    heading.textContent = title;

    const detail = document.createElement("span");
    detail.textContent = subtitle;

    box.append(icon, heading, detail);
    transactionList.replaceChildren(box);
}

async function loadTransactions() {
    if (!transactionsLoaded) {
        renderStatus("Loading transactions…", "Fetching your recorded expenses.");
    }

    try {
        const response = await apiFetch(API_URL);
        const data = await readJson(response);

        if (!response.ok) {
            throw new Error(data.error || "Could not load expenses.");
        }

        transactions = Array.isArray(data)
            ? data
            : Array.isArray(data.expenses)
                ? data.expenses
                : [];

        transactionsLoaded = true;
        refreshAll();
    } catch (error) {
        if (error instanceof SessionExpiredError) return;
        console.error("Loading expenses failed:", error);

        renderStatus(
            "Could not load transactions",
            "Check that the backend is running (npm start in the backend folder)."
        );
    }
}

// ---------------------------------------------
// ADD AN EXPENSE
// ---------------------------------------------

if (expenseDateInput) {
    expenseDateInput.value = todayInputValue();
    expenseDateInput.max = todayInputValue();
}

if (expenseForm) {
    expenseForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const name = expenseNameInput?.value.trim();
        const amount = Number(expenseAmountInput?.value);
        const category = expenseCategoryInput?.value;
        const dateValue = expenseDateInput?.value || todayInputValue();

        if (!name || !Number.isFinite(amount) || amount <= 0 || !category) {
            setMessage(
                formMessage,
                "Enter an expense name, a valid amount, and a category.",
                true
            );
            return;
        }

        if (dateValue > todayInputValue()) {
            setMessage(formMessage, "The expense date can't be in the future.", true);
            return;
        }

        const expense = {
            name,
            amount: Math.round(amount * 100) / 100,
            category,
            date: dateInputToISO(dateValue)
        };

        const submitButton = expenseForm.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;

        setMessage(formMessage, "Saving…");

        try {
            const response = await apiFetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(expense)
            });

            const data = await readJson(response);

            if (!response.ok) {
                throw new Error(data.error || "Could not save this expense.");
            }

            const savedMonth = dateValue.slice(0, 7);

            setMessage(
                formMessage,
                savedMonth === selectedMonthKey()
                    ? "Expense added successfully!"
                    : `Expense added to ${monthLabel(savedMonth)}. Switch the budget month to see it.`
            );

            expenseForm.reset();
            if (expenseDateInput) {
                expenseDateInput.value = todayInputValue();
                expenseDateInput.max = todayInputValue();
            }
            expenseNameInput?.focus();

            if (data.expense) {
                transactions = [data.expense, ...transactions];
                refreshAll();
            } else {
                await loadTransactions();
            }
        } catch (error) {
            if (error instanceof SessionExpiredError) return;
            console.error("Saving expense failed:", error);
            setMessage(formMessage, friendlyError(error, "Could not save expense."), true);
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
}

// ---------------------------------------------
// DELETE AN EXPENSE
// ---------------------------------------------

async function deleteExpense(expense, button) {
    if (!expense._id) return;

    const ok = window.confirm(
        `Delete "${expense.name}" (${money(expense.amount)})? This can't be undone.`
    );
    if (!ok) return;

    button.disabled = true;

    try {
        const response = await apiFetch(`${API_URL}/${encodeURIComponent(expense._id)}`, {
            method: "DELETE"
        });
        const data = await readJson(response);

        // 404 means it's already gone, so remove it locally too.
        if (!response.ok && response.status !== 404) {
            throw new Error(data.error || "Could not delete this expense.");
        }

        transactions = transactions.filter(item => item._id !== expense._id);
        refreshAll();
    } catch (error) {
        if (error instanceof SessionExpiredError) return;
        console.error("Deleting expense failed:", error);
        button.disabled = false;
        window.alert(friendlyError(error, "Could not delete this expense."));
    }
}

// ---------------------------------------------
// DISPLAY TRANSACTIONS (selected month)
// ---------------------------------------------

function renderTransactions() {
    if (!transactionList || !transactionsLoaded) return;

    const month = selectedMonthKey();
    const label = monthLabel(month);
    const monthly = selectedMonthTransactions();

    setText(
        "activity-summary",
        monthly.length
            ? `${monthly.length} expense${monthly.length === 1 ? "" : "s"} in ${label} · ${money(sumAmounts(monthly))} total`
            : `Expenses in ${label}.`
    );

    if (monthly.length === 0) {
        renderStatus(
            transactions.length ? `Nothing recorded in ${label}` : "No transactions yet",
            transactions.length
                ? "Pick another budget month or record a new expense."
                : "Your recorded expenses will appear here."
        );
        return;
    }

    const sorted = [...monthly].sort((a, b) =>
        (parseExpenseDate(b)?.getTime() || 0) - (parseExpenseDate(a)?.getTime() || 0)
    );

    const items = sorted.slice(0, MAX_LISTED_TRANSACTIONS).map(expense => {
        const item = document.createElement("div");
        item.className = "transaction";

        const details = document.createElement("div");

        const name = document.createElement("p");
        name.className = "transaction-name";
        name.textContent = expense.name || "Expense";

        const metadata = document.createElement("p");
        metadata.className = "transaction-details";

        const categoryKey = String(expense.category || "other").toLowerCase();
        const categoryLabel = CATEGORY_LABELS[categoryKey] || "Other";
        const dateLabel = getExpenseDate(expense);

        metadata.textContent = dateLabel ? `${categoryLabel} · ${dateLabel}` : categoryLabel;

        const side = document.createElement("div");
        side.className = "transaction-side";

        const amount = document.createElement("span");
        amount.className = "transaction-amount";
        amount.textContent = `-${money(expense.amount)}`;

        side.append(amount);

        if (expense._id) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "transaction-delete";
            remove.textContent = "✕";
            remove.title = "Delete expense";
            remove.setAttribute("aria-label", `Delete ${expense.name || "expense"}`);
            remove.addEventListener("click", () => deleteExpense(expense, remove));
            side.append(remove);
        }

        details.append(name, metadata);
        item.append(details, side);
        return item;
    });

    if (sorted.length > MAX_LISTED_TRANSACTIONS) {
        const more = document.createElement("p");
        more.className = "transaction-details";
        more.textContent = `Showing the latest ${MAX_LISTED_TRANSACTIONS} of ${sorted.length}.`;
        items.push(more);
    }

    transactionList.replaceChildren(...items);
}

// ---------------------------------------------
// AI MONEY COACH CHAT
// ---------------------------------------------

function addChatMessage(message, sender) {
    const bubble = document.createElement("div");

    bubble.className = "ai-chat-bubble " +
        (sender === "user" ? "ai-chat-user" : "ai-chat-bot");

    // textContent prevents AI responses from being treated as HTML.
    bubble.textContent = message;

    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return bubble;
}

function setCoachBusy(busy) {
    coachBusy = busy;

    if (chatSend) chatSend.disabled = busy;
    if (chatInput) chatInput.disabled = busy;

    quickPrompts.forEach(button => {
        button.disabled = busy;
    });
}

function buildFinancialContext() {
    const month = selectedMonthKey();
    const budget = getMonthlyBudget(month);
    const monthSpending = sumAmounts(selectedMonthTransactions());
    const allTimeSpending = sumAmounts(transactions);

    return {
        selectedMonth: month,
        startingBalanceGBP: financialData.hasStartingBalance
            ? financialData.startingBalance
            : null,
        totalRecordedSpendingGBP: allTimeSpending,
        estimatedRemainingBalanceGBP: financialData.hasStartingBalance
            ? financialData.startingBalance - allTimeSpending
            : null,
        monthlyBudgetGBP: budget,
        selectedMonthSpendingGBP: monthSpending,
        remainingMonthlyBudgetGBP: budget === null ? null : budget - monthSpending
    };
}

async function askMoneyCoach(question) {
    if (!chatMessages || coachBusy) return;

    const cleanQuestion = String(question || "").trim();
    if (!cleanQuestion) return;

    addChatMessage(cleanQuestion, "user");
    const replyBubble = addChatMessage("Thinking…", "bot");
    replyBubble.classList.add("is-thinking");

    setCoachBusy(true);

    try {
        const response = await apiFetch(AI_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question: cleanQuestion,
                financialContext: buildFinancialContext(),
                history: chatHistory.slice(-MAX_CHAT_HISTORY)
            })
        });

        const data = await readJson(response);

        if (!response.ok) {
            throw new Error(data.error || "The AI coach could not respond.");
        }

        const advice = cleanAiText(
            data.advice || "I couldn't generate a response. Please try again."
        );

        replyBubble.textContent = advice;

        // Remember the exchange so follow-up answers keep their context.
        chatHistory.push(
            { role: "user", text: cleanQuestion },
            { role: "coach", text: advice }
        );
        chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
    } catch (error) {
        if (error instanceof SessionExpiredError) return;
        console.error("AI Money Coach error:", error);

        replyBubble.textContent = error instanceof TypeError
            ? "I couldn't connect to your money coach. Check that the backend is running, then try again."
            : error.message;
    } finally {
        replyBubble.classList.remove("is-thinking");
        setCoachBusy(false);
        chatInput?.focus();
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

if (chatForm && chatInput && chatMessages && chatSend) {
    chatForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const question = chatInput.value.trim();
        if (!question) return;

        chatInput.value = "";
        askMoneyCoach(question);
    });

    quickPrompts.forEach(button => {
        button.addEventListener("click", function () {
            askMoneyCoach(button.dataset.question || button.textContent.trim());
        });
    });
}

// ---------------------------------------------
// NAVIGATION HIGHLIGHT
// ---------------------------------------------

const navLinks = document.querySelectorAll(".nav-link");

function setActiveNav(hash) {
    navLinks.forEach(link => {
        link.classList.toggle("active", link.getAttribute("href") === hash);
    });
}

function updateActiveNav() {
    const sections = ["#insights", "#transactions"]
        .map(id => document.querySelector(id))
        .filter(Boolean);

    const passed = sections.filter(
        section => section.getBoundingClientRect().top < window.innerHeight * 0.4
    );

    setActiveNav(passed.length ? `#${passed[passed.length - 1].id}` : "#dashboard");
}

let navTicking = false;

window.addEventListener("scroll", () => {
    if (navTicking) return;
    navTicking = true;

    requestAnimationFrame(() => {
        updateActiveNav();
        navTicking = false;
    });
}, { passive: true });

// ---------------------------------------------
// START THE APP
// ---------------------------------------------

updateActiveNav();
startApp();
